// public/js/tournaments.js
// Campeonatos: lista no menu, página do campeonato (inscrição, check-in,
// "estou pronto", chave, participantes, estatísticas), avisos e painel do admin.
// Tudo é decidido pelo servidor; aqui só mostra e manda os pedidos.
// Usa `socket`, `CLIENT_ID`, `escapeText`, `goHomeScreen` e `lastGameState` do app.js.

(() => {
  const $ = id => document.getElementById(id);
  const modal = $('modal-tour');
  const body = $('tour-body');
  const toast = (html, opts) => window.trucoSocial && window.trucoSocial.toast(html, opts);
  const esc = v => escapeText(v == null ? '' : String(v));

  const STATUS = {
    registration: ['Inscrições abertas', 'open'],
    checkin: ['Check-in aberto', 'checkin'],
    running: ['Em andamento', 'live'],
    paused: ['Pausado', 'paused'],
    finished: ['Encerrado', 'done'],
    cancelled: ['Cancelado', 'cancelled']
  };
  const REASON = { normal: '', wo: 'W.O.', duplo_wo: 'Duplo W.O.', bye: 'BYE', vaga_vazia: 'Vaga vazia', vazio: 'Vazio', abandono: 'Abandono', desclassificacao: 'Desclassificação' };
  const fmtDate = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDur = ms => {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}min ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}min`;
  };

  let current = null;       // id aberto
  let data = null;          // último detalhe recebido
  let tab = 'bracket';
  let password = '';
  let clockSkew = 0;        // servidor - navegador
  let tick = null;
  let listData = null;

  // ---------------------------------------------------------------- lista
  function openList() {
    current = null;
    data = null;
    modal.classList.remove('hide');
    renderLoading();
    socket.emit('tour:list', {}, res => {
      listData = res && res.ok ? res : { items: [], global: null };
      renderList();
      paintHomeCount();
    });
  }

  function renderLoading() { body.innerHTML = '<p class="tour-empty"><span class="wait-spin"></span> Carregando…</p>'; }

  function statusChip(st) {
    const [label, cls] = STATUS[st] || [st, ''];
    return `<span class="tour-status ${cls}">${label}</span>`;
  }

  function renderList() {
    const items = (listData && listData.items) || [];
    const groups = [
      ['Acontecendo agora', items.filter(t => ['running', 'paused'].includes(t.status))],
      ['Próximos', items.filter(t => ['registration', 'checkin'].includes(t.status))],
      ['Encerrados', items.filter(t => ['finished', 'cancelled'].includes(t.status)).slice(0, 10)]
    ];
    const card = t => `
      <li class="tour-card ${t.mine ? 'mine' : ''}">
        <div class="tour-card-head">
          <b>${esc(t.name)}</b>${t.isPrivate ? ' <i class="fa-solid fa-lock" title="Privado"></i>' : ''}
          ${statusChip(t.status)}
        </div>
        <div class="tour-card-meta">
          <span><i class="fa-regular fa-calendar"></i> ${fmtDate(t.startAt)}</span>
          <span><i class="fa-solid fa-users"></i> ${t.registered}/${t.maxPlayers}</span>
          ${t.mine ? '<span class="tour-mine"><i class="fa-solid fa-check"></i> Você está inscrito</span>' : ''}
        </div>
        <button type="button" class="btn btn-sm btn-primary" data-tour-open="${esc(t.id)}">Ver campeonato</button>
      </li>`;
    const g = listData && listData.global;
    const best = g && g.myBestPlace ? `<p class="tour-best"><i class="fa-solid fa-medal"></i> Sua melhor colocação: <b>${g.myBestPlace.place}º</b> em ${esc(g.myBestPlace.name)}</p>` : '';
    const hist = g && g.myHistory && g.myHistory.length ? `
      <h3 class="tour-sub">Seus campeonatos anteriores</h3>
      <ul class="tour-hist">${g.myHistory.slice(0, 10).map(h => `<li><button type="button" class="link-btn" data-tour-open="${esc(h.id)}">${esc(h.name)}</button> <span>${h.place ? `${h.place}º lugar` : `chegou na fase ${h.reachedRound}/${h.totalRounds}`}</span></li>`).join('')}</ul>` : '';
    body.innerHTML = `
      ${groups.map(([title, list]) => list.length ? `<h3 class="tour-sub">${title}</h3><ul class="tour-list">${list.map(card).join('')}</ul>` : '').join('')}
      ${items.length ? '' : '<p class="tour-empty"><i class="fa-solid fa-trophy"></i> Nenhum campeonato por enquanto. Fique de olho!</p>'}
      <form class="tour-code" id="tour-code-form" autocomplete="off">
        <input type="text" id="tour-code" maxlength="8" placeholder="Código do campeonato privado" aria-label="Código do campeonato">
        <input type="password" id="tour-pass" maxlength="64" placeholder="Senha" aria-label="Senha do campeonato">
        <button type="submit" class="btn btn-sm btn-secondary">Entrar</button>
      </form>
      <p class="form-msg" id="tour-code-msg"></p>
      ${best}${hist}`;
    $('tour-code-form').addEventListener('submit', e => {
      e.preventDefault();
      const code = $('tour-code').value.trim().toUpperCase();
      password = $('tour-pass').value;
      if (code) openTour(code);
    });
  }

  // ---------------------------------------------------------------- detalhe
  function openTour(id, opts = {}) {
    current = id;
    if (opts.tab) tab = opts.tab;
    modal.classList.remove('hide');
    if (!data || data.id !== id) renderLoading();
    load();
  }

  function load() {
    if (!current) return;
    const id = current;
    socket.emit('tour:view', { id, password }, res => {
      if (current !== id) return;
      if (!res || res.error) {
        body.innerHTML = `<p class="tour-empty">${esc((res && res.error) || 'Não deu para abrir.')}</p><button type="button" class="link-btn" data-tour-back>← Voltar</button>`;
        return;
      }
      data = res.tournament;
      clockSkew = (data.serverNow || Date.now()) - Date.now();
      renderDetail();
    });
  }

  const sNow = () => Date.now() + clockSkew;
  const left = ms => Math.max(0, ms - sNow());

  function myMatch() {
    if (!data || !data.me || !data.me.match) return null;
    return data.matches[data.me.match] || null;
  }

  function actionCard() {
    const d = data;
    const me = d.me;
    const logged = window.trucoSocial && window.trucoSocial.isLogged && window.trucoSocial.isLogged();
    if (['finished', 'cancelled'].includes(d.status)) return '';
    if (!me) {
      if (!['registration', 'checkin'].includes(d.status)) return '';
      if (!logged) return `<div class="tour-action"><p>Entre na sua conta para participar.</p><button type="button" class="btn btn-primary" data-tour-act="login">Entrar</button></div>`;
      const full = d.registered >= d.maxPlayers;
      return `<div class="tour-action"><p>${full ? 'As vagas acabaram.' : `${d.maxPlayers - d.registered} vagas disponíveis.`}</p>
        ${full ? '' : '<button type="button" class="btn btn-primary" data-tour-act="register"><i class="fa-solid fa-pen-to-square"></i> Inscrever-se</button>'}</div>`;
    }
    if (['registration', 'checkin'].includes(d.status)) {
      const canCheck = d.checkinRequired && sNow() >= d.checkinOpensAt;
      return `<div class="tour-action">
        <p><i class="fa-solid fa-check"></i> Você está inscrito.${d.checkinRequired ? (me.checkedIn ? ' <b>Presença confirmada!</b>' : ` O check-in abre ${fmtDate(d.checkinOpensAt)} (15 min antes).`) : ''}</p>
        <div class="tour-action-btns">
          ${d.checkinRequired && !me.checkedIn ? `<button type="button" class="btn btn-primary" data-tour-act="checkin" ${canCheck ? '' : 'disabled'}><i class="fa-solid fa-circle-check"></i> Confirmar presença</button>` : ''}
          <button type="button" class="btn btn-sm btn-secondary" data-tour-act="unregister">Cancelar inscrição</button>
        </div></div>`;
    }
    const m = myMatch();
    if (!m) {
      const out = ['eliminated', 'absent', 'disqualified'].includes(me.status);
      return `<div class="tour-action"><p>${out ? 'Você está fora do campeonato. Acompanhe a chave!' : me.status === 'champion' ? 'Você é o campeão!' : 'Aguardando o seu próximo confronto…'}</p></div>`;
    }
    const mine = m.a === me.account ? 'a' : 'b';
    const opp = mine === 'a' ? m.bName : m.aName;
    const series = m.bestOf > 1 ? `<span class="tour-series">MD${m.bestOf} · ${m.wins[mine]} x ${m.wins[mine === 'a' ? 'b' : 'a']}</span>` : '';
    if (m.status === 'ready_check') {
      const iReady = m.ready[mine];
      return `<div class="tour-action next ${iReady ? 'ok' : 'urgent'}">
        <small>Seu próximo confronto · ${esc(d.roundNames[m.key] || m.key)}</small>
        <b class="tour-vs">Você × ${esc(opp)}</b>${series}
        <p>${iReady ? 'Você confirmou. Esperando o adversário…' : 'Confirme que está pronto para entrar na partida.'} <b class="tour-countdown" data-deadline="${m.readyDeadline}">${fmtDur(left(m.readyDeadline))}</b></p>
        ${iReady ? '' : '<button type="button" class="btn btn-primary btn-large" data-tour-act="ready"><i class="fa-solid fa-play"></i> Estou pronto</button>'}
        <small class="tour-wo-note">Quem não confirmar no prazo perde por W.O.</small>
      </div>`;
    }
    if (m.status === 'between') {
      return `<div class="tour-action next"><small>Série em andamento</small><b class="tour-vs">Você × ${esc(opp)}</b>${series}
        <p>Próxima partida em <b class="tour-countdown" data-deadline="${m.nextGameAt}">${fmtDur(left(m.nextGameAt))}</b></p></div>`;
    }
    if (m.status === 'playing') {
      return `<div class="tour-action next"><small>Partida em andamento</small><b class="tour-vs">Você × ${esc(opp)}</b>${series}</div>`;
    }
    return '';
  }

  function renderDetail() {
    const d = data;
    if (d.locked) {
      body.innerHTML = `
        <button type="button" class="link-btn" data-tour-back>← Campeonatos</button>
        <h2 class="tour-title">${esc(d.name)} <i class="fa-solid fa-lock"></i></h2>
        <p>Este campeonato é privado. Digite a senha para ver e se inscrever.</p>
        <form class="tour-code" id="tour-unlock" autocomplete="off">
          <input type="password" id="tour-unlock-pass" maxlength="64" placeholder="Senha" aria-label="Senha">
          <button type="submit" class="btn btn-sm btn-primary">Abrir</button>
        </form>`;
      $('tour-unlock').addEventListener('submit', e => { e.preventDefault(); password = $('tour-unlock-pass').value; load(); });
      return;
    }
    const pause = d.pause ? `<div class="tour-pause"><i class="fa-solid fa-circle-pause"></i> <b>Campeonato pausado.</b> ${esc(d.pause.message)}</div>` : '';
    const results = d.results ? resultsBox() : '';
    body.innerHTML = `
      <button type="button" class="link-btn" data-tour-back>← Campeonatos</button>
      <div class="tour-head">
        <h2 class="tour-title">${esc(d.name)}</h2>
        ${statusChip(d.status)}
      </div>
      <div class="tour-meta">
        <span><i class="fa-regular fa-calendar"></i> Início: ${fmtDate(d.startAt)}</span>
        <span><i class="fa-regular fa-clock"></i> Prazo: ${fmtDate(d.endAt)}</span>
        <span><i class="fa-solid fa-users"></i> ${d.registered}/${d.maxPlayers}</span>
        ${d.isPrivate ? '<span><i class="fa-solid fa-lock"></i> Privado</span>' : ''}
      </div>
      ${d.description ? `<p class="tour-desc">${esc(d.description)}</p>` : ''}
      ${d.cancelReason ? `<div class="tour-pause">Cancelado: ${esc(d.cancelReason)}</div>` : ''}
      ${pause}
      ${actionCard()}
      ${results}
      <div class="tour-tabs" role="tablist">
        ${[['bracket', 'Chave'], ['players', 'Participantes'], ['stats', 'Estatísticas'], ['rules', 'Regras']].map(([k, l]) => `<button type="button" class="tour-tab ${tab === k ? 'active' : ''}" data-tour-tab="${k}">${l}</button>`).join('')}
      </div>
      <div class="tour-pane">${tab === 'bracket' ? bracketHtml() : tab === 'players' ? playersHtml() : tab === 'stats' ? statsHtml() : rulesHtml()}</div>`;
    startTick();
  }

  function resultsBox() {
    const r = data.results;
    const nm = acc => esc((data.participants.find(p => p.account === acc) || {}).name || acc);
    if (!r.champion) return `<div class="tour-results"><b>Encerrado sem campeão</b> ${r.how === 'deadline' ? '(o prazo acabou antes da final)' : ''}</div>`;
    return `<div class="tour-results">
      <div class="tour-podium">
        <div class="p2"><i class="fa-solid fa-medal"></i><b>${r.runnerUp ? nm(r.runnerUp) : '—'}</b><small>Vice</small></div>
        <div class="p1"><i class="fa-solid fa-trophy"></i><b>${nm(r.champion)}</b><small>Campeão</small></div>
        <div class="p3"><i class="fa-solid fa-medal"></i><b>${r.third.length ? r.third.map(nm).join(' / ') : '—'}</b><small>3º lugar</small></div>
      </div>
    </div>`;
  }

  // Chave: colunas por fase, confrontos em pares ligados por linhas
  function bracketHtml() {
    const d = data;
    if (!d.bracket) return `<p class="tour-empty">A chave é sorteada quando o campeonato começa (só entra quem ${d.checkinRequired ? 'confirmar presença' : 'estiver inscrito'}).</p>`;
    const meAcc = d.me && d.me.account;
    const matchBox = m => {
      const side = s => {
        const acc = m[s];
        const name = m[s + 'Name'];
        const filled = m[s + 'Filled'];
        const win = m.winner && m.winner === acc;
        const lose = m.status === 'done' && acc && !win;
        const label = acc ? esc(name) : filled ? (m.reason === 'bye' ? '<i>BYE</i>' : '<i>vaga vazia</i>') : '<i>a definir</i>';
        return `<div class="bm-side ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${acc && acc === meAcc ? 'me' : ''}"><span>${label}</span><b>${m.bestOf > 1 || m.status !== 'waiting' ? m.wins[s] : ''}</b></div>`;
      };
      const reason = REASON[m.reason] ? `<em class="bm-reason">${REASON[m.reason]}</em>` : '';
      const live = m.games.find(g => g.roomId);
      return `<div class="bm ${m.status} ${m.reason || ''}">
        ${side('a')}${side('b')}
        <div class="bm-foot">${m.bestOf > 1 ? `MD${m.bestOf}` : ''}${reason}${live ? ` <button type="button" class="link-btn bm-watch" data-tour-watch="${esc(live.roomId)}"><i class="fa-solid fa-eye"></i> Assistir</button>` : m.status === 'ready_check' ? ' <span class="bm-wait">esperando</span>' : ''}</div>
      </div>`;
    };
    const cols = d.bracket.rounds.map((ids, r) => {
      const key = d.matches[ids[0]].key;
      const pairs = [];
      for (let i = 0; i < ids.length; i += 2) pairs.push(ids.slice(i, i + 2));
      return `<div class="br-col">
        <div class="br-title">${esc(d.roundNames[key] || key)}</div>
        <div class="br-body">${pairs.map(p => `<div class="br-pair ${p.length === 2 ? 'two' : 'one'}">${p.map(id => `<div class="br-slot">${matchBox(d.matches[id])}</div>`).join('')}</div>`).join('')}</div>
      </div>`;
    }).join('');
    const third = d.matches['3P'] ? `<div class="br-third"><div class="br-title">${esc(d.roundNames['3P'])}</div>${matchBox(d.matches['3P'])}</div>` : '';
    return `<div class="bracket-wrap"><div class="bracket">${cols}</div>${third}</div>
      <div class="br-legend"><span class="lg live">Em andamento</span><span class="lg ready_check">Esperando confirmação</span><span class="lg done">Finalizado</span><span class="lg wo">W.O.</span><span class="lg bye">BYE</span></div>`;
  }

  function playersHtml() {
    const ST = { registered: 'Inscrito', checked_in: 'Confirmado', playing: 'Jogando', eliminated: 'Eliminado', absent: 'Não confirmou', disqualified: 'Desclassificado', champion: 'Campeão' };
    const place = acc => { const p = data.results && data.results.placements.find(x => x.account === acc); return p && p.place ? `${p.place}º` : ''; };
    return `<ul class="tour-players">${data.participants.map(p => `
      <li class="${p.status}"><b>${esc(p.name)}</b><span>${place(p.account)} ${ST[p.status] || p.status}${data.checkinRequired && p.checkedIn && ['registration', 'checkin'].includes(data.status) ? ' ✓' : ''}</span></li>`).join('') || '<li class="tour-empty">Ninguém inscrito ainda.</li>'}</ul>`;
  }

  function statsHtml() {
    const s = data.stats;
    if (!s) return '<p class="tour-empty">Sem estatísticas ainda.</p>';
    const g = s.general;
    const r = s.records;
    const row = (l, v) => `<div class="st-row"><span>${l}</span><b>${v}</b></div>`;
    const rec = (l, x, fmt) => x ? row(l, fmt(x)) : '';
    return `
      <div class="st-grid">
        <section><h4>Geral</h4>
          ${row('Inscritos', g.registered)}${row('Confirmados', g.confirmed)}${row('Partidas disputadas', g.gamesPlayed)}
          ${row('Confrontos concluídos', g.matchesDone)}${row('Tempo total (sem pausas)', fmtDur(g.totalMs))}
          ${row('Tempo médio por partida', fmtDur(g.avgGameMs))}${row('Tempo médio por confronto', fmtDur(g.avgMatchMs))}
          ${row('W.O.', g.wo)}${row('Duplo W.O.', g.doubleWo)}${row('Desconexões', g.disconnects)}
          ${row('Partidas até o fim', g.normalGames)}${row('Partidas por abandono', g.abandonedGames)}
          ${Object.entries(g.byPhase).map(([k, v]) => row(`Partidas · ${esc(k)}`, v)).join('')}
        </section>
        <section><h4>Recordes</h4>
          ${rec('Partida mais longa', r.longestGame, x => `${fmtDur(x.ms)} · ${esc(x.players.join(' × '))}`)}
          ${rec('Partida mais rápida', r.fastestGame, x => `${fmtDur(x.ms)} · ${esc(x.players.join(' × '))}`)}
          ${rec('Confronto mais longo', r.longestMatch, x => `${fmtDur(x.ms)} · ${esc(x.players.join(' × '))}`)}
          ${rec('Confronto mais rápido', r.fastestMatch, x => `${fmtDur(x.ms)} · ${esc(x.players.join(' × '))}`)}
          ${rec('Maior sequência de vitórias', r.bestStreak, x => `${x.value} · ${esc(x.name)}`)}
          ${rec('Mais partidas jogadas', r.mostGames, x => `${x.value} · ${esc(x.name)}`)}
          ${rec('Mais tempo em partidas', r.mostTime, x => `${fmtDur(x.ms)} · ${esc(x.name)}`)}
          ${rec('Maior virada', r.biggestComeback, x => `${esc(x.winner)} (${x.score}, estava ${x.deficit} atrás)`)}
          ${Object.values(r).every(v => !v) ? '<p class="tour-empty">Os recordes aparecem conforme as partidas terminam.</p>' : ''}
        </section>
      </div>
      <h4 class="tour-sub">Jogadores</h4>
      <div class="st-table-wrap"><table class="st-table">
        <thead><tr><th>Jogador</th><th>Partidas</th><th>V</th><th>D</th><th>%</th><th>Tempo médio</th><th>Mãos V/D</th><th>Truco pedido/aceito/recusado</th><th>W.O. V/D</th><th>Quedas</th></tr></thead>
        <tbody>${s.individual.sort((a, b) => b.wins - a.wins || b.games - a.games).map(i => `<tr>
          <td>${esc(i.name)}</td><td>${i.games}</td><td>${i.wins}</td><td>${i.losses}</td><td>${i.winRate == null ? '—' : i.winRate + '%'}</td>
          <td>${fmtDur(i.avgGameMs)}</td><td>${i.handsWon}/${i.handsLost}</td><td>${i.trucoCalls}/${i.trucoAccepted}/${i.trucoRefused}</td><td>${i.woWins}/${i.woLosses}</td><td>${i.disconnects}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="tour-note">Tempos contam só o jogo (sem pausas da organização). Mãos e truco contam a partir das partidas de campeonato.</p>`;
  }

  function rulesHtml() {
    const d = data;
    const bo = Object.keys(d.roundNames).filter(k => d.bestOf.byRound[k]).map(k => `${d.roundNames[k]}: MD${d.bestOf.byRound[k]}`);
    const t = d.timers;
    const POL = { finish_running: 'as partidas em andamento terminam e não começam novas', extend: `o campeonato é prorrogado em ${d.extendMinutes} min`, end_no_champion: 'o campeonato encerra sem campeão' };
    return `<ul class="tour-rules">
      <li><b>Formato:</b> eliminatória simples (1v1), partidas até ${d.maxPoints} pontos.</li>
      <li><b>Confrontos:</b> MD${d.bestOf.default}${bo.length ? ` (${bo.join(', ')})` : ''}. Vence quem ganhar a maioria das partidas.</li>
      <li><b>3º lugar:</b> ${d.thirdPlace ? 'tem disputa entre os perdedores das semifinais' : 'os perdedores das semifinais dividem o 3º lugar'}.</li>
      <li><b>Check-in:</b> ${d.checkinRequired ? 'obrigatório, abre 15 minutos antes; quem não confirmar fica fora da chave' : 'não precisa'}.</li>
      <li><b>Entrar na partida:</b> ${fmtDur(t.readyMs)} para confirmar "Estou pronto"; quem não confirmar perde por W.O.${d.woEndsSeries ? ' (perde o confronto inteiro)' : ''}. Se nenhum dos dois confirmar, é duplo W.O.</li>
      <li><b>Tempo de jogada:</b> ${fmtDur(t.turnMs)} · para responder apostas: ${fmtDur(t.trucoMs)}.</li>
      <li><b>Queda de conexão:</b> ${fmtDur(t.reconnectMs)} para voltar, até ${fmtDur(t.disconnectTotalMs)} somados na partida. Depois disso, perde a partida.</li>
      <li><b>Entre partidas da série:</b> ${fmtDur(t.betweenGamesMs)}.</li>
      <li><b>Prazo final:</b> ${fmtDate(d.endAt)}; ao chegar nele ${POL[d.deadlinePolicy]}.</li>
      <li>Cada conta participa uma vez. Multicontas podem ser desclassificadas.</li>
    </ul>`;
  }

  function startTick() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (modal.classList.contains('hide')) { clearInterval(tick); return; }
      body.querySelectorAll('[data-deadline]').forEach(el => { el.textContent = fmtDur(left(Number(el.dataset.deadline))); });
    }, 500);
  }

  // ---------------------------------------------------------------- ações
  body.addEventListener('click', e => {
    const open = e.target.closest('[data-tour-open]');
    if (open) return openTour(open.dataset.tourOpen);
    if (e.target.closest('[data-tour-back]')) return openList();
    const t = e.target.closest('[data-tour-tab]');
    if (t) { tab = t.dataset.tourTab; renderDetail(); return; }
    const w = e.target.closest('[data-tour-watch]');
    if (w) {
      socket.emit('spectate:join', { roomId: w.dataset.tourWatch, name: (typeof usernameInput !== 'undefined' && usernameInput.value) || '' }, res => {
        if (res && res.error) toast(esc(res.error));
        else modal.classList.add('hide');
      });
      return;
    }
    const act = e.target.closest('[data-tour-act]');
    if (!act) return;
    const a = act.dataset.tourAct;
    if (a === 'login') { window.trucoSocial.openAuth('login'); return; }
    const ev = { register: 'tour:register', unregister: 'tour:unregister', checkin: 'tour:checkin', ready: 'tour:ready' }[a];
    if (!ev) return;
    if (a === 'unregister' && !confirm('Cancelar sua inscrição neste campeonato?')) return;
    act.disabled = true;
    const payload = { id: current, password, clientId: CLIENT_ID };
    if (a === 'ready') payload.matchId = data.me && data.me.match;
    socket.emit(ev, payload, res => {
      act.disabled = false;
      if (res && res.error) toast(`<i class="fa-solid fa-circle-exclamation"></i> ${esc(res.error)}`);
      else if (a === 'register') toast('<i class="fa-solid fa-check"></i> Inscrição feita! Fique de olho no horário do check-in.');
      load();
    });
  });

  // Atualizações em tempo real
  let reloadTimer = null;
  socket.on('tour:changed', ({ id }) => {
    if (!modal.classList.contains('hide') && current === id) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 200);
    }
  });
  socket.on('tour:list_changed', () => {
    paintHomeCount();
    if (!modal.classList.contains('hide') && !current) openList();
  });

  // Avisos do campeonato
  socket.on('tour:notify', n => {
    if (window.soundManager && window.soundManager.playChatPing) window.soundManager.playChatPing();
    const actions = [{ label: 'Abrir', primary: n.type !== 'match_ready', onClick: () => openTour(n.tid) }];
    if (n.type === 'match_ready') {
      actions.unshift({ label: 'Estou pronto', primary: true, onClick: () => socket.emit('tour:ready', { id: n.tid, matchId: n.matchId, clientId: CLIENT_ID }, res => { if (res && res.error) toast(esc(res.error)); }) });
    }
    toast(`<i class="fa-solid fa-trophy"></i> ${esc(n.message)}`, { key: `tour-${n.tid}-${n.type}`, timeout: n.type === 'match_ready' ? 0 : 9000, kind: n.type === 'match_ready' ? 'invite' : '', actions });
    if (n.type === 'match_ready' && current === n.tid) load();
  });

  // Partida de campeonato acabou: volta para a página do campeonato
  socket.on('tour:back', ({ tid }) => {
    if (typeof goHomeScreen === 'function') goHomeScreen();
    if (tid) openTour(tid, { tab: 'bracket' });
  });

  // Na mesa: barra com o confronto e o placar da série; pausa em destaque
  const bar = document.createElement('div');
  bar.className = 'tour-game-bar hide';
  document.body.appendChild(bar);
  let inTourGame = null;
  socket.on('game_state', s => {
    const info = s && s.tournament;
    document.body.classList.toggle('tour-game', !!info);
    if (!info || s.state === 'lobby') { bar.classList.add('hide'); inTourGame = null; return; }
    // Entrou na mesa: fecha a página do campeonato e o aviso de "Estou pronto"
    const key = `${info.tid}:${info.matchId || info.label}:${info.n || ''}`;
    if (inTourGame !== key) {
      inTourGame = key;
      modal.classList.add('hide');
      if (window.trucoSocial && window.trucoSocial.dismissToast) window.trucoSocial.dismissToast(`tour-${info.tid}-match_ready`);
    }
    const series = info.bestOf > 1 && info.series ? ` · série ${info.series.a} x ${info.series.b}` : '';
    bar.className = `tour-game-bar ${info.paused ? 'paused' : ''}`;
    bar.innerHTML = info.paused
      ? `<i class="fa-solid fa-circle-pause"></i> <b>Campeonato pausado.</b> ${esc(info.pauseMessage || '')}`
      : `<i class="fa-solid fa-trophy"></i> ${esc(info.name)} · ${esc(info.label)}${series}`;
  });

  // ---------------------------------------------------------------- menu
  function paintHomeCount() {
    socket.emit('tour:list', {}, res => {
      const items = (res && res.items) || [];
      const open = items.filter(t => ['registration', 'checkin', 'running', 'paused'].includes(t.status)).length;
      const badge = $('tour-count');
      if (badge) { badge.textContent = open; badge.classList.toggle('hide', !open); }
    });
  }
  $('open-tour-btn').addEventListener('click', openList);
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => modal.classList.add('hide')));
  modal.addEventListener('mousedown', e => { if (e.target === modal) modal.classList.add('hide'); });
  socket.on('connect', paintHomeCount);

  // ================================================================ ADMIN
  const adminBox = $('admin-tour');
  let adminEditing = null;
  const toLocalInput = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const PHASES = [['R64', '32-avos'], ['R32', '16-avos'], ['R16', 'Oitavas'], ['QF', 'Quartas'], ['SF', 'Semifinal'], ['F', 'Final'], ['3P', '3º lugar']];

  function adminLoad() {
    if (!adminBox) return;
    socket.emit('tour:list', {}, res => {
      const items = (res && res.items) || [];
      adminBox.innerHTML = `
        <div class="admin-games-head"><span>Campeonatos</span><button type="button" class="btn btn-sm btn-primary" data-tadm="new"><i class="fa-solid fa-plus"></i> Novo</button></div>
        <div id="tadm-form-wrap"></div>
        <ul class="tadm-list">${items.map(t => `
          <li class="tadm-item">
            <div><b>${esc(t.name)}</b> ${statusChip(t.status)} <small>${esc(t.id)} · ${t.registered}/${t.maxPlayers} · ${fmtDate(t.startAt)}${t.isPrivate ? ' · privado' : ''}</small></div>
            <div class="tadm-actions">
              ${['registration', 'checkin'].includes(t.status) ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="edit" data-id="${t.id}">Editar</button><button type="button" class="btn btn-sm btn-secondary" data-tadm="start" data-id="${t.id}">Iniciar agora</button>` : ''}
              ${t.status === 'running' ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="pause" data-id="${t.id}">Pausar</button>` : ''}
              ${t.status === 'paused' ? `<button type="button" class="btn btn-sm btn-primary" data-tadm="resume" data-id="${t.id}">Retomar</button>` : ''}
              ${['running', 'paused', 'registration', 'checkin'].includes(t.status) ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="extend" data-id="${t.id}">Prorrogar</button>` : ''}
              ${['running', 'paused'].includes(t.status) ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="finish" data-id="${t.id}">Encerrar</button>` : ''}
              ${!['finished', 'cancelled'].includes(t.status) ? `<button type="button" class="btn btn-sm btn-danger" data-tadm="cancel" data-id="${t.id}">Cancelar</button>` : ''}
              <button type="button" class="btn btn-sm btn-secondary" data-tadm="multi" data-id="${t.id}">Multicontas</button>
              <button type="button" class="btn btn-sm btn-secondary" data-tadm="view" data-id="${t.id}">Ver</button>
            </div>
            <div class="tadm-extra" id="tadm-extra-${t.id}"></div>
          </li>`).join('') || '<li class="tour-empty">Nenhum campeonato ainda.</li>'}</ul>`;
    });
  }

  function formHtml(t) {
    const v = t || { name: '', description: '', maxPlayers: 8, startAt: Date.now() + 3600000, endAt: Date.now() + 4 * 3600000, allowEarlyStart: true, isPrivate: false, checkinRequired: true, thirdPlace: true, maxPoints: 24, bestOf: { default: 1, byRound: {} }, timers: { readyMs: 180000, turnMs: 30000, trucoMs: 30000, reconnectMs: 120000, disconnectTotalMs: 300000, betweenGamesMs: 30000 }, deadlinePolicy: 'finish_running', extendMinutes: 30, woEndsSeries: true };
    const sec = ms => Math.round(ms / 1000);
    const boSel = (name, val, withDefault) => `<select name="${name}">${withDefault ? '<option value="">Padrão</option>' : ''}${[1, 3, 5, 7].map(n => `<option value="${n}" ${Number(val) === n ? 'selected' : ''}>MD${n}</option>`).join('')}</select>`;
    return `<form class="tadm-form" id="tadm-form" autocomplete="off">
      <h4>${t ? 'Editar campeonato' : 'Novo campeonato'}</h4>
      <label>Nome<input name="name" maxlength="60" value="${esc(v.name)}" required></label>
      <label>Descrição<textarea name="description" maxlength="1000" rows="2">${esc(v.description || '')}</textarea></label>
      <div class="tadm-row">
        <label>Participantes<select name="maxPlayers">${[4, 8, 16, 32, 64].map(n => `<option ${v.maxPlayers === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Pontos por partida<input name="maxPoints" type="number" min="1" max="40" value="${v.maxPoints}"></label>
      </div>
      <div class="tadm-row">
        <label>Início<input name="startAt" type="datetime-local" value="${toLocalInput(v.startAt)}" required></label>
        <label>Prazo final<input name="endAt" type="datetime-local" value="${toLocalInput(v.endAt)}" required></label>
      </div>
      <div class="tadm-checks">
        <label><input type="checkbox" name="allowEarlyStart" ${v.allowEarlyStart ? 'checked' : ''}> Permitir início antecipado</label>
        <label><input type="checkbox" name="checkinRequired" ${v.checkinRequired ? 'checked' : ''}> Check-in obrigatório</label>
        <label><input type="checkbox" name="thirdPlace" ${v.thirdPlace ? 'checked' : ''}> Disputa de 3º lugar</label>
        <label><input type="checkbox" name="woEndsSeries" ${v.woEndsSeries ? 'checked' : ''}> W.O. encerra a série inteira</label>
        <label><input type="checkbox" name="isPrivate" ${v.isPrivate ? 'checked' : ''}> Privado</label>
      </div>
      <label>Senha (privado)<input name="password" type="password" maxlength="64" placeholder="${t && t.isPrivate ? 'deixe em branco para manter' : ''}"></label>
      <fieldset><legend>Partidas por confronto</legend>
        <div class="tadm-row wrap"><label>Padrão ${boSel('bo_default', v.bestOf.default)}</label>
        ${PHASES.map(([k, l]) => `<label>${l} ${boSel('bo_' + k, v.bestOf.byRound[k], true)}</label>`).join('')}</div>
      </fieldset>
      <fieldset><legend>Tempos (segundos)</legend>
        <div class="tadm-row wrap">
          <label>Confirmar presença<input name="readyMs" type="number" min="10" value="${sec(v.timers.readyMs)}"></label>
          <label>Jogada<input name="turnMs" type="number" min="5" value="${sec(v.timers.turnMs)}"></label>
          <label>Responder truco<input name="trucoMs" type="number" min="5" value="${sec(v.timers.trucoMs)}"></label>
          <label>Reconexão<input name="reconnectMs" type="number" min="10" value="${sec(v.timers.reconnectMs)}"></label>
          <label>Desconexão somada<input name="disconnectTotalMs" type="number" min="10" value="${sec(v.timers.disconnectTotalMs)}"></label>
          <label>Entre partidas<input name="betweenGamesMs" type="number" min="1" value="${sec(v.timers.betweenGamesMs)}"></label>
        </div>
      </fieldset>
      <div class="tadm-row">
        <label>Ao chegar no prazo<select name="deadlinePolicy">
          <option value="finish_running" ${v.deadlinePolicy === 'finish_running' ? 'selected' : ''}>Termina as em andamento, sem novas</option>
          <option value="extend" ${v.deadlinePolicy === 'extend' ? 'selected' : ''}>Prorroga automaticamente</option>
          <option value="end_no_champion" ${v.deadlinePolicy === 'end_no_champion' ? 'selected' : ''}>Encerra sem campeão</option>
        </select></label>
        <label>Prorrogação (min)<input name="extendMinutes" type="number" min="5" value="${v.extendMinutes}"></label>
      </div>
      <p class="form-msg" id="tadm-msg"></p>
      <div class="tadm-actions"><button type="submit" class="btn btn-primary btn-sm">${t ? 'Salvar' : 'Criar campeonato'}</button><button type="button" class="link-btn" data-tadm="close-form">Fechar</button></div>
    </form>`;
  }

  function readForm(f) {
    const g = n => f.elements[n];
    const byRound = {};
    PHASES.forEach(([k]) => { if (g('bo_' + k).value) byRound[k] = Number(g('bo_' + k).value); });
    return {
      name: g('name').value, description: g('description').value,
      maxPlayers: Number(g('maxPlayers').value), maxPoints: Number(g('maxPoints').value),
      startAt: new Date(g('startAt').value).getTime(), endAt: new Date(g('endAt').value).getTime(),
      allowEarlyStart: g('allowEarlyStart').checked, checkinRequired: g('checkinRequired').checked,
      thirdPlace: g('thirdPlace').checked, woEndsSeries: g('woEndsSeries').checked,
      isPrivate: g('isPrivate').checked, password: g('password').value,
      bestOf: { default: Number(g('bo_default').value), byRound },
      timers: Object.fromEntries(['readyMs', 'turnMs', 'trucoMs', 'reconnectMs', 'disconnectTotalMs', 'betweenGamesMs'].map(k => [k, Number(g(k).value) * 1000])),
      deadlinePolicy: g('deadlinePolicy').value, extendMinutes: Number(g('extendMinutes').value)
    };
  }

  if (adminBox) {
    adminBox.addEventListener('click', e => {
      const b = e.target.closest('[data-tadm]');
      if (!b) return;
      const id = b.dataset.id;
      const act = b.dataset.tadm;
      const wrap = $('tadm-form-wrap');
      if (act === 'new') { adminEditing = null; wrap.innerHTML = formHtml(null); return; }
      if (act === 'close-form') { wrap.innerHTML = ''; return; }
      if (act === 'edit') {
        socket.emit('tour:view', { id }, res => { if (res && res.ok) { adminEditing = id; wrap.innerHTML = formHtml(res.tournament); wrap.scrollIntoView({ block: 'nearest' }); } });
        return;
      }
      if (act === 'view') { $('modal-admin-panel').classList.add('hide'); openTour(id); return; }
      if (act === 'multi') return showMulti(id);
      let extra = {};
      if (act === 'pause') { const m = prompt('Mensagem para os participantes:', 'Campeonato temporariamente pausado devido a problemas técnicos.'); if (m === null) return; extra.message = m; }
      if (act === 'cancel') { const m = prompt('Motivo do cancelamento:'); if (m === null) return; extra.message = m; }
      if (act === 'start' && !confirm('Começar o campeonato agora?')) return;
      if (act === 'finish' && !confirm('Encerrar agora? Se a final não terminou, fica sem campeão.')) return;
      if (act === 'extend') { const m = prompt('Prorrogar por quantos minutos?', '30'); if (!m) return; extra.minutes = Number(m); }
      socket.emit('tour:admin_action', { id, action: act, ...extra }, res => {
        toast(esc(res && res.error ? res.error : (res && res.message) || 'Feito.'));
        adminLoad();
      });
    });
    adminBox.addEventListener('submit', e => {
      if (e.target.id !== 'tadm-form') return;
      e.preventDefault();
      const payload = readForm(e.target);
      const ev = adminEditing ? 'tour:admin_update' : 'tour:admin_create';
      if (adminEditing) payload.id = adminEditing;
      socket.emit(ev, payload, res => {
        const msg = $('tadm-msg');
        if (res && res.error) { msg.textContent = res.error; msg.className = 'form-msg error'; return; }
        toast(adminEditing ? 'Campeonato salvo.' : `Campeonato criado! Código: ${esc(res.id)}`);
        adminEditing = null;
        adminLoad();
      });
    });
  }

  function showMulti(id) {
    const box = $('tadm-extra-' + id);
    socket.emit('tour:admin_multi', { id }, res => {
      if (!res || res.error) { box.innerHTML = `<p>${esc((res && res.error) || 'Erro')}</p>`; return; }
      box.innerHTML = `
        <div class="tadm-multi">
          <p class="tour-note">Sinais guardados por ${res.retentionDays} dias após o fim (rede e aparelho embaralhados, sem o endereço real). Dividir rede ou aparelho não prova fraude: analise antes de decidir.</p>
          ${res.pairs.length ? `<ul>${res.pairs.map(p => `
            <li class="lvl-${p.level}"><b>${esc(p.names.join(' + '))}</b>
              <span>${p.sameDevice ? `mesmo aparelho (${p.sameDevice}x)` : ''} ${p.sameIp ? `mesma rede (${p.sameIp}x)` : ''} · último: ${fmtDate(p.lastAt)}</span>
              <span class="tadm-actions">
                <button type="button" class="btn btn-sm btn-secondary" data-mdec="ok" data-acc="${esc(p.accounts.join(','))}">Normal</button>
                <button type="button" class="btn btn-sm btn-secondary" data-mdec="suspeito" data-acc="${esc(p.accounts.join(','))}">Suspeito</button>
                <button type="button" class="btn btn-sm btn-danger" data-mdq="${esc(p.accounts[1])}">Desclassificar ${esc(p.names[1])}</button>
              </span></li>`).join('')}</ul>` : '<p>Nenhuma associação encontrada.</p>'}
          ${res.deviceChanges.length ? `<p><b>Trocas de aparelho:</b> ${res.deviceChanges.map(d => `${esc(d.name)} (${d.devices})`).join(', ')}</p>` : ''}
          ${res.decisions.length ? `<p><b>Decisões:</b></p><ul>${res.decisions.map(d => `<li>${fmtDate(d.at)} · ${esc(d.accounts.join(' + '))}: <b>${esc(d.decision)}</b> ${esc(d.note)}</li>`).join('')}</ul>` : ''}
        </div>`;
      box.onclick = e => {
        const dec = e.target.closest('[data-mdec]');
        const dq = e.target.closest('[data-mdq]');
        if (dec) {
          const note = prompt('Justificativa da decisão:');
          if (note === null) return;
          socket.emit('tour:admin_decide', { id, accounts: dec.dataset.acc.split(','), decision: dec.dataset.mdec, note }, () => showMulti(id));
        } else if (dq) {
          const note = prompt('Motivo da desclassificação:');
          if (!note) return;
          socket.emit('tour:admin_disqualify', { id, account: dq.dataset.mdq, note }, res2 => { toast(esc(res2 && res2.error ? res2.error : 'Desclassificado.')); showMulti(id); });
        }
      };
    });
  }

  window.trucoTournaments = { open: openList, openTour, adminLoad };
})();
