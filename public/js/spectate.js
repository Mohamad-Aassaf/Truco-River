// public/js/spectate.js
// Assistir partidas: lista no menu, barra de quem está assistindo (com troca de
// jogador), aviso da conversa dos espectadores e o rótulo do chat.
// Usa `socket`, `usernameInput`, `escapeText`, `openChatDrawer` e `goHomeScreen` do app.js.

(() => {
  const $ = id => document.getElementById(id);
  const modal = $('modal-watch');
  const list = $('watch-list');
  const msg = $('watch-msg');
  let pollTimer = null;

  const toast = (html, opts) => window.trucoSocial && window.trucoSocial.toast(html, opts);
  const teamName = (g, t) => (g.teamNames && g.teamNames[t]) || `Time ${t + 1}`;

  // ---------------------------------------------------------------------------
  // Menu: partidas em andamento
  // ---------------------------------------------------------------------------
  function renderList(games) {
    if (!games.length) {
      list.innerHTML = '<li class="watch-empty"><i class="fa-solid fa-mug-hot"></i> Nenhuma partida pública em andamento agora. Volte daqui a pouco!</li>';
      return;
    }
    list.innerHTML = games.map(g => {
      const side = t => g.players.filter(p => p.team === t)
        .map(p => `${p.isBot ? '<i class="fa-solid fa-robot"></i> ' : ''}${escapeText(p.name)}`).join('<br>');
      return `
        <li class="watch-item">
          <div class="watch-head">
            <b>${escapeText(g.roomName)}</b>
            <span class="watch-tag">${g.mode === '2v2' ? 'Duplas' : '1v1'} · até ${g.limit}</span>
          </div>
          <div class="watch-teams">
            <div class="t0"><small>${escapeText(teamName(g, 0))}</small>${side(0)}</div>
            <div class="watch-score">${g.score[0]} <span>×</span> ${g.score[1]}</div>
            <div class="t1"><small>${escapeText(teamName(g, 1))}</small>${side(1)}</div>
          </div>
          <div class="watch-foot">
            <small><i class="fa-solid fa-eye"></i> ${g.spectators} ${g.spectators === 1 ? 'assistindo' : 'assistindo'}</small>
            <button type="button" class="btn btn-sm btn-primary" data-watch-room="${escapeText(g.id)}"><i class="fa-solid fa-eye"></i> Assistir</button>
          </div>
        </li>`;
    }).join('');
  }

  function load() {
    socket.emit('spectate:list', {}, res => renderList((res && res.games) || []));
  }

  function openWatch() {
    msg.textContent = '';
    list.innerHTML = '<li class="watch-empty"><span class="wait-spin"></span> Procurando partidas…</li>';
    modal.classList.remove('hide');
    load();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!modal.classList.contains('hide')) load(); else clearInterval(pollTimer); }, 5000);
  }
  function closeWatch() {
    modal.classList.add('hide');
    clearInterval(pollTimer);
  }

  function join(roomId) {
    msg.textContent = '';
    const name = (usernameInput && usernameInput.value.trim()) || '';
    socket.emit('spectate:join', { roomId, name }, res => {
      if (!res || res.error) {
        msg.textContent = (res && res.error) || 'Não deu para assistir.';
        msg.className = 'form-msg error';
        load();
        return;
      }
      closeWatch();
    });
  }

  $('open-watch-btn').addEventListener('click', openWatch);
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeWatch));
  modal.addEventListener('mousedown', e => { if (e.target === modal) closeWatch(); });
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-watch-room]');
    if (b) { b.disabled = true; join(b.dataset.watchRoom); }
  });
  $('watch-code-form').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('watch-code').value.trim().toUpperCase();
    if (code) join(code);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hide')) closeWatch(); });

  // ---------------------------------------------------------------------------
  // Assistindo: barra com o jogador escolhido, aviso do chat e rótulos
  // ---------------------------------------------------------------------------
  const bar = $('spectate-bar');
  const barText = $('spectate-text');
  const viewSel = $('spectate-view');
  const chatTitle = $('chat-title');
  const chatInput = $('chat-input');
  const CHAT_TITLE = chatTitle ? chatTitle.innerHTML : '';
  const CHAT_PLACEHOLDER = chatInput ? chatInput.placeholder : '';
  let watchingRoom = null;
  let wasAdmin = false;

  function setChatMode(s) {
    if (!chatTitle) return;
    const spectatorChat = s && s.spectating && s.state !== 'lobby';
    const count = s && !s.spectating && s.spectatorCount ? ` <small class="spec-count"><i class="fa-solid fa-eye"></i> ${s.spectatorCount} assistindo</small>` : '';
    chatTitle.innerHTML = spectatorChat
      ? '<i class="fa-solid fa-eye"></i> Conversa de quem assiste'
      : CHAT_TITLE + count;
    if (chatInput) chatInput.placeholder = spectatorChat ? 'Comentar com quem está assistindo...' : CHAT_PLACEHOLDER;
  }

  socket.on('game_state', s => {
    setChatMode(s);
    if (!s || !s.spectating) {
      bar.classList.add('hide');
      watchingRoom = null;
      return;
    }
    wasAdmin = !!s.spectatorAdmin;
    bar.classList.remove('hide');
    barText.textContent = s.spectatorAdmin
      ? `Assistindo ${s.roomName} (admin: todas as cartas)`
      : `Assistindo ${s.roomName}`;
    // Por quem ver a mesa (na sala de espera não tem mão para ver)
    const options = s.players.map((p, i) => `<option value="${i}" ${i === s.spectatorView ? 'selected' : ''}>${escapeText(p.name)}</option>`).join('');
    if (viewSel.dataset.opts !== options) { viewSel.innerHTML = options; viewSel.dataset.opts = options; }
    viewSel.value = String(s.spectatorView || 0);
    viewSel.parentElement.classList.toggle('hide', s.state === 'lobby');

    // Primeira vez nesta sala: avisa que existe uma conversa só de quem assiste
    if (watchingRoom !== s.id) {
      watchingRoom = s.id;
      const mobile = window.matchMedia('(max-width: 850px), (max-height: 500px) and (orientation: landscape)').matches;
      toast('<i class="fa-solid fa-comments"></i> <b>Você está assistindo!</b> Tem uma conversa só de quem assiste: os jogadores da mesa não veem o que vocês escrevem.', {
        key: 'spectate-chat',
        timeout: 9000,
        actions: mobile && typeof openChatDrawer === 'function' ? [{ label: 'Abrir conversa', primary: true, onClick: openChatDrawer }, { label: 'Ok' }] : [{ label: 'Entendi' }]
      });
    }
  });

  viewSel.addEventListener('change', () => socket.emit('spectate:view', { playerIdx: Number(viewSel.value) }));

  function leave() {
    const event = wasAdmin ? 'admin:unspectate' : 'spectate:leave';
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      bar.classList.add('hide');
      watchingRoom = null;
      document.body.classList.remove('spectating');
      if (typeof goHomeScreen === 'function') goHomeScreen(); else window.location.reload();
    };
    socket.emit(event, {}, go);
    setTimeout(go, 1500);
  }
  $('spectate-exit').addEventListener('click', leave);

  socket.on('spectate:ended', ({ reason }) => {
    bar.classList.add('hide');
    watchingRoom = null;
    document.body.classList.remove('spectating');
    toast(`<i class="fa-solid fa-eye-slash"></i> ${escapeText(reason || 'Você parou de assistir.')}`, { timeout: 6000 });
    if (typeof goHomeScreen === 'function') goHomeScreen();
  });

  window.trucoWatch = { open: openWatch };
})();
