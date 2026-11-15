// "Minhas estatísticas": para quem tem conta. Totais da conta, vitórias x derrotas
// com cada amigo (contra e juntos na dupla) e as partidas dos últimos dias com a narrativa.
// Usa `socket` e `escapeText` do app.js.
(function () {
  const btn = document.getElementById('open-stats-btn');
  if (!btn) return;
  const esc = v => escapeText(v == null ? '' : String(v));
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = ms => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtTime = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const fmtDur = ms => {
    const s = Math.round((ms || 0) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h ${pad(m % 60)}min`;
  };
  const pct = (w, l) => (w + l ? Math.round((w / (w + l)) * 100) : null);

  // Janela
  const modal = document.createElement('div');
  modal.id = 'modal-stats';
  modal.className = 'modal-overlay hide';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'stats-title');
  modal.innerHTML = `
    <div class="modal-card stats-card">
      <div class="modal-header">
        <div class="news-heading">
          <h2 id="stats-title"><i class="fa-solid fa-chart-column"></i> Suas estatísticas</h2>
          <small id="stats-sub"></small>
        </div>
        <button class="btn-close-modal" data-close-stats aria-label="Fechar">&times;</button>
      </div>
      <div class="modal-body" id="stats-body"></div>
    </div>`;
  document.body.appendChild(modal);
  const body = modal.querySelector('#stats-body');
  const sub = modal.querySelector('#stats-sub');
  const close = () => modal.classList.add('hide');
  modal.querySelector('[data-close-stats]').addEventListener('click', close);
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });

  let data = null;
  const opened = new Map();

  function open() {
    modal.classList.remove('hide');
    body.innerHTML = '<p class="tour-empty"><span class="wait-spin"></span> Carregando…</p>';
    socket.emit('me:stats', {}, res => {
      if (!res || res.error) { body.innerHTML = `<p class="tour-empty">${esc((res && res.error) || 'Não deu para carregar.')}</p>`; return; }
      data = res;
      render();
    });
  }

  // Resultado da partida do ponto de vista da conta
  function mine(g) {
    const acc = data.profile.username.toLowerCase();
    const me = (g.players || []).find(p => p.account === acc);
    const team = me ? me.team : 0;
    const result = g.winner === null || g.winner === undefined ? 'none' : g.winner === team ? 'win' : 'loss';
    return {
      me, team, result,
      left: !!(me && me.left),
      partners: (g.players || []).filter(p => p.team === team && p !== me),
      rivals: (g.players || []).filter(p => p.team !== team),
      scoreMe: g.score ? g.score[team] : 0,
      scoreThem: g.score ? g.score[1 - team] : 0
    };
  }

  function summary(games) {
    let w = 0, l = 0, streak = 0, best = 0, run = 0, dur = 0, durN = 0, quits = 0;
    const byMode = { '1v1': { w: 0, l: 0 }, '2v2': { w: 0, l: 0 } };
    const t = { handsWon: 0, handsLost: 0, trucoCalls: 0, trucoAccepted: 0, trucoRefused: 0 };
    let streakSet = false;
    games.forEach(g => {
      const m = mine(g);
      if (m.left) quits++;
      if (m.result === 'none') return;
      const won = m.result === 'win';
      won ? w++ : l++;
      (byMode[g.mode] || byMode['1v1'])[won ? 'w' : 'l']++;
      if (g.durationMs) { dur += g.durationMs; durN++; }
      // a lista vem da mais nova para a mais antiga
      if (!streakSet) { if (won) streak++; else streakSet = true; }
      if (won) { run++; best = Math.max(best, run); } else run = 0;
      if (m.me && m.me.stats) Object.keys(t).forEach(k => { t[k] += m.me.stats[k] || 0; });
    });
    return { w, l, streak, best, avg: durN ? dur / durN : 0, quits, byMode, t };
  }

  // Filtros da lista de partidas
  const filters = { period: 30, mode: 'all', vs: 'all', result: 'all' };
  const FILTERS = [
    ['period', 'Período', [[7, '7 dias'], [30, '30 dias']]],
    ['mode', 'Modo', [['all', 'Todos'], ['1v1', '1v1'], ['2v2', 'Duplas']]],
    ['vs', 'Contra', [['all', 'Todos'], ['people', 'Pessoas'], ['bots', 'Bots']]],
    ['result', 'Resultado', [['all', 'Todos'], ['win', 'Vitórias'], ['loss', 'Derrotas']]]
  ];
  function applyFilters(games) {
    const since = Date.now() - filters.period * 86400000;
    return games.filter(g => {
      const m = mine(g);
      if (g.endedAt < since) return false;
      if (filters.mode !== 'all' && g.mode !== filters.mode) return false;
      const bots = m.rivals.some(r => r.bot);
      if (filters.vs === 'people' && bots) return false;
      if (filters.vs === 'bots' && !bots) return false;
      if (filters.result !== 'all' && m.result !== filters.result) return false;
      return true;
    });
  }

  function render() {
    const p = data.profile;
    const life = p.stats;
    const lifeL = life.played - life.won;
    const lifePct = life.played ? Math.round((life.won / life.played) * 100) : null;
    sub.textContent = `${p.username} · conta criada em ${new Date(p.createdAt).toLocaleDateString('pt-BR')}`;
    const wl = (w, l) => `<span class="wl"><b class="w">${w}</b> <small>vitórias</small> · <b class="l">${l}</b> <small>derrotas</small></span>`;
    const friends = p.friends.length ? `<ul class="st-friends">${p.friends.map(f => {
      const vs = pct(f.vw, f.vl);
      const played = f.vw + f.vl;
      return `<li>
        <span class="st-friend-name"><i class="fa-solid fa-user"></i> ${esc(f.name)}</span>
        <span class="st-friend-col"><small>Você contra</small>${played ? `<span class="wl"><b class="w">${f.vw}</b> x <b class="l">${f.vl}</b></span><i class="st-bar"><i style="width:${vs}%"></i></i>` : '<em>nunca jogaram</em>'}</span>
        <span class="st-friend-col"><small>Na mesma dupla</small>${f.tw + f.tl ? `<span class="wl"><b class="w">${f.tw}</b> x <b class="l">${f.tl}</b></span>` : '<em>—</em>'}</span>
      </li>`;
    }).join('')}</ul>` : '<p class="tour-empty">Adicione amigos para ver quantas vezes você ganhou e perdeu contra cada um.</p>';

    body.innerHTML = `
      <section class="st-sec st-hero">
        <div class="st-hero-main">
          <b class="st-hero-pct">${lifePct === null ? '—' : `${lifePct}%`}</b>
          <span>${life.played ? `Você venceu <b>${life.won}</b> de <b>${life.played}</b> partidas` : 'Ainda sem partidas contra pessoas'}</span>
        </div>
        <div class="st-hero-wl">${wl(life.won, lifeL)}</div>
        <p class="tour-note">Contam só as partidas contra pessoas (sem bot do outro lado), desde ${p.statsResetAt ? 'que as estatísticas foram zeradas' : 'que a conta foi criada'}.</p>
      </section>

      <section class="st-sec">
        <h3 class="st-title"><i class="fa-solid fa-user-group"></i> Com seus amigos</h3>
        ${friends}
      </section>

      <section class="st-sec">
        <h3 class="st-title"><i class="fa-solid fa-list"></i> Suas partidas</h3>
        <div class="st-filters">${FILTERS.map(([k, label, opts]) => `
          <div class="st-filter"><span>${label}</span>${opts.map(([v, t]) => `<button type="button" class="st-chip ${String(filters[k]) === String(v) ? 'on' : ''}" data-f="${k}" data-v="${v}">${t}</button>`).join('')}</div>`).join('')}
        </div>
        <div id="st-filtered"></div>
      </section>`;
    renderFiltered();
  }

  function renderFiltered() {
    const box = body.querySelector('#st-filtered');
    if (!box) return;
    const games = applyFilters(data.games || []);
    const s = summary(games);
    const total = s.w + s.l;
    const line = (icon, label, value) => `<li><i class="fa-solid ${icon}"></i><span>${label}</span><b>${value}</b></li>`;
    box.innerHTML = games.length ? `
      <ul class="st-facts">
        ${line('fa-trophy', 'Vitórias e derrotas', `${s.w} x ${s.l}${total ? ` (${Math.round((s.w / total) * 100)}%)` : ''}`)}
        ${line('fa-fire', 'Vitórias seguidas agora', s.streak || '0')}
        ${line('fa-medal', 'Maior sequência de vitórias', s.best || '0')}
        ${line('fa-hand', 'Mãos ganhas e perdidas', `${s.t.handsWon} x ${s.t.handsLost}`)}
        ${line('fa-bullhorn', 'Trucos que você pediu', s.t.trucoCalls)}
        ${line('fa-clock', 'Duração média', s.avg ? fmtDur(s.avg) : '—')}
        ${line('fa-door-open', 'Partidas que você abandonou', s.quits)}
      </ul>
      <ul class="st-games">${games.map(gameHtml).join('')}</ul>`
      : '<p class="tour-empty">Nenhuma partida com esses filtros.</p>';
  }

  body.addEventListener('click', e => {
    const c = e.target.closest('[data-f]');
    if (!c) return;
    const k = c.dataset.f;
    filters[k] = k === 'period' ? Number(c.dataset.v) : c.dataset.v;
    body.querySelectorAll(`[data-f="${k}"]`).forEach(x => x.classList.toggle('on', x === c));
    renderFiltered();
  });

  function gameHtml(g) {
    const m = mine(g);
    const chip = m.result === 'win' ? '<span class="st-res win">Vitória</span>'
      : m.result === 'loss' ? `<span class="st-res loss">Derrota${m.left ? ' (saiu)' : ''}</span>`
        : '<span class="st-res none">Não terminou</span>';
    const names = list => list.map(p => `${p.bot ? '<i class="fa-solid fa-robot"></i> ' : ''}${esc(p.name)}`).join(' e ');
    return `<li class="st-game ${m.result}" data-id="${esc(g.id)}">
      <div class="st-game-top">${chip}<span class="st-game-date">${fmtDate(g.endedAt)}</span>
        <span class="st-game-tag">${g.mode === '2v2' ? 'Duplas' : '1v1'} · ${g.maxPoints} pts</span>
        ${g.tournament ? `<span class="st-game-tag tour"><i class="fa-solid fa-trophy"></i> ${esc(g.tournament.name)}</span>` : ''}</div>
      <div class="st-game-mid">
        <span>${m.partners.length ? `Você e ${names(m.partners)}` : 'Você'} <b class="st-score">${m.scoreMe} x ${m.scoreThem}</b> ${names(m.rivals)}</span>
      </div>
      <div class="st-game-foot"><small>${fmtDur(g.durationMs)} · ${g.hands} ${g.hands === 1 ? 'mão' : 'mãos'}</small>
        <button type="button" class="link-btn" data-st-log><i class="fa-solid fa-scroll"></i> Narrativa</button></div>
      <div class="st-log hide"></div>
    </li>`;
  }

  body.addEventListener('click', e => {
    const b = e.target.closest('[data-st-log]');
    if (!b) return;
    const li = b.closest('.st-game');
    const box = li.querySelector('.st-log');
    if (!box.classList.contains('hide')) { box.classList.add('hide'); return; }
    const show = g => {
      let last = null;
      box.innerHTML = `<ol class="hist-lines">${(g.log || []).map(l => {
        const head = l.h !== last ? `<li class="hist-hand">${l.h ? `Mão ${l.h}` : 'Sorteio'}</li>` : '';
        last = l.h;
        return `${head}<li><time>${fmtTime(l.t)}</time>${esc(l.msg)}</li>`;
      }).join('')}</ol>`;
      box.classList.remove('hide');
    };
    const id = li.dataset.id;
    if (opened.has(id)) return show(opened.get(id));
    socket.emit('me:game', { id }, res => {
      if (!res || res.error) { box.innerHTML = `<p class="hist-note">${esc((res && res.error) || 'Erro.')}</p>`; box.classList.remove('hide'); return; }
      opened.set(id, res.item);
      show(res.item);
    });
  });

  btn.addEventListener('click', open);
  const who = document.querySelector('#account-strip .account-info');
  if (who) {
    who.addEventListener('click', () => { if (document.getElementById('account-strip').classList.contains('is-user')) open(); });
  }
  window.trucoStats = { open };
})();
