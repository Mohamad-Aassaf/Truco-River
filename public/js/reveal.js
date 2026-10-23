// public/js/reveal.js
// Janela com os pontos cantados quando um Envido ou uma Flor é aceito.
// Quem perde não precisa revelar: aparece "São cartas boas...".
// Usa `socket` e `mySeatIndex` do app.js.

(() => {
  const modal = document.getElementById('modal-reveal');
  if (!modal) return;

  const kindEl = document.getElementById('reveal-kind');
  const titleEl = document.getElementById('reveal-title');
  const linesEl = document.getElementById('reveal-lines');
  const resultEl = document.getElementById('reveal-result');
  const okBtn = document.getElementById('reveal-ok');

  const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  let shownKey = null;
  let currentId = null;

  function close() {
    if (modal.classList.contains('hide')) return;
    modal.classList.add('hide');
    if (currentId !== null) socket.emit('reveal_ack', { id: currentId });
    currentId = null;
  }

  function show(reveal, gameState) {
    const me = gameState.players[mySeatIndex];
    const myTeam = me ? me.team : 0;
    const isFlor = reveal.kind === 'flor';

    modal.classList.toggle('is-flor', isFlor);
    kindEl.innerHTML = isFlor
      ? '<i class="fa-solid fa-spa"></i> Flor'
      : '<i class="fa-solid fa-calculator"></i> Envido';
    titleEl.textContent = isFlor ? 'Flor contra Flor! Mostrem os pontos' : 'Quero! Cantem os pontos';

    linesEl.innerHTML = reveal.lines.map((line, i) => {
      const team = line.team === myTeam ? 'us' : 'them';
      const isMe = line.playerIdx === mySeatIndex;
      const isWinner = line.playerIdx === reveal.winnerIdx;
      const value = line.score === null
        ? '<span class="reveal-hidden">São cartas boas...</span>'
        : `<span class="reveal-score">${line.score}</span>`;
      return `
        <li class="reveal-line team-${team} ${isWinner ? 'winner' : ''}" style="--i:${i}">
          <span class="reveal-name">${isWinner ? '<i class="fa-solid fa-crown"></i>' : ''}${escapeHtml(line.name)}${isMe ? ' <small>(você)</small>' : ''}</span>
          ${value}
        </li>`;
    }).join('');

    const winner = gameState.players[reveal.winnerIdx];
    const weWon = reveal.winnerTeam === myTeam;
    const tentos = reveal.tentos === 1 ? '1 tento' : `${reveal.tentos} tentos`;
    resultEl.className = `reveal-result ${weWon ? 'us' : 'them'}`;
    resultEl.style.setProperty('--i', reveal.lines.length);
    resultEl.innerHTML = `${weWon ? '<i class="fa-solid fa-trophy"></i>' : '<i class="fa-solid fa-face-frown"></i>'}
      ${escapeHtml(winner ? winner.name : '')} ganha ${isFlor ? 'a Flor' : 'o Envido'}: +${tentos}`;

    currentId = reveal.id;
    modal.classList.remove('hide');
    setTimeout(() => okBtn.focus(), 50);
  }

  okBtn.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hide')) close();
  });

  socket.on('game_state', gameState => {
    const reveal = (gameState.hand && gameState.hand.reveal)
      || (gameState.lastHandSummary && gameState.lastHandSummary.reveal);
    if (!reveal) return;
    const key = `${gameState.id}:${reveal.id}`;
    if (key === shownKey) return;
    shownKey = key;
    show(reveal, gameState);
  });

  // Saiu da partida: fecha a janela
  socket.on('kicked', () => { currentId = null; modal.classList.add('hide'); });
})();
