// public/js/table-extras.js
// - Quadro de times da sala de espera nas duplas (estilo "dois lados")
// - Relógio da jogada (20s)
// - Avisos de conexão: "você caiu / voltando" e "fulano caiu, esperando"
// Usa `socket`, `mySeatIndex`, `myPlayerId` e `escapeText` do app.js.

(() => {
  const $ = id => document.getElementById(id);
  const LEVELS = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

  // ---------------------------------------------------------------------------
  // Quadro de times (duplas)
  // ---------------------------------------------------------------------------
  window.renderTeamsBoard = function renderTeamsBoard(gameState, container) {
    const meIdx = gameState.players.findIndex(p => p.id === myPlayerId);
    const me = gameState.players[meIdx];
    const isHost = gameState.players[0] && gameState.players[0].id === myPlayerId;
    const perTeam = gameState.maxPlayers / 2;

    const card = p => {
      const isMe = p === me;
      const canMove = isHost || isMe;
      const other = p.team === 0 ? 1 : 0;
      const arrow = p.team === 0 ? 'fa-arrow-right' : 'fa-arrow-left';
      const name = p.isBot && isHost ? escapeText(p.name.replace(/\s*\([^)]*\)\s*$/, '')) : escapeText(p.name);
      const level = p.isBot && isHost
        ? `<select class="bot-level-select" data-id="${p.id}" aria-label="Dificuldade do bot">${Object.keys(LEVELS)
          .map(k => `<option value="${k}" ${p.difficulty === k ? 'selected' : ''}>${LEVELS[k]}</option>`).join('')}</select>`
        : '';
      return `
        <div class="team-player ${p.ready ? 'ready' : ''} ${isMe ? 'me' : ''} ${p.disconnected ? 'offline' : ''}">
          <span class="tp-icon">${p.isBot ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>'}</span>
          <span class="tp-name">${name}${isMe ? ' <small>(você)</small>' : ''}${isHost && p === gameState.players[0] ? ' <small class="tp-host">dono</small>' : ''}</span>
          ${level}
          <span class="tp-status">${p.ready ? '<i class="fa-solid fa-check"></i> Pronto' : 'Aguardando'}</span>
          <span class="tp-actions">
            ${canMove ? `<button type="button" class="icon-btn small tp-move" data-move="${p.id}" data-to="${other}" title="Passar para o outro time" aria-label="Passar ${name} para o outro time"><i class="fa-solid ${arrow}"></i></button>` : ''}
            ${isHost && !isMe ? `<button type="button" class="icon-btn small danger tp-kick" data-kick="${p.id}" title="Remover" aria-label="Remover ${name}"><i class="fa-solid fa-user-xmark"></i></button>` : ''}
          </span>
        </div>`;
    };

    const column = team => {
      const members = gameState.players.filter(p => p.team === team);
      const slots = [];
      for (let i = 0; i < perTeam; i++) {
        if (members[i]) slots.push(card(members[i]));
        else {
          const canJoin = me && me.team !== team;
          slots.push(`<div class="team-player empty">
            <span class="tp-name">Vaga livre</span>
            ${canJoin ? `<button type="button" class="btn btn-sm btn-secondary" data-join-team="${team}">Entrar aqui</button>` : ''}
          </div>`);
        }
      }
      const isMine = me && me.team === team;
      return `
        <div class="team-col team-${team} ${isMine ? 'mine' : ''}">
          <div class="team-col-head">
            <span>Time ${team + 1}</span>
            ${isMine ? '<small>seu time</small>' : ''}
          </div>
          ${slots.join('')}
        </div>`;
    };

    container.innerHTML = `
      <div class="teams-board">
        ${column(0)}
        <div class="teams-vs">VS</div>
        ${column(1)}
      </div>
      ${isHost ? '<div class="teams-tools"><button type="button" class="btn btn-sm btn-secondary" id="shuffle-teams-btn"><i class="fa-solid fa-shuffle"></i> Sortear times</button><small>Use as setas para passar alguém de time. Se o outro time estiver cheio, eles trocam de lugar.</small></div>'
        : '<div class="teams-tools"><small>Use a seta para trocar de time. O dono da sala pode organizar todo mundo.</small></div>'}`;
  };

  // Cliques no quadro (delegados: o quadro é refeito a cada atualização)
  const lobbyList = $('players-lobby-list');
  lobbyList.addEventListener('click', e => {
    const move = e.target.closest('[data-move]');
    const kick = e.target.closest('[data-kick]');
    const join = e.target.closest('[data-join-team]');
    if (move) socket.emit('switch_team', { targetId: move.dataset.move, toTeam: Number(move.dataset.to) });
    else if (join) socket.emit('switch_team', { toTeam: Number(join.dataset.joinTeam) });
    else if (kick) socket.emit('kick_player', { playerId: kick.dataset.kick });
    else if (e.target.closest('#shuffle-teams-btn')) socket.emit('shuffle_teams');
  });
  lobbyList.addEventListener('change', e => {
    const sel = e.target.closest('.teams-board .bot-level-select');
    if (sel) socket.emit('set_bot_difficulty', { playerId: sel.dataset.id, difficulty: sel.value });
  });

  // ---------------------------------------------------------------------------
  // Relógio da jogada
  // ---------------------------------------------------------------------------
  const timerBox = $('turn-timer');
  const timerText = $('turn-timer-text');
  const timerFill = $('turn-timer-fill');
  let turn = null; // { idx, kind, endsAt, total }
  const KIND_TEXT = { play: 'Sua vez', truco: 'Responda o Truco', envido: 'Responda o Envido', flor: 'Responda a Flor', sing: 'Cante sua Flor' };

  function seatEl(idx) {
    if (idx == null || typeof seatOf !== 'function') return null;
    return document.getElementById(`seat-${seatOf(idx)}`);
  }

  function clearSeatTimers() {
    document.querySelectorAll('.seat-timer').forEach(el => el.remove());
  }

  function tick() {
    if (!turn) return;
    const left = Math.max(0, turn.endsAt - Date.now());
    const secs = Math.ceil(left / 1000);
    const urgent = left <= 5000;
    if (turn.idx === mySeatIndex && !(lastGameState && lastGameState.spectating)) {
      timerBox.classList.remove('hide');
      timerBox.classList.toggle('urgent', urgent);
      timerText.textContent = `${KIND_TEXT[turn.kind] || 'Sua vez'} · ${secs}s`;
      timerFill.style.width = `${Math.min(100, (left / turn.total) * 100)}%`;
    } else {
      timerBox.classList.add('hide');
    }
    // Contagem pequena no lugar de quem está jogando (os outros veem também)
    const seat = seatEl(turn.idx);
    if (seat) {
      let pill = seat.querySelector('.seat-timer');
      if (!pill) {
        clearSeatTimers();
        pill = document.createElement('span');
        pill.className = 'seat-timer';
        (seat.querySelector('.avatar-card') || seat).appendChild(pill);
      }
      pill.textContent = `${secs}s`;
      pill.classList.toggle('urgent', urgent);
    }
  }

  setInterval(tick, 250);

  socket.on('game_state', s => {
    if (s && s.turn && s.state === 'playing') {
      const endsAt = Date.now() + s.turn.endsIn;
      if (!turn || turn.idx !== s.turn.playerIdx || turn.kind !== s.turn.kind || Math.abs(turn.endsAt - endsAt) > 600) {
        turn = { idx: s.turn.playerIdx, kind: s.turn.kind, endsAt, total: s.turn.total };
        clearSeatTimers();
      }
      tick();
    } else {
      turn = null;
      timerBox.classList.add('hide');
      clearSeatTimers();
    }
    renderWaitNotice(s);
  });

  // ---------------------------------------------------------------------------
  // Alguém caiu: aviso para quem ficou, com o tempo para voltar
  // ---------------------------------------------------------------------------
  let waitBox = null;
  let waitList = [];
  function renderWaitNotice(s) {
    if (!waitBox) {
      waitBox = document.createElement('div');
      waitBox.className = 'wait-notice hide';
      waitBox.setAttribute('role', 'status');
      document.body.appendChild(waitBox);
    }
    const inTable = s && (s.state === 'playing' || s.state === 'hand_end' || s.state === 'lobby');
    waitList = inTable ? s.players.filter(p => p.disconnected && p.reconnectIn != null)
      .map(p => ({ name: p.name, until: Date.now() + p.reconnectIn })) : [];
    paintWait();
  }
  function paintWait() {
    if (!waitBox) return;
    if (!waitList.length) { waitBox.classList.add('hide'); return; }
    waitBox.classList.remove('hide');
    waitBox.innerHTML = waitList.map(w => {
      const left = Math.max(0, Math.ceil((w.until - Date.now()) / 1000));
      return `<div><span class="wait-spin"></span> <b>${escapeText(w.name)}</b> caiu · esperando voltar <b>${left}s</b></div>`;
    }).join('') + '<small>O jogo segue: se demorar na vez, a carta mais alta é jogada por ele.</small>';
  }
  setInterval(paintWait, 500);

  // ---------------------------------------------------------------------------
  // Eu caí: tela de reconexão
  // ---------------------------------------------------------------------------
  const overlay = $('conn-overlay');
  const title = $('conn-title');
  const text = $('conn-text');
  const reloadBtn = $('conn-reload');
  let inRoom = false;
  let lostTimer = null;
  const IN_GAME_KEY = 'truco_in_room';
  const mark = v => { try { v ? localStorage.setItem(IN_GAME_KEY, String(Date.now())) : localStorage.removeItem(IN_GAME_KEY); } catch (e) { /* sem armazenamento */ } };
  const wasInRoom = () => { try { const t = Number(localStorage.getItem(IN_GAME_KEY)); return t && Date.now() - t < 60000; } catch (e) { return false; } };

  function show(t, msg, withReload = false) {
    title.textContent = t;
    text.textContent = msg;
    reloadBtn.classList.toggle('hide', !withReload);
    overlay.classList.remove('hide');
  }
  const hide = () => overlay.classList.add('hide');

  // Marca que estou numa sala (para mostrar "voltando" se a página recarregar)
  setInterval(() => { if (inRoom) mark(true); }, 5000);
  socket.on('game_state', s => {
    if (!s || s.spectating) return;
    if (s.state === 'game_end') { inRoom = false; mark(false); return; }
    inRoom = true;
    mark(true);
  });

  socket.on('disconnect', reason => {
    if (!inRoom || reason === 'io client disconnect') return;
    show('Conexão perdida', 'Tentando reconectar... Seu lugar na mesa fica guardado por 30 segundos.');
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => {
      if (!socket.connected) show('Ainda sem conexão', 'Verifique a internet. Assim que voltar, você entra de novo na mesa.', true);
    }, 12000);
  });

  window.addEventListener('truco:rejoining', () => {
    if (inRoom || wasInRoom()) show('Voltando para a partida...', 'Conectado! Recuperando seu lugar na mesa.');
  });

  window.addEventListener('truco:rejoin', e => {
    clearTimeout(lostTimer);
    const res = e.detail || {};
    if (res.ok) {
      hide();
      if (window.trucoSocial) window.trucoSocial.toast('<i class="fa-solid fa-plug-circle-check"></i> Você voltou para a partida!', { kind: 'success', timeout: 3000 });
      return;
    }
    if (inRoom) {
      // Já estava na tela da mesa mas o lugar não existe mais
      inRoom = false;
      mark(false);
      show('Não deu para voltar', 'Você ficou fora por mais de 30 segundos e saiu da partida.', true);
      reloadBtn.innerHTML = '<i class="fa-solid fa-house"></i> Voltar ao início';
    } else {
      mark(false);
      hide();
    }
  });

  reloadBtn.addEventListener('click', () => window.location.reload());
  // Saiu de propósito: não mostrar "voltando"
  ['leave-room-btn', 'game-leave-btn', 'end-lobby-btn'].forEach(id => {
    const b = $(id);
    if (b) b.addEventListener('click', () => mark(false), true);
  });
  socket.on('kicked', () => { inRoom = false; mark(false); });
})();
