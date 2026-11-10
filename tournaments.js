// tournaments.js
// Campeonatos com chave eliminatória (1v1). O servidor é a única fonte da verdade:
// inscrição, check-in, chave, prontidão (W.O.), séries MD1/3/5/7, terceiro
// lugar, pausa, prazos, estatísticas e sinais de multicontas.
//
// Tudo fica em memória e é salvo (Postgres ou data/tournaments.json) a cada
// mudança. Os prazos são guardados em UTC (milissegundos) e conferidos por um
// "relógio" que roda a cada segundo, então sobrevivem a um reinício do servidor.
//
// O servidor injeta os "ganchos" (hooks) para avisar jogadores e abrir as salas
// das partidas; este módulo não conhece socket nem sala diretamente.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SIZES = [4, 8, 16, 32, 64];
const BEST_OF = [1, 3, 5, 7];
const ROUND_KEYS = { 1: 'F', 2: 'SF', 4: 'QF', 8: 'R16', 16: 'R32', 32: 'R64' };
const ROUND_NAMES = { F: 'Final', SF: 'Semifinal', QF: 'Quartas de final', R16: 'Oitavas de final', R32: '16-avos de final', R64: '32-avos de final', '3P': 'Disputa de 3º lugar' };
const DEADLINE_POLICIES = ['finish_running', 'extend', 'end_no_champion'];
const SIGNAL_RETENTION_MS = 30 * 24 * 3600 * 1000; // sinais de multiconta: 30 dias depois do fim
const CHECKIN_WINDOW_MS = 15 * 60 * 1000;

const DEFAULT_TIMERS = {
  readyMs: 3 * 60 * 1000,        // confirmar presença na partida
  turnMs: 30 * 1000,             // por jogada
  trucoMs: 30 * 1000,            // responder truco/envido/flor
  reconnectMs: 120 * 1000,       // voltar depois de cair
  disconnectTotalMs: 5 * 60 * 1000, // desconexão somada na partida
  betweenGamesMs: 30 * 1000      // intervalo entre partidas da série
};

const clampInt = (v, lo, hi, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};
const str = (v, max) => (typeof v === 'string' ? v.replace(/[<>]/g, '').trim().slice(0, max) : '');

function hashPassword(pass, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pass), salt, 32).toString('hex');
  return { salt, hash };
}
function checkPassword(pass, rec) {
  if (!rec) return true;
  const { hash } = hashPassword(pass || '', rec.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(rec.hash, 'hex'));
}

// Ordem das posições da chave (1 x último, 2 x penúltimo...): os BYEs ficam
// sempre contra cabeças de chave e nunca BYE contra BYE
function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap(s => [s, n + 1 - s]);
  }
  return order;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Bots de teste: contas de mentira "bot:1", "bot:2"... (não existem no banco de contas)
const isBotAcc = acc => typeof acc === 'string' && acc.startsWith('bot:');
const BOT_NAMES = ['Gaudêncio', 'Chiru', 'Tropeiro', 'Peão Véio', 'Prenda', 'Sinuelo', 'Xiru', 'Bagual', 'Taura', 'Pilcha', 'Guasca', 'Chimango',
  'Guri', 'Piá', 'Campeiro', 'Tchê', 'Cusco', 'Pingo', 'Matungo', 'Chinoca', 'Gaudério', 'Fronteiriço', 'Coxilheiro', 'Minuano',
  'Pampeiro', 'Lindeiro', 'Andarengo', 'Charrua', 'Tapejara', 'Domador', 'Capataz', 'Posteiro'];
const BOT_SIM_MS = Number(process.env.TOUR_BOT_MS) || 6000; // bot contra bot: partida "simulada"

