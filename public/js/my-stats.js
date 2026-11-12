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

  function render() {
    const p = data.profile;
    const games = data.games || [];
    const life = p.stats;
    const lifeL = life.played - life.won;
    const s = summary(games);
    sub.textContent = `${p.username} · conta criada em ${new Date(p.createdAt).toLocaleDateString('pt-BR')}`;
    const tile = (label, value, cls = '') => `<div class="st-tile ${cls}"><b>${value}</b><span>${label}</span></div>`;
    const wl = (w, l) => `<span class="wl"><b class="w">${w}</b> x <b class="l">${l}</b></span>`;
    const friends = p.friends.length ? `<ul class="st-friends">${p.friends.map(f => {
      const vs = pct(f.vw, f.vl);
      return `<li>
        <span class="st-friend-name"><i class="fa-solid fa-user"></i> ${esc(f.name)}</span>
        <span class="st-friend-col"><small>Contra</small>${wl(f.vw, f.vl)}${vs !== null ? `<i class="st-bar"><i style="width:${vs}%"></i></i>` : '<em>nunca jogaram</em>'}</span>
        <span class="st-friend-col"><small>Juntos</small>${f.tw + f.tl ? wl(f.tw, f.tl) : '<em>—</em>'}</span>
      </li>`;
    }).join('')}</ul>` : '<p class="tour-empty">Adicione amigos para ver quantas vezes você ganhou e perdeu contra cada um.</p>';

    body.innerHTML = `
      <section class="st-sec">
        <div class="st-tiles">
          ${tile('Partidas', life.played)}
          ${tile('Vitórias', life.won, 'w')}
          ${tile('Derrotas', lifeL, 'l')}
          ${tile('Aproveitamento', life.played ? `${Math.round((life.won / life.played) * 100)}%` : '—')}
        </div>
        <p class="tour-note">Contam as partidas contra adversários de verdade (sem bot no time de lá).</p>
      </section>

      <section class="st-sec">
        <h3 class="st-title"><i class="fa-solid fa-user-group"></i> Com seus amigos</h3>
        ${friends}
      </section>

      <section class="st-sec">
        <h3 class="st-title"><i class="fa-solid fa-calendar-days"></i> Últimos ${data.keepDays || 30} dias <small>(inclui partidas com bots)</small></h3>
        ${games.length ? `
        <div class="st-tiles small">
          ${tile('Vitórias x derrotas', wl(s.w, s.l))}
          ${tile('Sequência atual', s.streak ? `${s.streak} vitória${s.streak > 1 ? 's' : ''}` : '—')}
          ${tile('Melhor sequência', s.best || '—')}
          ${tile('Tempo médio', s.avg ? fmtDur(s.avg) : '—')}
          ${tile('1v1', wl(s.byMode['1v1'].w, s.byMode['1v1'].l))}
          ${tile('Duplas', wl(s.byMode['2v2'].w, s.byMode['2v2'].l))}
          ${tile('Mãos ganhas x perdidas', wl(s.t.handsWon, s.t.handsLost))}
          ${tile('Trucos pedidos', s.t.trucoCalls)}
          ${tile('Abandonos', s.quits)}
        </div>
        <ul class="st-games">${games.map(gameHtml).join('')}</ul>` : '<p class="tour-empty">Nenhuma partida nos últimos dias. Bora jogar!</p>'}
      </section>`;
  }

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
