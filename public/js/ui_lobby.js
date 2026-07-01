// public/js/ui_lobby.js
// Interface e Controle do Lobby de Espera e Entrada

// Opções de Sala (Configuração de Pontos e Privacidade)
let selectedRoomPrivacy = false; // false = Pública, true = Privada
let selectedRoomPoints = 24; // 24, 30 ou valor customizado
let currentScoreView = localStorage.getItem('truco_score_view') || 'digital';
let currentDeckStyle = localStorage.getItem('truco_deck_style') || 'traditional';
let currentPreviewSlideIndex = 0;

// Elementos de score
const btnScoreDigital = document.getElementById('btn-score-digital');
const btnScoreSticks = document.getElementById('btn-score-sticks');
const viewScoreDigital = document.getElementById('view-score-digital');
const viewScoreSticks = document.getElementById('view-score-sticks');

function updateDeckPreview() {
  const slide = DECK_PREVIEWS[currentDeckStyle][currentPreviewSlideIndex];
  if (slide) {
    if (deckPreviewImg1) {
      deckPreviewImg1.src = slide[0];
      deckPreviewImg1.style.imageRendering = currentDeckStyle === 'pixel' ? 'pixelated' : 'auto';
    }
    if (deckPreviewImg2) {
      deckPreviewImg2.src = slide[1];
      deckPreviewImg2.style.imageRendering = currentDeckStyle === 'pixel' ? 'pixelated' : 'auto';
    }
    if (deckPreviewImg3) {
      deckPreviewImg3.src = slide[2];
      deckPreviewImg3.style.imageRendering = currentDeckStyle === 'pixel' ? 'pixelated' : 'auto';
    }
  }
}

function updateBodyDeckStyle() {
  document.body.setAttribute('data-deck-style', currentDeckStyle);
}

function updateScoreViewMode() {
  if (!btnScoreDigital || !btnScoreSticks) return;
  if (currentScoreView === 'sticks') {
    btnScoreSticks.classList.add('active');
    btnScoreDigital.classList.remove('active');
    viewScoreSticks.classList.remove('hide');
    viewScoreDigital.classList.add('hide');
  } else {
    btnScoreDigital.classList.add('active');
    btnScoreSticks.classList.remove('active');
    viewScoreDigital.classList.remove('hide');
    viewScoreSticks.classList.add('hide');
  }
}

// Inicializar carrossel de previews
if (prevPreviewBtn) {
  prevPreviewBtn.addEventListener('click', () => {
    currentPreviewSlideIndex = (currentPreviewSlideIndex - 1 + 3) % 3;
    updateDeckPreview();
  });
}

if (nextPreviewBtn) {
  nextPreviewBtn.addEventListener('click', () => {
    currentPreviewSlideIndex = (currentPreviewSlideIndex + 1) % 3;
    updateDeckPreview();
  });
}

// Opções de Deck (Tradicional vs Pixel)
deckOptions.forEach(btn => {
  if (btn.dataset.deck === currentDeckStyle) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }

  btn.addEventListener('click', (e) => {
    deckOptions.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDeckStyle = btn.dataset.deck;
    localStorage.setItem('truco_deck_style', currentDeckStyle);
    updateDeckPreview();
    updateBodyDeckStyle();
  });
});

if (btnScoreDigital && btnScoreSticks) {
  btnScoreDigital.addEventListener('click', () => {
    currentScoreView = 'digital';
    localStorage.setItem('truco_score_view', currentScoreView);
    updateScoreViewMode();
  });

  btnScoreSticks.addEventListener('click', () => {
    currentScoreView = 'sticks';
    localStorage.setItem('truco_score_view', currentScoreView);
    updateScoreViewMode();
  });
}

// Seletor de Modo (1v1 ou 2v2)
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    selectedRoomMode = e.target.dataset.mode;
  });
});

// Inicializar botões de privacidade
document.querySelectorAll('#room-privacy-group .lobby-toggle-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('#room-privacy-group .lobby-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedRoomPrivacy = btn.dataset.private === 'true';
  });
});