function createTournaments(accountStore, hooks = {}) {
  const usePg = accountStore && accountStore.kind === 'postgres' && accountStore.pool;
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const file = path.join(dir, 'tournaments.json');
  const TICK_MS = Number(process.env.TOUR_TICK_MS) || 1000;
  let items = {};
  let secret = null; // tempero do hash de IP/aparelho (fica salvo junto)
  let writing = Promise.resolve();
  let loaded = false;
  const now = () => (hooks.now ? hooks.now() : Date.now());
  const H = name => (hooks[name] || (() => {}));

  // ------------------------------------------------------------------ store
  async function load() {
    if (usePg) {
      const pool = accountStore.pool;
      await pool.query('CREATE TABLE IF NOT EXISTS truco_tournaments (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
      const res = await pool.query('SELECT id, data FROM truco_tournaments');
      res.rows.forEach(r => {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (r.id === '_meta') secret = d.secret;
        else items[r.id] = d;
      });
    } else {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        items = saved.items || {};
        secret = saved.secret || null;
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('Erro ao ler tournaments.json:', e.message);
      }
    }
    if (!secret) { secret = crypto.randomBytes(24).toString('hex'); persist(null, true); }
    loaded = true;
    recoverAfterRestart();
    console.log(`Campeonatos carregados: ${Object.keys(items).length}`);
  }

  function persist(t, meta = false) {
    writing = writing.then(async () => {
      try {
        if (usePg) {
          const pool = accountStore.pool;
          if (meta) await pool.query(`INSERT INTO truco_tournaments (id, data) VALUES ('_meta', $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [JSON.stringify({ secret })]);
          if (t) await pool.query(`INSERT INTO truco_tournaments (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [t.id, JSON.stringify(t)]);
        } else {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file + '.tmp', JSON.stringify({ secret, items }));
          fs.renameSync(file + '.tmp', file);
        }
      } catch (e) {
        console.error('Erro ao gravar campeonato:', e.message);
      }
    });
    return writing;
  }

  function persistDelete(id) {
    writing = writing.then(async () => {
      try {
        if (usePg) await accountStore.pool.query('DELETE FROM truco_tournaments WHERE id = $1', [id]);
        else {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file + '.tmp', JSON.stringify({ secret, items }));
          fs.renameSync(file + '.tmp', file);
        }
      } catch (e) {
        console.error('Erro ao apagar campeonato:', e.message);
      }
    });
    return writing;
  }

  const ready = new Promise(resolve => {
    const attempt = () => load().then(resolve).catch(err => {
      console.error('Erro ao carregar campeonatos, tentando de novo em 5s:', err.message);
      setTimeout(attempt, 5000);
    });
    attempt();
  });

  // ------------------------------------------------------------------ util
  const audit = (t, admin, action, detail) => {
    t.audit.push({ at: now(), admin: admin || 'admin', action, detail: detail || '' });
    if (t.audit.length > 500) t.audit.shift();
  };
  const event = (t, type, data) => {
    t.events.push({ at: now(), type, ...data });
    if (t.events.length > 2000) t.events.shift();
  };
  const changed = (t, opts = {}) => {
    t.updatedAt = now();
    persist(t);
    H('changed')(t, opts);
  };
  const participant = (t, account) => t.participants.find(p => p.account === account);
  const nameOf = (t, account) => { const p = participant(t, account); return p ? p.name : account; };
  const roundKeyOf = (t, round) => {
    const matchesInRound = t.bracket ? t.bracket.size / Math.pow(2, round + 1) : 0;
    return ROUND_KEYS[matchesInRound] || `R${matchesInRound * 2}`;
  };
  const bestOfFor = (t, key) => {
    const v = t.bestOf && t.bestOf.byRound && t.bestOf.byRound[key];
    return BEST_OF.includes(v) ? v : (t.bestOf && BEST_OF.includes(t.bestOf.default) ? t.bestOf.default : 1);
  };
  const isPaused = t => t.status === 'paused';
  // Tempo "do campeonato": não anda durante pausas
  const effNow = t => now() - (t.pausedTotalMs || 0) - (isPaused(t) && t.pause ? now() - t.pause.at : 0);

  // ------------------------------------------------------------------ validação
  function cleanConfig(data, existing) {
    const errors = [];
    const name = str(data.name, 60);
    if (name.length < 3) errors.push('Dê um nome ao campeonato (pelo menos 3 letras).');
    const maxPlayers = Number(data.maxPlayers);
    if (!SIZES.includes(maxPlayers)) errors.push('Escolha 4, 8, 16, 32 ou 64 participantes.');
    const startAt = Number(data.startAt);
    const endAt = Number(data.endAt);
    if (!Number.isFinite(startAt)) errors.push('Informe a data e o horário de início.');
    else if ((!existing || startAt !== existing.startAt) && startAt < now() - 60000) errors.push('O início precisa ser no futuro.');
    if (!Number.isFinite(endAt) || endAt <= startAt) errors.push('O horário limite precisa ser depois do início.');
    const byRound = {};
    const src = (data.bestOf && data.bestOf.byRound) || {};
    Object.keys(src).forEach(k => { if (['F', 'SF', 'QF', 'R16', 'R32', 'R64', '3P'].includes(k) && BEST_OF.includes(Number(src[k]))) byRound[k] = Number(src[k]); });
    const defBo = BEST_OF.includes(Number(data.bestOf && data.bestOf.default)) ? Number(data.bestOf.default) : 1;
    const timersIn = data.timers || {};
    const timers = {
      readyMs: clampInt(timersIn.readyMs, 10000, 30 * 60000, DEFAULT_TIMERS.readyMs),
      turnMs: clampInt(timersIn.turnMs, 5000, 300000, DEFAULT_TIMERS.turnMs),
      trucoMs: clampInt(timersIn.trucoMs, 5000, 300000, DEFAULT_TIMERS.trucoMs),
      reconnectMs: clampInt(timersIn.reconnectMs, 10000, 30 * 60000, DEFAULT_TIMERS.reconnectMs),
      disconnectTotalMs: clampInt(timersIn.disconnectTotalMs, 10000, 60 * 60000, DEFAULT_TIMERS.disconnectTotalMs),
      betweenGamesMs: clampInt(timersIn.betweenGamesMs, 1000, 10 * 60000, DEFAULT_TIMERS.betweenGamesMs)
    };
    const cfg = {
      name,
      description: str(data.description, 1000),
      mode: '1v1',
      format: 'single_elim',
      maxPlayers,
      startAt,
      endAt,
      allowEarlyStart: !!data.allowEarlyStart,
      isPrivate: !!data.isPrivate,
      checkinRequired: data.checkinRequired !== false,
      thirdPlace: !!data.thirdPlace,
      maxPoints: clampInt(data.maxPoints, 1, 40, 24),
      bestOf: { default: defBo, byRound },
      timers,
      deadlinePolicy: DEADLINE_POLICIES.includes(data.deadlinePolicy) ? data.deadlinePolicy : 'finish_running',
      extendMinutes: clampInt(data.extendMinutes, 5, 24 * 60, 30),
      woEndsSeries: data.woEndsSeries !== false,
      manualRounds: !!data.manualRounds // cada fase (depois da 1ª) só começa quando o admin liberar
    };
    if (cfg.isPrivate && !existing && !str(data.password, 64)) errors.push('Campeonato privado precisa de senha.');
    return { cfg, errors };
  }

  // ------------------------------------------------------------------ admin
  function create(data, admin) {
    const { cfg, errors } = cleanConfig(data || {});
    if (errors.length) return { error: errors[0] };
    const t = {
      id: crypto.randomBytes(4).toString('hex').toUpperCase(),
      ...cfg,
      pass: cfg.isPrivate ? hashPassword(str(data.password, 64)) : null,
      status: 'registration',
      createdAt: now(),
      updatedAt: now(),
      participants: [],
      bracket: null,
      matches: {},
      results: null,
      pause: null,
      pausedTotalMs: 0,
      deadlineHit: false,
      events: [],
      audit: [],
      signals: [],
      decisions: [],
      notified: {}
    };
    audit(t, admin, 'criar', cfg.name);
    items[t.id] = t;
    changed(t, { list: true });
    return { ok: true, id: t.id };
  }

  function update(id, data, admin) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    if (!['registration', 'checkin'].includes(t.status)) return { error: 'Depois que o campeonato começa, as configurações não mudam.' };
    const { cfg, errors } = cleanConfig(data || {}, t);
    if (errors.length) return { error: errors[0] };
    if (cfg.maxPlayers < t.participants.length) return { error: `Já há ${t.participants.length} inscritos: escolha uma chave maior.` };
    Object.assign(t, cfg);
    if (cfg.isPrivate && str(data.password, 64)) t.pass = hashPassword(str(data.password, 64));
    if (!cfg.isPrivate) t.pass = null;
    audit(t, admin, 'editar', 'configurações alteradas');
    changed(t, { list: true });
    return { ok: true };
  }

  function pause(id, message, admin) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    if (t.status !== 'running') return { error: 'Só dá para pausar um campeonato em andamento.' };
    t.status = 'paused';
    t.pause = { at: now(), message: str(message, 200) || 'Campeonato pausado pela organização.', by: admin };
    audit(t, admin, 'pausar', t.pause.message);
    event(t, 'pause', { message: t.pause.message });
    H('pauseRooms')(t, true);
    notifyAll(t, 'paused', t.pause.message);
    changed(t, { list: true });
    return { ok: true };
  }

  function resume(id, admin) {
    const t = items[id];
    if (!t || t.status !== 'paused') return { error: 'O campeonato não está pausado.' };
    const pausedFor = now() - t.pause.at;
    t.pausedTotalMs = (t.pausedTotalMs || 0) + pausedFor;
    // Prazos que estavam correndo andam para frente o tempo da pausa
    Object.values(t.matches).forEach(m => {
      if (m.readyDeadline) m.readyDeadline += pausedFor;
      if (m.nextGameAt) m.nextGameAt += pausedFor;
    });
    t.endAt += pausedFor;
    audit(t, admin, 'retomar', `pausado por ${Math.round(pausedFor / 1000)}s`);
    event(t, 'resume', { pausedMs: pausedFor });
    t.pause = null;
    t.status = 'running';
    H('pauseRooms')(t, false);
    notifyAll(t, 'resumed', 'O campeonato voltou! Os prazos continuam de onde pararam.');
    changed(t, { list: true });
    return { ok: true };
  }

  // Apaga de vez (qualquer situação). Fecha as mesas que estiverem abertas.
  function remove(id, admin) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    if (!['finished', 'cancelled'].includes(t.status)) {
      H('endRooms')(t);
      notifyAll(t, 'cancelled', `O campeonato "${t.name}" foi apagado pela organização.`);
    }
    delete items[id];
    persistDelete(id);
    H('changed')(t, { list: true, deleted: true });
    return { ok: true, message: 'Campeonato apagado.' };
  }

  // Bots para testar: entram como participantes enquanto as inscrições estão abertas
  function addBots(id, count, admin) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    if (!['registration', 'checkin'].includes(t.status)) return { error: 'Só dá para colocar bots antes de começar.' };
    const free = t.maxPlayers - t.participants.length;
    if (free <= 0) return { error: 'Não há mais vagas.' };
    const n = Math.min(free, clampInt(count, 1, 64, 1));
    const usedNames = new Set(t.participants.map(p => p.name));
    let seq = t.participants.filter(p => isBotAcc(p.account)).reduce((mx, p) => Math.max(mx, Number(p.account.slice(4)) || 0), 0);
    for (let i = 0; i < n; i++) {
      seq++;
      let name = BOT_NAMES.find(b => !usedNames.has(`Bot ${b}`));
      name = name ? `Bot ${name}` : `Bot ${seq}`;
      usedNames.add(name);
      t.participants.push({ account: `bot:${seq}`, name, bot: true, registeredAt: now(), checkedIn: true, checkedInAt: now(), status: 'checked_in' });
    }
    audit(t, admin, 'bots', `+${n} bot(s)`);
    changed(t, { list: true });
    return { ok: true, message: `${n} bot${n > 1 ? 's' : ''} no campeonato.` };
  }

  function removeBots(id, admin) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    if (!['registration', 'checkin'].includes(t.status)) return { error: 'Só dá para tirar bots antes de começar.' };
    const before = t.participants.length;
    t.participants = t.participants.filter(p => !isBotAcc(p.account));
    audit(t, admin, 'bots', `-${before - t.participants.length} bot(s)`);
    changed(t, { list: true });
    return { ok: true, message: 'Bots removidos.' };
  }

  // Bot sempre confirma "Estou pronto" na hora
  function botAutoReady(t, m) {
    if (m.status !== 'ready_check' || isPaused(t)) return;
    let any = false;
    ['a', 'b'].forEach(s => { if (isBotAcc(m[s]) && !m.ready[s]) { m.ready[s] = true; any = true; } });
    if (any && m.ready.a && m.ready.b) startGame(t, m);
    if (any) changed(t);
  }

  // Bot contra bot: não abre mesa; o resultado sai depois de alguns segundos
  function simulateBotGame(tid, matchId, n) {
    setTimeout(() => {
      const t = items[tid];
      const m = t && t.matches[matchId];
      const g = m && m.games.find(x => x.n === n);
      if (!g || g.winner || m.status !== 'playing') return;
      if (isPaused(t)) return simulateBotGame(tid, matchId, n);
      const winner = Math.random() < 0.5 ? m.a : m.b;
      const loserPts = Math.floor(Math.random() * t.maxPoints);
      reportGame(tid, matchId, n, winner, {
        reason: 'normal', durationMs: now() - g.startedAt, hands: 0,
        score: winner === m.a ? { a: t.maxPoints, b: loserPts } : { a: loserPts, b: t.maxPoints }
      });
    }, BOT_SIM_MS);
  }

  function cancel(id, reason, admin) {
    const t = items[id];
    if (!t || ['finished', 'cancelled'].includes(t.status)) return { error: 'Não dá para cancelar este campeonato.' };
    t.status = 'cancelled';
    t.finishedAt = now();
    t.cancelReason = str(reason, 200);
    audit(t, admin, 'cancelar', t.cancelReason);
    H('endRooms')(t);
    notifyAll(t, 'cancelled', `Campeonato cancelado${t.cancelReason ? `: ${t.cancelReason}` : '.'}`);
    changed(t, { list: true });
    return { ok: true };
  }

  // Encerrar agora: sem campeão se a final não terminou
  function finishNow(id, admin) {
    const t = items[id];
    if (!t || !['running', 'paused'].includes(t.status)) return { error: 'O campeonato não está em andamento.' };
    audit(t, admin, 'encerrar', 'encerrado pela organização');
    H('endRooms')(t);
    finalize(t, 'admin');
    return { ok: true };
  }

  function extend(id, minutes, admin) {
    const t = items[id];
    if (!t || !['running', 'paused', 'registration', 'checkin'].includes(t.status)) return { error: 'Não dá para prorrogar este campeonato.' };
    const add = clampInt(minutes, 5, 7 * 24 * 60, 30) * 60000;
    t.endAt += add;
    t.deadlineHit = false;
    audit(t, admin, 'prorrogar', `+${add / 60000} min`);
    notifyAll(t, 'extended', `O prazo do campeonato foi prorrogado em ${add / 60000} minutos.`);
    changed(t);
    return { ok: true };
  }

  function startEarly(id, admin) {
    const t = items[id];
    if (!t || !['registration', 'checkin'].includes(t.status)) return { error: 'O campeonato não está esperando o início.' };
    if (!t.allowEarlyStart) return { error: 'Este campeonato não permite início antecipado.' };
    const ok = t.participants.filter(p => !t.checkinRequired || p.checkedIn);
    if (ok.length < 2) return { error: 'Precisa de pelo menos 2 participantes confirmados.' };
    audit(t, admin, 'iniciar antes', `${ok.length} confirmados`);
    // Quem ainda não confirmou recebe aviso e tem uma janela curta para o check-in
    if (t.checkinRequired && ok.length < t.participants.length) {
      t.status = 'checkin';
      t.startAt = now() + 60000;
      notifyAll(t, 'early', 'O campeonato vai começar em 1 minuto! Confirme sua presença agora.');
      changed(t, { list: true });
      return { ok: true, message: 'Início em 1 minuto: quem não confirmou foi avisado.' };
    }
    t.startAt = now();
    begin(t);
    return { ok: true };
  }

  function disqualify(id, account, note, admin) {
    const t = items[id];
    const p = t && participant(t, account);
    if (!p) return { error: 'Participante não encontrado.' };
    p.disqualified = true;
    p.status = 'disqualified';
    audit(t, admin, 'desclassificar', `${p.name}: ${str(note, 200)}`);
    // Confronto em aberto: ele perde por W.O.
    Object.values(t.matches).forEach(m => {
      if (m.status === 'done' || m.status === 'void') return;
      if (m.a === account || m.b === account) {
        H('endMatchRoom')(t, m);
        decideMatch(t, m, m.a === account ? m.b : m.a, 'desclassificacao');
      }
    });
    changed(t);
    return { ok: true };
  }

  function decide(id, accounts, decision, note, admin) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    const d = { at: now(), admin, accounts: (accounts || []).slice(0, 6), decision: str(decision, 40), note: str(note, 400) };
    t.decisions.push(d);
    audit(t, admin, 'decisão multicontas', `${d.accounts.join(', ')}: ${d.decision}`);
    changed(t);
    return { ok: true };
  }

  // ------------------------------------------------------------------ jogadores
  function register(id, account, name, password, signal) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    if (!account) return { error: 'Entre na sua conta para participar.' };
    if (!['registration', 'checkin'].includes(t.status)) return { error: 'As inscrições estão fechadas.' };
    if (t.isPrivate && !checkPassword(password, t.pass)) return { error: 'Senha incorreta.' };
    if (participant(t, account)) return { error: 'Você já está inscrito.' };
    if (t.participants.length >= t.maxPlayers) return { error: 'Não há mais vagas.' };
    t.participants.push({ account, name, registeredAt: now(), checkedIn: false, status: 'registered' });
    addSignal(t, account, 'inscricao', signal);
    event(t, 'register', { account });
    changed(t, { list: true });
    return { ok: true };
  }

  function unregister(id, account) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    if (!['registration', 'checkin'].includes(t.status)) return { error: 'Não dá mais para sair: o campeonato já começou.' };
    const before = t.participants.length;
    t.participants = t.participants.filter(p => p.account !== account);
    if (t.participants.length === before) return { error: 'Você não está inscrito.' };
    event(t, 'unregister', { account });
    changed(t, { list: true });
    return { ok: true };
  }

  function checkin(id, account, signal) {
    const t = items[id];
    const p = t && participant(t, account);
    if (!p) return { error: 'Você não está inscrito.' };
    if (!['registration', 'checkin'].includes(t.status)) return { error: 'O check-in não está aberto.' };
    if (now() < t.startAt - CHECKIN_WINDOW_MS) return { error: 'O check-in abre 15 minutos antes do início.' };
    p.checkedIn = true;
    p.checkedInAt = now();
    p.status = 'checked_in';
    addSignal(t, account, 'checkin', signal);
    event(t, 'checkin', { account });
    changed(t);
    return { ok: true };
  }

  // Jogador confirma que está pronto para a partida do confronto
  function setReady(id, matchId, account, signal) {
    const t = items[id];
    const m = t && t.matches[matchId];
    if (!m) return { error: 'Confronto não encontrado.' };
    if (isPaused(t)) return { error: 'O campeonato está pausado.' };
    if (m.status !== 'ready_check') return { error: 'Este confronto não está esperando confirmação.' };
    const side = m.a === account ? 'a' : m.b === account ? 'b' : null;
    if (!side) return { error: 'Este confronto não é seu.' };
    m.ready[side] = true;
    m.readySocket = m.readySocket || {};
    if (signal && signal.socketId) m.readySocket[side] = signal.socketId;
    addSignal(t, account, 'partida', signal);
    if (m.ready.a && m.ready.b) startGame(t, m);
    changed(t);
    return { ok: true };
  }

  // ------------------------------------------------------------------ chave
  function begin(t) {
    const players = t.participants.filter(p => !p.disqualified && (!t.checkinRequired || p.checkedIn));
    t.participants.forEach(p => { if (!players.includes(p)) p.status = p.disqualified ? 'disqualified' : 'absent'; });
    if (players.length < 2) {
      t.status = 'cancelled';
      t.finishedAt = now();
      t.cancelReason = 'Menos de 2 participantes confirmados.';
      notifyAll(t, 'cancelled', 'O campeonato foi cancelado: menos de 2 participantes confirmaram presença.');
      changed(t, { list: true });
      return;
    }
    const size = SIZES.find(s => s >= players.length) || 64;
    const order = seedOrder(size);
    const seeded = shuffle(players.slice()).map(p => p.account);
    // posição na chave -> participante (cabeças de chave sorteadas); faltantes = BYE
    const slots = order.map(seed => seeded[seed - 1] || null);
    const rounds = [];
    const totalRounds = Math.log2(size);
    t.matches = {};
    for (let r = 0; r < totalRounds; r++) {
      const count = size / Math.pow(2, r + 1);
      rounds.push([]);
      for (let k = 0; k < count; k++) {
        const id = `R${r + 1}M${k + 1}`;
        t.matches[id] = {
          id, round: r, slot: k, a: null, b: null, aFilled: false, bFilled: false,
          status: 'waiting', wins: { a: 0, b: 0 }, games: [], winner: null, loser: null, reason: null,
          bestOf: 1, startedAt: null, endedAt: null, readyDeadline: null, ready: { a: false, b: false },
          next: r + 1 < totalRounds ? { id: `R${r + 2}M${Math.floor(k / 2) + 1}`, side: k % 2 === 0 ? 'a' : 'b' } : null
        };
        rounds[r].push(id);
      }
    }
    t.bracket = { size, rounds, totalRounds };
    Object.values(t.matches).forEach(m => {
      m.key = roundKeyOf(t, m.round);
      m.bestOf = bestOfFor(t, m.key);
    });
    if (t.thirdPlace && totalRounds >= 2) {
      t.matches['3P'] = {
        id: '3P', round: totalRounds - 1, slot: 1, key: '3P', a: null, b: null, aFilled: false, bFilled: false,
        status: 'waiting', wins: { a: 0, b: 0 }, games: [], winner: null, loser: null, reason: null,
        bestOf: bestOfFor(t, '3P'), startedAt: null, endedAt: null, readyDeadline: null, ready: { a: false, b: false }, next: null, third: true
      };
      // perdedores das semifinais vão para o 3º lugar
      rounds[totalRounds - 2].forEach((id, k) => { t.matches[id].loserNext = { id: '3P', side: k === 0 ? 'a' : 'b' }; });
    }
    t.status = 'running';
    t.startedAt = now();
    players.forEach(p => { p.status = 'playing'; });
    event(t, 'start', { players: players.length, size });
    // primeira fase
    rounds[0].forEach((id, k) => {
      const m = t.matches[id];
      fill(t, m, 'a', slots[k * 2]);
      fill(t, m, 'b', slots[k * 2 + 1]);
    });
    notifyAll(t, 'started', 'O campeonato começou! Veja a chave e o seu primeiro confronto.');
    changed(t, { list: true });
  }

  // Coloca alguém (ou ninguém) num lado do confronto e vê se ele já pode começar
  function fill(t, m, side, account) {
    m[side] = account || null;
    m[side + 'Filled'] = true;
    tryOpen(t, m);
  }

  // Fase do confronto para a liberação manual (3º lugar anda junto com a final)
  const phaseOf = (t, m) => (m.third ? t.bracket.totalRounds - 1 : m.round);
  const phaseReleased = (t, r) => !t.manualRounds || r === 0 || !!(t.released && t.released[r]);

  function tryOpen(t, m) {
    if (m.status !== 'waiting' || !m.aFilled || !m.bFilled) return;
    // BYE / vaga vazia
    if (!m.a && !m.b) return decideMatch(t, m, null, 'vazio');
    if (!m.a || !m.b) return decideMatch(t, m, m.a || m.b, m.round === 0 && !m.third ? 'bye' : 'vaga_vazia');
    if (!phaseReleased(t, phaseOf(t, m))) {
      // Esperando o admin liberar a fase
      if (!m.held) {
        m.held = true;
        [m.a, m.b].forEach(acc => H('notify')(acc, { tid: t.id, type: 'held', matchId: m.id, message: `Você está na ${ROUND_NAMES[m.key] || m.key}! Ela começa quando a organização liberar.` }));
      }
      return;
    }
    m.held = false;
    openReadyCheck(t, m);
  }

  // Próxima fase que ainda não foi liberada
  function nextHeldPhase(t) {
    if (!t.manualRounds || !t.bracket) return null;
    for (let r = 1; r < t.bracket.totalRounds; r++) {
      if (phaseReleased(t, r)) continue;
      const ms = Object.values(t.matches).filter(m => phaseOf(t, m) === r);
      const key = ms.find(m => !m.third) ? ms.find(m => !m.third).key : null;
      return { round: r, name: ROUND_NAMES[key] || key, ready: ms.filter(m => m.held).length, total: ms.filter(m => !['done', 'void'].includes(m.status)).length };
    }
    return null;
  }

  function releaseRound(id, admin) {
    const t = items[id];
    if (!t || !['running', 'paused'].includes(t.status)) return { error: 'O campeonato não está em andamento.' };
    const next = nextHeldPhase(t);
    if (!next) return { error: 'Não há fase esperando liberação.' };
    t.released = t.released || {};
    t.released[next.round] = true;
    audit(t, admin, 'liberar fase', next.name);
    Object.values(t.matches).filter(m => phaseOf(t, m) === next.round).forEach(m => { if (m.status === 'waiting') tryOpen(t, m); });
    notifyAll(t, 'released', `${next.name} liberada! Fique de olho no seu confronto.`);
    changed(t, { list: true });
    return { ok: true, message: `${next.name} liberada.` };
  }

  function openReadyCheck(t, m) {
    if (deadlinePassed(t) && t.deadlinePolicy !== 'extend') {
      m.status = 'blocked';
      return;
    }
    m.status = 'ready_check';
    m.ready = { a: false, b: false };
    m.readyDeadline = now() + t.timers.readyMs;
    m.startedAt = m.startedAt || now();
    const label = matchLabel(t, m);
    [m.a, m.b].forEach(acc => H('notify')(acc, {
      tid: t.id, type: 'match_ready', matchId: m.id,
      message: `${label}: seu confronto contra ${nameOf(t, acc === m.a ? m.b : m.a)} está liberado. Confirme que está pronto!`,
      deadline: m.readyDeadline
    }));
    botAutoReady(t, m);
  }

  function matchLabel(t, m) {
    const base = ROUND_NAMES[m.key] || m.key;
    return m.bestOf > 1 ? `${base} (MD${m.bestOf}, partida ${m.games.length + 1})` : base;
  }

  function startGame(t, m) {
    const n = m.games.length + 1;
    if (isBotAcc(m.a) && isBotAcc(m.b) && process.env.TOUR_BOT_SIM === '1') {
      m.status = 'playing';
      m.readyDeadline = null;
      m.games.push({ n, roomId: null, startedAt: now(), endedAt: null, winner: null, reason: null, simulated: true });
      event(t, 'game_start', { matchId: m.id, n });
      simulateBotGame(t.id, m.id, n);
      return;
    }
    const roomId = H('startGame')(t, m, n);
    if (!roomId) {
      // Alguém não está conectado agora: volta a esperar a confirmação dele
      ['a', 'b'].forEach(s => { if (!isBotAcc(m[s]) && !H('isOnline')(m[s])) m.ready[s] = false; });
      return;
    }
    m.status = 'playing';
    m.readyDeadline = null;
    m.games.push({ n, roomId, startedAt: now(), endedAt: null, winner: null, reason: null });
    event(t, 'game_start', { matchId: m.id, n });
  }

  // Resultado de uma partida (vem do servidor quando a sala termina). Idempotente.
  function reportGame(tid, matchId, n, winnerAccount, info = {}) {
    const t = items[tid];
    const m = t && t.matches[matchId];
    if (!m) return { error: 'confronto' };
    const g = m.games.find(x => x.n === n);
    if (!g || g.winner || m.status === 'done') return { ignored: true }; // já processado
    if (winnerAccount !== m.a && winnerAccount !== m.b) return { error: 'vencedor inválido' };
    g.winner = winnerAccount;
    g.endedAt = now();
    g.reason = info.reason || 'normal';
    g.durationMs = info.durationMs || (g.endedAt - g.startedAt);
    g.pausedMs = info.pausedMs || 0;
    g.disconnectMs = info.disconnectMs || 0;
    g.hands = info.hands || 0;
    g.score = info.score || null;
    g.stats = info.stats || null;
    const side = winnerAccount === m.a ? 'a' : 'b';
    m.wins[side]++;
    event(t, 'game_end', { matchId, n, winner: winnerAccount, reason: g.reason });
    const need = Math.ceil(m.bestOf / 2);
    if (m.wins[side] >= need) {
      decideMatch(t, m, winnerAccount, g.reason === 'abandono' ? 'abandono' : 'normal');
    } else {
      // Próxima partida da série depois do intervalo
      m.status = 'between';
      m.nextGameAt = now() + t.timers.betweenGamesMs;
      [m.a, m.b].forEach(acc => H('notify')(acc, { tid: t.id, type: 'series', matchId, message: `Série ${nameOf(t, m.a)} ${m.wins.a} x ${m.wins.b} ${nameOf(t, m.b)}. Próxima partida em ${Math.round(t.timers.betweenGamesMs / 1000)}s.` }));
    }
    changed(t);
    return { ok: true };
  }

  // Decide o confronto e leva o vencedor (e o perdedor da semi) adiante
  function decideMatch(t, m, winner, reason) {
    if (m.status === 'done' || m.status === 'void') return;
    m.status = winner ? 'done' : 'void';
    m.winner = winner || null;
    m.loser = winner ? (winner === m.a ? m.b : m.a) : null;
    m.reason = reason;
    m.endedAt = now();
    m.readyDeadline = null;
    event(t, 'match_end', { matchId: m.id, winner, reason });
    if (m.loser) {
      const lp = participant(t, m.loser);
      if (lp && !lp.disqualified) lp.status = 'eliminated';
    }
    if (winner) {
      [m.a, m.b].filter(Boolean).forEach(acc => H('notify')(acc, {
        tid: t.id, type: 'match_end', matchId: m.id,
        message: reason === 'bye' ? 'Você avançou direto (BYE).' : acc === winner ? `Você venceu o confronto${reason === 'wo' ? ' por W.O.' : ''}!` : `Você foi eliminado${reason === 'wo' ? ' por W.O.' : ''}.`
      }));
    }
    if (m.next) {
      const nm = t.matches[m.next.id];
      if (nm) fill(t, nm, m.next.side, winner);
    }
    if (m.loserNext) {
      const lm = t.matches[m.loserNext.id];
      // Duplo W.O. ou BYE na semifinal: aquela vaga do 3º lugar fica vazia
      if (lm) fill(t, lm, m.loserNext.side, m.loser || null);
    }
    checkFinished(t);
  }

  function checkFinished(t) {
    if (!t.bracket || !['running', 'paused'].includes(t.status)) return;
    const final = t.matches[t.bracket.rounds[t.bracket.totalRounds - 1][0]];
    const third = t.matches['3P'];
    const finalDone = final && ['done', 'void'].includes(final.status);
    const thirdDone = !third || ['done', 'void'].includes(third.status);
    if (finalDone && thirdDone) finalize(t, 'complete');
  }

  function finalize(t, how) {
    const final = t.bracket && t.matches[t.bracket.rounds[t.bracket.totalRounds - 1][0]];
    const third = t.matches['3P'];
    const res = { champion: null, runnerUp: null, third: [], fourth: null, placements: [], how };
    if (final && final.status === 'done') {
      res.champion = final.winner;
      res.runnerUp = final.loser;
    }
    if (third && third.status === 'done') {
      res.third = [third.winner];
      res.fourth = third.loser;
    } else if (!third && t.bracket && t.bracket.totalRounds >= 2) {
      res.third = t.bracket.rounds[t.bracket.totalRounds - 2].map(id => t.matches[id].loser).filter(Boolean);
    }
    // Classificação: quem foi mais longe fica na frente
    const reached = {};
    Object.values(t.matches).forEach(m => {
      if (m.third) return;
      [m.a, m.b].filter(Boolean).forEach(acc => { reached[acc] = Math.max(reached[acc] || 0, m.round + 1); });
    });
    const place = acc => {
      if (acc === res.champion) return 1;
      if (acc === res.runnerUp) return 2;
      if (res.third.includes(acc)) return 3;
      if (acc === res.fourth) return 4;
      return null;
    };
    res.placements = Object.keys(reached)
      .map(acc => ({ account: acc, name: nameOf(t, acc), place: place(acc), reachedRound: reached[acc] }))
      .sort((a, b) => (a.place || 99) - (b.place || 99) || b.reachedRound - a.reachedRound);
    t.results = res;
    t.status = 'finished';
    t.finishedAt = now();
    t.participants.forEach(p => { if (p.account === res.champion) p.status = 'champion'; });
    event(t, 'finish', { how });
    notifyAll(t, 'finished', res.champion ? `Campeonato encerrado! Campeão: ${nameOf(t, res.champion)}.` : 'Campeonato encerrado sem campeão.');
    changed(t, { list: true });
  }

  function recordGameAbort(tid, matchId, n, reason) {
    // Partida que não pôde ser concluída (servidor reiniciou): repete a partida
    const t = items[tid];
    const m = t && t.matches[matchId];
    if (!m) return;
    const g = m.games.find(x => x.n === n);
    if (!g || g.winner) return;
    m.games = m.games.filter(x => x !== g);
    event(t, 'game_abort', { matchId, n, reason });
    if (m.status === 'playing') {
      m.status = 'waiting';
      openReadyCheck(t, m);
    }
    changed(t);
  }

  const deadlinePassed = t => now() >= t.endAt;

  // ------------------------------------------------------------------ relógio
  function tick() {
    if (!loaded) return;
    const nowMs = now();
    Object.values(items).forEach(t => {
      try {
        tickOne(t, nowMs);
      } catch (e) {
        console.error('Erro no relógio do campeonato', t.id, e);
      }
    });
  }

  function tickOne(t, nowMs) {
    // Retenção dos sinais de multiconta
    if (t.finishedAt && t.signals.length && nowMs - t.finishedAt > SIGNAL_RETENTION_MS) {
      t.signals = [];
      persist(t);
    }
    if (['finished', 'cancelled'].includes(t.status) || isPaused(t)) return;
    if (t.status === 'registration' || t.status === 'checkin') {
      if (t.status === 'registration' && nowMs >= t.startAt - CHECKIN_WINDOW_MS) {
        t.status = 'checkin';
        notifyAll(t, 'checkin', t.checkinRequired
          ? `"${t.name}" começa em 15 minutos: confirme sua presença (check-in)!`
          : `"${t.name}" começa em 15 minutos!`);
        changed(t, { list: true });
      }
      if (nowMs >= t.startAt) begin(t);
      return;
    }
    if (t.status !== 'running') return;
    // Prazo final
    if (deadlinePassed(t) && !t.deadlineHit) {
      t.deadlineHit = true;
      event(t, 'deadline', { policy: t.deadlinePolicy });
      if (t.deadlinePolicy === 'extend') {
        t.endAt = nowMs + t.extendMinutes * 60000;
        t.deadlineHit = false;
        audit(t, 'sistema', 'prorrogar', `+${t.extendMinutes} min (prazo automático)`);
        notifyAll(t, 'extended', `O prazo acabou e o campeonato foi prorrogado em ${t.extendMinutes} minutos.`);
      } else if (t.deadlinePolicy === 'end_no_champion') {
        H('endRooms')(t);
        finalize(t, 'deadline');
        return;
      } else {
        notifyAll(t, 'deadline', 'O prazo do campeonato acabou: as partidas em andamento terminam, mas não começam novas.');
      }
      changed(t);
    }
    // Com prazo vencido (política "terminar as que estão em andamento"):
    // quando não há mais partidas rolando, encerra sem forçar campeão
    if (t.deadlineHit && t.deadlinePolicy === 'finish_running') {
      const running = Object.values(t.matches).some(m => m.status === 'playing' || m.status === 'between');
      if (!running) {
        Object.values(t.matches).forEach(m => { if (m.status === 'ready_check') m.status = 'blocked'; });
        finalize(t, 'deadline');
        return;
      }
    }
    Object.values(t.matches).forEach(m => {
      botAutoReady(t, m);
      if (m.status === 'ready_check' && m.readyDeadline && nowMs >= m.readyDeadline) {
        const a = m.ready.a, b = m.ready.b;
        if (a && !b) { woDecision(t, m, m.a, m.b); }
        else if (b && !a) { woDecision(t, m, m.b, m.a); }
        else if (!a && !b) {
          event(t, 'double_wo', { matchId: m.id });
          // Série em andamento e ninguém voltou: quem está na frente leva; empatada é duplo W.O.
          if (m.wins.a !== m.wins.b) decideMatch(t, m, m.wins.a > m.wins.b ? m.a : m.b, 'wo');
          else decideMatch(t, m, null, 'duplo_wo');
        }
        changed(t);
      }
      if (m.status === 'between' && m.nextGameAt && nowMs >= m.nextGameAt) {
        m.nextGameAt = null;
        m.status = 'waiting';
        if (t.deadlineHit && t.deadlinePolicy === 'finish_running') { m.status = 'blocked'; changed(t); return; }
        openReadyCheck(t, m);
        changed(t);
      }
    });
  }

  function woDecision(t, m, winner, loser) {
    event(t, 'wo', { matchId: m.id, winner, loser });
    if (!t.woEndsSeries && m.bestOf > 1) {
      // Só esta partida vai para quem estava pronto
      const side = winner === m.a ? 'a' : 'b';
      m.games.push({ n: m.games.length + 1, roomId: null, startedAt: now(), endedAt: now(), winner, reason: 'wo' });
      m.wins[side]++;
      if (m.wins[side] >= Math.ceil(m.bestOf / 2)) return decideMatch(t, m, winner, 'wo');
      m.status = 'between';
      m.nextGameAt = now() + t.timers.betweenGamesMs;
      return;
    }
    decideMatch(t, m, winner, 'wo');
  }

  // Depois de reiniciar: partidas que estavam em salas (que sumiram) voltam para a confirmação
  function recoverAfterRestart() {
    Object.values(items).forEach(t => {
      if (!['running', 'paused'].includes(t.status)) return;
      Object.values(t.matches).forEach(m => {
        if (m.status === 'playing') {
          const g = m.games[m.games.length - 1];
          if (g && !g.winner) m.games.pop();
          event(t, 'game_abort', { matchId: m.id, reason: 'reinicio' });
          m.status = 'waiting';
          if (t.status === 'running') openReadyCheck(t, m);
          else { m.status = 'ready_check'; m.ready = { a: false, b: false }; m.readyDeadline = (t.pause ? t.pause.at : now()) + t.timers.readyMs; }
        } else if (m.status === 'ready_check' && t.status === 'running') {
          // o relógio ficou parado enquanto o servidor estava fora: dá o prazo inteiro de novo
          m.ready = { a: false, b: false };
          m.readyDeadline = now() + t.timers.readyMs;
        }
      });
      persist(t);
    });
  }

  // ------------------------------------------------------------------ multicontas
  function addSignal(t, account, kind, signal) {
    if (!signal || !secret) return;
    const h = v => (v ? crypto.createHmac('sha256', secret).update(String(v)).digest('hex').slice(0, 16) : null);
    t.signals.push({ at: now(), account, kind, ip: h(signal.ip), device: h(signal.device), ua: h(signal.ua) });
    if (t.signals.length > 3000) t.signals.shift();
  }

  // Contas do mesmo campeonato que dividiram aparelho ou rede
  function multiAccountReport(id) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    const byKey = {};
    t.signals.forEach(s => {
      ['device', 'ip'].forEach(kind => {
        if (!s[kind]) return;
        const k = `${kind}:${s[kind]}`;
        byKey[k] = byKey[k] || { kind, accounts: new Set(), times: [] };
        byKey[k].accounts.add(s.account);
        byKey[k].times.push(s.at);
      });
    });
    const pairs = {};
    Object.values(byKey).forEach(g => {
      const accs = [...g.accounts].sort();
      for (let i = 0; i < accs.length; i++) for (let j = i + 1; j < accs.length; j++) {
        const k = `${accs[i]}|${accs[j]}`;
        pairs[k] = pairs[k] || { accounts: [accs[i], accs[j]], names: [nameOf(t, accs[i]), nameOf(t, accs[j])], sameDevice: 0, sameIp: 0, lastAt: 0 };
        if (g.kind === 'device') pairs[k].sameDevice++;
        else pairs[k].sameIp++;
        pairs[k].lastAt = Math.max(pairs[k].lastAt, ...g.times);
      }
    });
    // Troca de aparelho de uma mesma conta durante o campeonato
    const devicesOf = {};
    t.signals.forEach(s => { if (s.device) { devicesOf[s.account] = devicesOf[s.account] || new Set(); devicesOf[s.account].add(s.device); } });
    const deviceChanges = Object.entries(devicesOf).filter(([, set]) => set.size > 2).map(([acc, set]) => ({ account: acc, name: nameOf(t, acc), devices: set.size }));
    const list = Object.values(pairs).map(p => ({ ...p, level: p.sameDevice ? 'alto' : 'baixo' }))
      .sort((a, b) => b.sameDevice - a.sameDevice || b.sameIp - a.sameIp);
    return { ok: true, pairs: list, deviceChanges, decisions: t.decisions, retentionDays: SIGNAL_RETENTION_MS / 86400000, signals: t.signals.length };
  }

  // ------------------------------------------------------------------ estatísticas
  function statsOf(t) {
    const games = [];
    Object.values(t.matches || {}).forEach(m => m.games.forEach(g => { if (g.winner) games.push({ ...g, match: m }); }));
    const played = games.filter(g => g.roomId);
    const effective = g => Math.max(0, (g.durationMs || 0) - (g.pausedMs || 0));
    const matches = Object.values(t.matches || {});
    const doneMatches = matches.filter(m => m.status === 'done' && m.reason !== 'bye');
    const byPhase = {};
    played.forEach(g => { const k = ROUND_NAMES[g.match.key] || g.match.key; byPhase[k] = (byPhase[k] || 0) + 1; });
    const matchDur = m => (m.games.filter(g => g.roomId && g.winner).reduce((s, g) => s + effective(g), 0));
    const wo = matches.filter(m => m.reason === 'wo').length + matches.filter(m => m.reason === 'duplo_wo').length;
    const discEvents = t.events.filter(e => e.type === 'disconnect').length;
    const general = {
      registered: t.participants.length,
      confirmed: t.participants.filter(p => !t.checkinRequired || p.checkedIn).length,
      gamesPlayed: played.length,
      matchesDone: doneMatches.length,
      totalMs: t.startedAt ? (t.finishedAt || now()) - t.startedAt - (t.pausedTotalMs || 0) : 0,
      avgGameMs: played.length ? Math.round(played.reduce((s, g) => s + effective(g), 0) / played.length) : null,
      avgMatchMs: doneMatches.filter(m => matchDur(m)).length ? Math.round(doneMatches.reduce((s, m) => s + matchDur(m), 0) / doneMatches.filter(m => matchDur(m)).length) : null,
      wo: matches.filter(m => m.reason === 'wo').length,
      doubleWo: matches.filter(m => m.reason === 'duplo_wo').length,
      disconnects: discEvents,
      normalGames: played.filter(g => g.reason === 'normal').length,
      abandonedGames: played.filter(g => g.reason === 'abandono').length,
      byPhase
    };
    // Recordes
    const sortedGames = played.slice().sort((a, b) => effective(b) - effective(a));
    const withDur = doneMatches.filter(m => matchDur(m) > 0).sort((a, b) => matchDur(b) - matchDur(a));
    const gLabel = g => ({ matchId: g.match.id, phase: ROUND_NAMES[g.match.key] || g.match.key, n: g.n, players: [nameOf(t, g.match.a), nameOf(t, g.match.b)], ms: effective(g) });
    const mLabel = m => ({ matchId: m.id, phase: ROUND_NAMES[m.key] || m.key, players: [nameOf(t, m.a), nameOf(t, m.b)], ms: matchDur(m), score: `${m.wins.a}x${m.wins.b}` });
    // Maior virada: série vencida por quem chegou a estar atrás por mais partidas
    let comeback = null;
    doneMatches.filter(m => m.bestOf > 1).forEach(m => {
      let a = 0, b = 0, worst = 0;
      m.games.forEach(g => {
        if (g.winner === m.a) a++; else if (g.winner === m.b) b++;
        const deficit = m.winner === m.a ? b - a : a - b;
        worst = Math.max(worst, deficit);
      });
      if (worst > 0 && (!comeback || worst > comeback.deficit)) comeback = { ...mLabel(m), deficit: worst, winner: nameOf(t, m.winner) };
    });
    const ind = individualStats(t);
    const streaks = Object.values(ind).sort((a, b) => b.bestStreak - a.bestStreak)[0];
    const mostGames = Object.values(ind).sort((a, b) => b.games - a.games)[0];
    const mostTime = Object.values(ind).sort((a, b) => b.timeMs - a.timeMs)[0];
    const records = {
      longestGame: sortedGames[0] ? gLabel(sortedGames[0]) : null,
      fastestGame: sortedGames.length ? gLabel(sortedGames[sortedGames.length - 1]) : null,
      longestMatch: withDur[0] ? mLabel(withDur[0]) : null,
      fastestMatch: withDur.length ? mLabel(withDur[withDur.length - 1]) : null,
      bestStreak: streaks && streaks.bestStreak ? { name: streaks.name, value: streaks.bestStreak } : null,
      mostGames: mostGames && mostGames.games ? { name: mostGames.name, value: mostGames.games } : null,
      mostTime: mostTime && mostTime.timeMs ? { name: mostTime.name, ms: mostTime.timeMs } : null,
      biggestComeback: comeback
    };
    return { general, records, individual: Object.values(ind) };
  }

  function individualStats(t) {
    const ind = {};
    const get = acc => (ind[acc] = ind[acc] || { account: acc, name: nameOf(t, acc), games: 0, wins: 0, losses: 0, timeMs: 0, handsWon: 0, handsLost: 0, trucoCalls: 0, trucoAccepted: 0, trucoRefused: 0, woWins: 0, woLosses: 0, disconnects: 0, streak: 0, bestStreak: 0 });
    const ordered = [];
    Object.values(t.matches || {}).forEach(m => m.games.forEach(g => { if (g.winner) ordered.push({ g, m }); }));
    ordered.sort((x, y) => (x.g.endedAt || 0) - (y.g.endedAt || 0));
    ordered.forEach(({ g, m }) => {
      if (!g.roomId) return; // W.O. de uma partida da série conta abaixo
      [m.a, m.b].forEach(acc => {
        const s = get(acc);
        s.games++;
        const won = g.winner === acc;
        if (won) { s.wins++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); } else { s.losses++; s.streak = 0; }
        s.timeMs += Math.max(0, (g.durationMs || 0) - (g.pausedMs || 0));
        const st = g.stats && g.stats[acc];
        if (st) {
          s.handsWon += st.handsWon || 0;
          s.handsLost += st.handsLost || 0;
          s.trucoCalls += st.trucoCalls || 0;
          s.trucoAccepted += st.trucoAccepted || 0;
          s.trucoRefused += st.trucoRefused || 0;
        }
      });
    });
    Object.values(t.matches || {}).forEach(m => {
      if (m.reason === 'wo') { get(m.winner).woWins++; get(m.loser).woLosses++; }
      if (m.reason === 'duplo_wo') { if (m.a) get(m.a).woLosses++; if (m.b) get(m.b).woLosses++; }
    });
    t.events.filter(e => e.type === 'disconnect' && e.account).forEach(e => { get(e.account).disconnects++; });
    Object.values(ind).forEach(s => {
      s.winRate = s.games ? Math.round((100 * s.wins) / s.games) : null;
      s.avgGameMs = s.games ? Math.round(s.timeMs / s.games) : null;
      delete s.streak;
    });
    return ind;
  }

  // Recordes entre todos os campeonatos e a melhor colocação de cada jogador
  function globalStats(account) {
    const finished = Object.values(items).filter(t => t.status === 'finished' && t.startedAt);
    const dur = t => t.finishedAt - t.startedAt - (t.pausedTotalMs || 0);
    const sorted = finished.slice().sort((a, b) => dur(b) - dur(a));
    const mine = account ? finished.map(t => {
      const p = t.results && t.results.placements.find(x => x.account === account);
      return p ? { id: t.id, name: t.name, at: t.finishedAt, place: p.place, reachedRound: p.reachedRound, totalRounds: t.bracket.totalRounds } : null;
    }).filter(Boolean) : [];
    const best = mine.filter(m => m.place).sort((a, b) => a.place - b.place)[0] || null;
    return {
      longestTournament: sorted[0] ? { name: sorted[0].name, ms: dur(sorted[0]) } : null,
      fastestTournament: sorted.length ? { name: sorted[sorted.length - 1].name, ms: dur(sorted[sorted.length - 1]) } : null,
      myHistory: mine.sort((a, b) => b.at - a.at),
      myBestPlace: best
    };
  }

  // ------------------------------------------------------------------ vistas
  function publicView(t, account, opts = {}) {
    const me = account ? participant(t, account) : null;
    const canSee = !t.isPrivate || me || opts.admin || opts.unlocked;
    const base = {
      id: t.id, name: t.name, isPrivate: t.isPrivate, status: t.status, mode: t.mode,
      maxPlayers: t.maxPlayers, registered: t.participants.length, startAt: t.startAt, endAt: t.endAt,
      locked: !canSee
    };
    if (!canSee) return base;
    // Depois que começa, a chave é só para quem joga (e para o admin)
    if (!me && !opts.admin && !['registration', 'checkin'].includes(t.status)) {
      return { ...base, restricted: true, maxPoints: t.maxPoints, serverNow: now() };
    }
    const myMatch = me ? Object.values(t.matches || {}).find(m => (m.a === account || m.b === account) && !['done', 'void'].includes(m.status) && m.status !== 'waiting') : null;
    return {
      ...base,
      description: t.description,
      allowEarlyStart: t.allowEarlyStart,
      checkinRequired: t.checkinRequired,
      thirdPlace: t.thirdPlace,
      maxPoints: t.maxPoints,
      bestOf: t.bestOf,
      timers: t.timers,
      deadlinePolicy: t.deadlinePolicy,
      extendMinutes: t.extendMinutes,
      woEndsSeries: t.woEndsSeries,
      manualRounds: !!t.manualRounds,
      nextHold: nextHeldPhase(t),
      checkinOpensAt: t.startAt - CHECKIN_WINDOW_MS,
      startedAt: t.startedAt || null,
      finishedAt: t.finishedAt || null,
      pause: t.pause ? { at: t.pause.at, message: t.pause.message } : null,
      cancelReason: t.cancelReason || null,
      participants: t.participants.map(p => ({ account: p.account, name: p.name, checkedIn: p.checkedIn, status: p.status, bot: isBotAcc(p.account) })),
      bracket: t.bracket,
      matches: Object.fromEntries(Object.values(t.matches || {}).map(m => [m.id, {
        id: m.id, round: m.round, slot: m.slot, key: m.key, third: !!m.third, bestOf: m.bestOf,
        a: m.a, b: m.b, aName: m.a ? nameOf(t, m.a) : null, bName: m.b ? nameOf(t, m.b) : null,
        aFilled: m.aFilled, bFilled: m.bFilled, status: m.status, wins: m.wins, winner: m.winner, reason: m.reason,
        ready: m.ready, readyDeadline: m.readyDeadline, nextGameAt: m.nextGameAt || null, held: !!m.held,
        games: m.games.map(g => ({ n: g.n, winner: g.winner, reason: g.reason, roomId: g.endedAt ? null : g.roomId, score: g.score, durationMs: g.durationMs ? Math.max(0, g.durationMs - (g.pausedMs || 0)) : null })),
        startedAt: m.startedAt, endedAt: m.endedAt
      }])),
      results: t.results,
      me: me ? { account, status: me.status, checkedIn: me.checkedIn, match: myMatch ? myMatch.id : null } : null,
      roundNames: ROUND_NAMES,
      serverNow: now()
    };
  }

  function list(account, admin) {
    return Object.values(items)
      .filter(t => admin || !t.isPrivate || (account && participant(t, account)))
      .map(t => publicView(t, account, { admin }))
      .map(v => ({ id: v.id, name: v.name, isPrivate: v.isPrivate, status: v.status, maxPlayers: v.maxPlayers, registered: v.registered, startAt: v.startAt, endAt: v.endAt, mine: !!(v.me), description: v.description || '', manualRounds: !!v.manualRounds, nextHold: admin ? v.nextHold || null : null }))
      .sort((a, b) => {
        const order = { running: 0, paused: 0, checkin: 1, registration: 2, finished: 3, cancelled: 4 };
        return (order[a.status] - order[b.status]) || (a.status === 'finished' ? b.startAt - a.startAt : a.startAt - b.startAt);
      });
  }

  function view(id, account, password, admin) {
    const t = items[id];
    if (!t) return { error: 'Campeonato não encontrado.' };
    const unlocked = t.isPrivate && password ? checkPassword(password, t.pass) : false;
    if (t.isPrivate && password && !unlocked) return { error: 'Senha incorreta.' };
    const v = publicView(t, account, { admin, unlocked });
    if (!v.locked && !v.restricted) v.stats = statsOf(t);
    if (admin) { v.audit = t.audit.slice(-100); }
    return { ok: true, tournament: v };
  }

  // Campeonatos em que a conta está (para a tela inicial)
  function mine(account) {
    const out = [];
    Object.values(items).forEach(t => {
      const me = participant(t, account);
      if (!me) return;
      const recent = t.finishedAt && now() - t.finishedAt < 6 * 3600000;
      if (['finished', 'cancelled'].includes(t.status) && !recent) return;
      const m = Object.values(t.matches || {}).find(x => (x.a === account || x.b === account) && ['ready_check', 'playing', 'between'].includes(x.status));
      const side = m ? (m.a === account ? 'a' : 'b') : null;
      out.push({
        id: t.id, name: t.name, status: t.status, startAt: t.startAt, myStatus: me.status,
        match: m ? { id: m.id, status: m.status, iReady: !!m.ready[side], opponent: nameOf(t, side === 'a' ? m.b : m.a), wins: m.wins[side], losses: m.wins[side === 'a' ? 'b' : 'a'], label: ROUND_NAMES[m.key] || m.key } : null,
        champion: t.results && t.results.champion ? nameOf(t, t.results.champion) : null
      });
    });
    return out.sort((x, y) => x.startAt - y.startAt);
  }

  function notifyAll(t, type, message) {
    t.participants.forEach(p => H('notify')(p.account, { tid: t.id, type, message }));
  }

  function noteDisconnect(tid, account) {
    const t = items[tid];
    if (!t) return;
    event(t, 'disconnect', { account });
    persist(t);
  }

  const timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();

  return {
    ready,
    get: id => items[id] || null,
    all: () => Object.values(items),
    list, view, create, update, pause, resume, cancel, finishNow, extend, startEarly, disqualify, decide, remove, addBots, removeBots, isBotAcc, mine, releaseRound,
    register, unregister, checkin, setReady, reportGame, recordGameAbort, noteDisconnect,
    multiAccountReport, globalStats, statsOf, tick,
    constants: { SIZES, BEST_OF, ROUND_NAMES, DEFAULT_TIMERS, DEADLINE_POLICIES }
  };
}

module.exports = { createTournaments, seedOrder };
