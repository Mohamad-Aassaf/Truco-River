// Painel admin → aba "Histórico": partidas que terminaram, com a narrativa mão por mão.
// Usa `socket` do app.js.
(function () {
  const box = document.getElementById('admin-history');
  if (!box) return;
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = ms => {
    const d = new Date(ms);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtTime = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const fmtDur = ms => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}min ${pad(s % 60)}s` : `${Math.floor(m / 60)}h ${pad(m % 60)}min`;
  };
  const HOW = {
    pontos: ['Terminou', 'ok'],
    desistencia: ['Desistência', 'warn'],
    interrompida: ['Interrompida', 'off']
  };

  let query = '';
  let items = [];
  let total = 0;
  let keepDays = 30;
  const open = new Map(); // id -> partida completa (já carregada)

  box.innerHTML = `
    <div class="admin-games-head"><span>Histórico de partidas</span>
      <button type="button" class="btn btn-sm btn-secondary" data-hist="refresh"><i class="fa-solid fa-rotate"></i> Atualizar</button></div>
    <form class="hist-search" data-hist-form>
      <input type="search" name="q" maxlength="60" placeholder="Buscar jogador, código da sala, bot, duplas, campeonato..." aria-label="Buscar no histórico">
      <button type="submit" class="btn btn-sm btn-primary"><i class="fa-solid fa-magnifying-glass"></i></button>
    </form>
    <p class="hist-note" id="hist-note"></p>
    <ul class="hist-list" id="hist-list"></ul>
    <div class="hist-more" id="hist-more"></div>`;
  const listEl = document.getElementById('hist-list');
  const noteEl = document.getElementById('hist-note');
  const moreEl = document.getElementById('hist-more');

  function teamLabel(h, t) {
    return (h.teamNames && h.teamNames[t]) || `Time ${t + 1}`;
  }
  function teamPlayers(h, t) {
    return (h.players || []).filter(p => p.team === t).map(p =>
      `<span class="hist-p ${p.left ? 'left' : ''} ${p.bot ? 'bot' : ''}" title="${p.left ? 'saiu no meio' : p.joinedLater ? 'entrou depois' : ''}">${p.bot ? '<i class="fa-solid fa-robot"></i> ' : ''}${esc(p.name)}${p.left ? ' <i class="fa-solid fa-person-walking-arrow-right"></i>' : ''}</span>`).join('');
  }

  function itemHtml(h) {
    const [howLabel, howCls] = HOW[h.how] || [h.how, ''];
    const win = t => h.winner === t ? 'win' : '';
    return `<li class="hist-item" data-id="${esc(h.id)}">
      <div class="hist-top">
        <span class="hist-date">${fmtDate(h.endedAt)}</span>
        <span class="hist-tag">${h.mode === '2v2' ? 'Duplas' : '1v1'} · ${h.maxPoints} pts</span>
        <span class="hist-tag">Sala ${esc(h.roomId)}</span>
        ${h.tournament ? `<span class="hist-tag tour"><i class="fa-solid fa-trophy"></i> ${esc(h.tournament.name)} · ${esc(h.tournament.label)}</span>` : ''}
        <span class="hist-how ${howCls}">${howLabel}</span>
      </div>
      <div class="hist-teams">
        <div class="hist-team t0 ${win(0)}"><small>${esc(teamLabel(h, 0))}${h.winner === 0 ? ' <i class="fa-solid fa-crown"></i>' : ''}</small>${teamPlayers(h, 0)}</div>
        <div class="hist-score"><b class="${win(0)}">${h.score ? h.score[0] : 0}</b> × <b class="${win(1)}">${h.score ? h.score[1] : 0}</b></div>
        <div class="hist-team t1 ${win(1)}"><small>${esc(teamLabel(h, 1))}${h.winner === 1 ? ' <i class="fa-solid fa-crown"></i>' : ''}</small>${teamPlayers(h, 1)}</div>
      </div>
      <div class="hist-foot">
        <small>${fmtDur(h.durationMs)} · ${h.hands} ${h.hands === 1 ? 'mão' : 'mãos'}${h.finalBlow ? ` · ${esc(h.finalBlow)}` : ''}</small>
        <button type="button" class="btn btn-sm btn-secondary" data-hist="log"><i class="fa-solid fa-scroll"></i> Narrativa</button>
      </div>
      <div class="hist-log hide"></div>
    </li>`;
  }

  function logHtml(h) {
    const lines = h.log || [];
    if (!lines.length) return '<p class="hist-note">Sem narrativa registrada.</p>';
    let lastHand = null;
    const out = [];
    lines.forEach(l => {
      if (l.h !== lastHand) {
        lastHand = l.h;
        out.push(`<li class="hist-hand">${l.h ? `Mão ${l.h}` : 'Antes da primeira mão'}</li>`);
      }
      const cls = l.team === 0 ? 't0' : l.team === 1 ? 't1' : '';
      out.push(`<li class="${cls}"><time>${fmtTime(l.t)}</time>${esc(l.msg)}</li>`);
    });
    const leaves = (h.leaves || []).length
      ? `<p class="hist-leaves"><i class="fa-solid fa-person-walking-arrow-right"></i> ${h.leaves.map(l => `${esc(l.name)} saiu na mão ${l.hand} (${fmtTime(l.at)})`).join(' · ')}</p>` : '';
    return `${leaves}<ol class="hist-lines">${out.join('')}</ol>`;
  }

  function render(append) {
    if (!append) listEl.innerHTML = '';
    listEl.insertAdjacentHTML('beforeend', (append ? items.slice(-append) : items).map(itemHtml).join(''));
    if (!items.length) listEl.innerHTML = `<li class="tour-empty">${query ? 'Nada encontrado.' : 'Nenhuma partida terminou ainda.'}</li>`;
    noteEl.textContent = `${total} ${total === 1 ? 'partida' : 'partidas'}${query ? (total === 1 ? ' encontrada' : ' encontradas') : ''}. Ficam guardadas por ${keepDays} dias.`;
    moreEl.innerHTML = items.length < total ? `<button type="button" class="btn btn-sm btn-secondary" data-hist="more">Carregar mais (${total - items.length})</button>` : '';
  }

  function load(append = false) {
    socket.emit('history:list', { q: query, offset: append ? items.length : 0 }, res => {
      if (!res || res.error) { noteEl.textContent = (res && res.error) || 'Não deu para carregar.'; return; }
      total = res.total;
      keepDays = res.keepDays || keepDays;
      if (append) { items = items.concat(res.items); render(res.items.length); } else { items = res.items; render(0); }
    });
  }

  box.addEventListener('submit', e => {
    if (!e.target.matches('[data-hist-form]')) return;
    e.preventDefault();
    query = e.target.elements.q.value.trim();
    load();
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-hist]');
    if (!b) return;
    const act = b.dataset.hist;
    if (act === 'refresh') return load();
    if (act === 'more') return load(true);
    if (act === 'log') {
      const li = b.closest('.hist-item');
      const logEl = li.querySelector('.hist-log');
      if (!logEl.classList.contains('hide')) { logEl.classList.add('hide'); return; }
      const show = h => { logEl.innerHTML = logHtml(h); logEl.classList.remove('hide'); };
      const id = li.dataset.id;
      if (open.has(id)) return show(open.get(id));
      b.disabled = true;
      socket.emit('history:get', { id }, res => {
        b.disabled = false;
        if (!res || res.error) { logEl.innerHTML = `<p class="hist-note">${esc((res && res.error) || 'Erro.')}</p>`; logEl.classList.remove('hide'); return; }
        open.set(id, res.item);
        show(res.item);
      });
    }
  });

  const tab = document.querySelector('[data-admin-tab="history"]');
  if (tab) tab.addEventListener('click', () => load());
  window.trucoHistory = { load };
})();