// Inicializar botões de limite de pontos
const customPointsInputGroup = document.getElementById('custom-points-input-group');
const customPointsInput = document.getElementById('custom-points');

document.querySelectorAll('#room-points-group .lobby-toggle-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('#room-points-group .lobby-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const val = btn.dataset.points;
    if (val === 'custom') {
      customPointsInputGroup.classList.remove('hide');
      if (customPointsInput) selectedRoomPoints = parseInt(customPointsInput.value) || 24;
    } else {
      customPointsInputGroup.classList.add('hide');
      selectedRoomPoints = parseInt(val) || 24;
    }
  });
});

// Atualizar valor customizado se mudar o input
if (customPointsInput) {
  customPointsInput.addEventListener('input', () => {
    selectedRoomPoints = parseInt(customPointsInput.value) || 24;
  });
}

// Criar Sala
document.getElementById('create-room-btn').addEventListener('click', () => {
  initAudioContext();
  const name = usernameInput.value.trim() || 'Jogador Anônimo';
  const roomName = newRoomIdInput.value.trim();

  socket.emit('create_room', {
    roomName: roomName,
    mode: selectedRoomMode,
    playerName: name,
    maxPoints: selectedRoomPoints,
    isPrivate: selectedRoomPrivacy
  });
});

// Entrar em Sala
document.getElementById('join-room-btn').addEventListener('click', () => {
  initAudioContext();
  const name = usernameInput.value.trim() || 'Jogador Anônimo';
  const code = joinRoomIdInput.value.trim().toUpperCase();

  if (!code) {
    alert('Qual o código da sala que queres entrar?');
    return;
  }

  socket.emit('join_room', {
    roomId: code,
    playerName: name
  });
});

// Adicionar Bot
document.getElementById('add-bot-btn').addEventListener('click', () => {
  const difficulty = document.getElementById('bot-difficulty-select').value;
  socket.emit('add_bot', { difficulty });
});

// Pronto
document.getElementById('ready-btn').addEventListener('click', () => {
  socket.emit('toggle_ready');
});

// Abandonar Sala
document.getElementById('leave-room-btn').addEventListener('click', () => {
  window.location.reload();
});

// Receber salas ativas
socket.on('available_rooms', (rooms) => {
  roomsList.innerHTML = '';
  if (rooms.length === 0) {
    roomsList.innerHTML = '<li class="empty-list-msg">Nenhuma sala criada no momento. Crie uma acima!</li>';
    return;
  }

  rooms.forEach(room => {
    const li = document.createElement('li');
    li.className = 'room-item';
    const displayRoomName = room.roomName || `Sala ${room.id}`;
    li.innerHTML = `
      <div class="room-info">
        <span class="room-code-badge" style="font-weight: 700;">${displayRoomName}</span>
        <span class="room-mode" style="font-size: 0.75rem; color: #bbb;">Cod: ${room.id} | ${room.mode === '1v1' ? '1v1' : '2v2'}</span>
      </div>
      <div>
        <span class="room-slots">${room.playersCount}/${room.maxPlayers} jogadores</span>
        <button class="btn btn-secondary btn-sm join-list-btn" data-id="${room.id}" style="padding: 6px 12px; font-size: 0.75rem; margin-left: 10px;">Entrar</button>
      </div>
    `;

    // Bind direto do botão entrar da lista
    li.querySelector('.join-list-btn').addEventListener('click', (e) => {
      initAudioContext();
      const name = usernameInput.value.trim() || 'Jogador Anônimo';
      const roomId = e.target.dataset.id;
      socket.emit('join_room', { roomId, playerName: name });
    });

    roomsList.appendChild(li);
  });
});

