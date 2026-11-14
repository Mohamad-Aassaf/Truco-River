// Conversa rápida na mesa: frases prontas para a dupla combinar a jogada.
// Todo mundo na mesa vê (balão no lugar de quem falou e na conversa).
// Usa `socket`, `lastGameState`, `myPlayerId`, `seatOf` e `escapeText` do app.js.
(function () {
  const PHRASES = [
    ['pontos', 'Peço os pontos?'], ['tenho_pontos', 'Tenho pontos!'], ['poucos', 'Tenho poucos pontos'],
    ['sim', 'Sim'], ['nao', 'Não'], ['aumenta', 'Aumenta!'],
    ['aceita', 'Aceita!'], ['nao_aceita', 'Não aceita'], ['truco', 'Peço truco?'],
    ['mazo', 'Vamos ao mazo?'], ['maior', 'Joga a maior'], ['guarda', 'Guarda a maior'],
    ['comigo', 'Deixa comigo'], ['espera', 'Espera aí'], ['boa', 'Boa, parceiro!'], ['vamos', 'Vamos lá!']
  ];
  const host = document.querySelector('#screen-game .player-hand-container');
  if (!host) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'qc-btn hide';
  btn.title = 'Conversa rápida';
  btn.setAttribute('aria-label', 'Conversa rápida');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<i class="fa-solid fa-comment-dots"></i>';
  host.appendChild(btn);

  const menu = document.createElement('div');
  menu.className = 'qc-menu hide';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<div class="qc-head"><i class="fa-solid fa-comment-dots"></i> Conversa rápida <small>todos na mesa veem</small></div>
    <div class="qc-grid">${PHRASES.map(([id, t]) => `<button type="button" class="qc-item" role="menuitem" data-qc="${id}">${t}</button>`).join('')}</div>`;
  document.body.appendChild(menu);

  const close = () => { menu.classList.add('hide'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!menu.classList.contains('hide')) return close();
    const r = btn.getBoundingClientRect();
    menu.classList.remove('hide');
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
    menu.style.top = `${Math.max(8, r.top - h - 8)}px`;
    btn.setAttribute('aria-expanded', 'true');
  });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-qc]');
    if (!b) return;
    socket.emit('quick_chat', { id: b.dataset.qc });
    close();
  });
  document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== btn) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  // Só aparece para quem está jogando (não para quem assiste), durante a partida
  socket.on('game_state', s => {
    const show = !!(s && !s.spectating && ['playing', 'hand_end', 'drawing'].includes(s.state) && s.players.some(p => p.id === myPlayerId));
    btn.classList.toggle('hide', !show);
    if (!show) close();
  });

  // Balão no lugar de quem falou
  const timers = new Map();
  socket.on('quick_chat', ({ playerIdx, text }) => {
    if (typeof seatOf !== 'function') return;
    const seat = document.getElementById(`seat-${seatOf(playerIdx)}`);
    if (!seat) return;
    let b = seat.querySelector('.qc-bubble');
    if (!b) { b = document.createElement('span'); b.className = 'qc-bubble'; seat.appendChild(b); }
    b.innerHTML = `<i class="fa-solid fa-comment-dots"></i> ${escapeText(text)}`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(timers.get(playerIdx));
    timers.set(playerIdx, setTimeout(() => b.classList.remove('show'), 4200));
  });
})();