// --- RENDERIZAÇÃO DA SALA DE ESPERA (LOBBY DE ESPERA) ---
function renderLobbyScreen(gameState) {
  screenLobby.classList.remove('active');
  screenWaiting.classList.add('active');
  screenGame.classList.remove('active');
  screenGameEnd.classList.remove('active');

  waitingRoomTitle.textContent = `${gameState.roomName}`;
  waitingRoomSubtitle.textContent = `Código para Entrar: ${gameState.id} | Modo: ${gameState.mode === '1v1' ? 'Individual (1v1)' : 'Em Dupla (2v2)'} | Limite: ${gameState.maxPoints} pts`;

  // Renderizar slots de jogadores
  playersLobbyList.innerHTML = '';

  // Preencher slots
  for (let i = 0; i < gameState.maxPlayers; i++) {
    const p = gameState.players[i];
    const div = document.createElement('div');

    if (p) {
      const isMe = p.id === myPlayerId;
      const isHost = gameState.players[0] && gameState.players[0].id === myPlayerId;
      
      const canChangeTeam = gameState.mode === '2v2' && (isMe || (isHost && p.isBot));
      const changeTeamBtnHtml = canChangeTeam
        ? `<button class="change-team-btn btn btn-secondary btn-sm" data-id="${p.id}" style="margin-left: 10px; padding: 2px 8px; font-size: 0.75rem;"><i class="fa-solid fa-right-left"></i> Mudar Time</button>` 
        : '';

      const kickBtnHtml = (isHost && !isMe)
        ? `<button class="kick-player-btn btn btn-danger btn-sm" data-id="${p.id}" style="margin-left: 10px; padding: 2px 6px; font-size: 0.7rem; line-height: 1; border-radius: 4px;" title="Remover"><i class="fa-solid fa-user-xmark"></i> Remover</button>`
        : '';

      div.className = `player-slot ${p.ready ? 'ready' : ''}`;
      div.innerHTML = `
        <span class="player-slot-name">
          ${p.isBot ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>'}
          ${p.name} ${isMe ? '(Você)' : ''}
          <span style="font-size: 0.75rem; opacity: 0.7; font-weight: 700; color: ${p.team === 0 ? '#60a5fa' : '#f87171'};">
            (Time ${p.team + 1})
          </span>
          ${changeTeamBtnHtml}
          ${kickBtnHtml}
        </span>
        <span class="status-badge ${p.ready ? 'ready' : 'waiting'}">
          ${p.ready ? 'Pronto' : 'Aguardando'}
        </span>
      `;
      
      if (canChangeTeam) {
        setTimeout(() => {
          const btn = div.querySelector('.change-team-btn');
          if (btn) {
            btn.addEventListener('click', () => {
              socket.emit('switch_team', { targetId: p.id });
            });
          }
        }, 0);
      }

      if (isHost && !isMe) {
        setTimeout(() => {
          const btn = div.querySelector('.kick-player-btn');
          if (btn) {
            btn.addEventListener('click', () => {
              socket.emit('kick_player', { playerId: p.id });
            });
          }
        }, 0);
      }
    } else {
      div.className = 'player-slot';
      div.innerHTML = `
        <span class="player-slot-name" style="color: #7f8c8d; font-style: italic;">
          Vaga Aberta
        </span>
        <span class="status-badge" style="background: #333; color: #7f8c8d;">
          Livre
        </span>
      `;
    }
    playersLobbyList.appendChild(div);
  }

  // Controle de exibição do botão Adicionar Bot
  const addBotBtn = document.getElementById('add-bot-btn');
  if (gameState.players.length >= gameState.maxPlayers) {
    addBotBtn.classList.add('hide');
  } else {
    addBotBtn.classList.remove('hide');
  }

  // Texto do botão de Pronto
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  const readyBtn = document.getElementById('ready-btn');
  if (myPlayer) {
    readyBtn.innerHTML = myPlayer.ready ? '<i class="fa-solid fa-xmark"></i> Não Pronto' : '<i class="fa-solid fa-check"></i> Pronto';
    if (myPlayer.ready) {
      readyBtn.className = 'btn btn-danger';
    } else {
      readyBtn.className = 'btn btn-success';
    }
  }
}

// Inicializações de views
updateScoreViewMode();
updateDeckPreview();
updateBodyDeckStyle();
