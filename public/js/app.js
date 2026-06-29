// public/js/app.js
// Controlador do Cliente para o Truco Gaúcho

const socket = io();

// Configuração padrão das vozes do usuário (com carregamento do localStorage)
let myVoiceConfig = {
  truco: { path: '/audio/truco.ogg', pitch: 1.0 },
  retruco: { path: '/audio/retruco.ogg', pitch: 1.0 },
  vale4: { path: '', pitch: 1.0 },
  envido: { path: '/audio/envido.ogg', pitch: 1.0 },
  real_envido: { path: '', pitch: 1.0 },
  falta_envido: { path: '', pitch: 1.0 },
  flor: { path: '', pitch: 1.0 },
  contra_flor: { path: '', pitch: 1.0 },
  contra_flor_resto: { path: '', pitch: 1.0 },
  quero: { path: '/audio/quero.ogg', pitch: 1.0 },
  nao_quero: { path: '', pitch: 1.0 },
  achique: { path: '', pitch: 1.0 },
  mazo: { path: '', pitch: 1.0 },
  flor_sobre_envido: { path: '', pitch: 1.0 }
};

const VOICE_ACTIONS = [
  'truco', 'retruco', 'vale4',
  'envido', 'real_envido', 'falta_envido',
  'flor', 'contra_flor', 'contra_flor_resto',
  'quero', 'nao_quero', 'achique', 'mazo',
  'flor_sobre_envido'
];

const savedVoiceConfig = localStorage.getItem('truco_voice_config');
if (savedVoiceConfig) {
  try {
    myVoiceConfig = JSON.parse(savedVoiceConfig);
  } catch (e) {
    console.warn("Erro ao ler truco_voice_config do localStorage", e);
  }
}

// Elementos da Interface
const screenLobby = document.getElementById('screen-lobby');
const screenWaiting = document.getElementById('screen-waiting');
const screenGame = document.getElementById('screen-game');
const screenGameEnd = document.getElementById('screen-game-end');

const usernameInput = document.getElementById('username');
const newRoomIdInput = document.getElementById('new-room-id');
const joinRoomIdInput = document.getElementById('join-room-id');
const roomsList = document.getElementById('rooms-list');
const deckPreviewImg = document.getElementById('deck-preview-img');
const deckOptions = document.querySelectorAll('.deck-option');

const waitingRoomTitle = document.getElementById('waiting-room-title');
const waitingRoomSubtitle = document.getElementById('waiting-room-subtitle');
const playersLobbyList = document.getElementById('players-lobby-list');

const scoreValTeam0 = document.getElementById('score-val-team0');
const scoreValTeam1 = document.getElementById('score-val-team1');
const sticksTeam0 = document.getElementById('sticks-team0');
const sticksTeam1 = document.getElementById('sticks-team1');
const gameLogs = document.getElementById('game-logs');
const phaseBadge = document.getElementById('phase-badge');

// Elementos Mobile
const infoSidebar = document.querySelector('.info-sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const mobileScoreUs = document.getElementById('mobile-score-us');
const mobileScoreThem = document.getElementById('mobile-score-them');

const seatBottom = document.getElementById('seat-bottom');
const seatTop = document.getElementById('seat-top');
const seatLeft = document.getElementById('seat-left');
const seatRight = document.getElementById('seat-right');

const playerHand = document.getElementById('player-hand');
const gameAlertBanner = document.getElementById('game-alert-banner');
const gameAlertText = document.getElementById('game-alert-text');

// Painéis de Ações
const btnTruco = document.getElementById('btn-truco');
const btnRetruco = document.getElementById('btn-retruco');
const btnVale4 = document.getElementById('btn-vale4');
const btnEnvido = document.getElementById('btn-envido');
const btnRealEnvido = document.getElementById('btn-real-envido');
const btnFaltaEnvido = document.getElementById('btn-falta-envido');
const btnFlor = document.getElementById('btn-flor');
const btnQuero = document.getElementById('btn-quero');
const btnNaoQuero = document.getElementById('btn-nao-quero');
const btnContraFlor = document.getElementById('btn-contra-flor');
const btnContraFlorResto = document.getElementById('btn-contra-flor-resto');
const btnAchique = document.getElementById('btn-achique');
const btnFold = document.getElementById('btn-fold');

const groupTruco = document.getElementById('group-truco');
const groupEnvido = document.getElementById('group-envido');
const groupFlor = document.getElementById('group-flor');
const groupResponse = document.getElementById('group-response');
const groupFlorResponse = document.getElementById('group-flor-response');

// Elementos do Chat e Sair da Partida
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const gameLeaveBtn = document.getElementById('game-leave-btn');

// Estado local do jogador
let myPlayerId = null;
let currentRoomMode = '1v1';
let selectedRoomMode = '1v1';
let mySeatIndex = -1;
let prevPlayedCardsCount = 0;
let prevVoiceBubbles = {};
let audioInitialized = false;
let lastGameState = null; // Armazena a cópia local do estado do jogo
let gameEndTimeout = null; // Controla a transição de fim de jogo
let isClientAdminAuthenticated = false; // Controle de login no painel admin

// SVGs das Cartas por Naipe (Design Premium Customizado)
const SUIT_SVGS = {
  espadas: `
    <svg class="suit-main-svg" viewBox="0 0 100 100">
      <!-- Lâmina da Espada -->
      <path d="M50,15 L62,55 L50,58 L38,55 Z" fill="#b0c4de" stroke="#2c3e50" stroke-width="2"/>
      <line x1="50" y1="15" x2="50" y2="58" stroke="#778899" stroke-width="1.5"/>
      <!-- Guarda e Haste -->
      <path d="M30,55 C30,55 50,52 70,55 L70,60 C70,60 50,57 30,60 Z" fill="#d4af37" stroke="#996515" stroke-width="1.5"/>
      <rect x="47" y="60" width="6" height="18" fill="#8b5a2b" stroke="#3e2723" stroke-width="1.5"/>
      <!-- Pomo da espada -->
      <circle cx="50" cy="80" r="5" fill="#d4af37" stroke="#996515" stroke-width="1"/>
    </svg>
  `,
  paus: `
    <svg class="suit-main-svg" viewBox="0 0 100 100">
      <!-- Tronco do Bastão -->
      <path d="M43,80 L40,30 C40,30 50,15 60,30 L57,80 Z" fill="#8b5a2b" stroke="#3e2723" stroke-width="2"/>
      <!-- Nós de Madeira e Ranhuras -->
      <circle cx="48" cy="40" r="3" fill="#5d4037"/>
      <circle cx="52" cy="60" r="4.5" fill="#5d4037"/>
      <!-- Pequena Folha verde brotando para estilizar gaúcho -->
      <path d="M58,45 C65,40 70,45 64,52 Z" fill="#27ae60" stroke="#1e8449" stroke-width="1"/>
    </svg>
  `,
  copas: `
    <svg class="suit-main-svg" viewBox="0 0 100 100">
      <!-- Cálice de Ouro -->
      <path d="M30,20 L70,20 L68,45 C68,55 58,62 50,62 C42,62 32,55 32,45 Z" fill="#d4af37" stroke="#996515" stroke-width="2"/>
      <!-- Detalhe da borda e gemas -->
      <rect x="35" y="24" width="30" height="3" fill="#c0392b"/>
      <!-- Haste do Cálice -->
      <rect x="46" y="62" width="8" height="15" fill="#b58d3d" stroke="#996515" stroke-width="1.5"/>
      <!-- Base do Cálice -->
      <path d="M35,77 L65,77 L60,82 L40,82 Z" fill="#d4af37" stroke="#996515" stroke-width="2"/>
    </svg>
  `,
  ouros: `
    <svg class="suit-main-svg" viewBox="0 0 100 100">
      <!-- Moeda de Ouro Gaudéria com Sol no centro -->
      <circle cx="50" cy="50" r="35" fill="#f1c40f" stroke="#d4af37" stroke-width="3"/>
      <!-- Linhas internas/Relevo -->
      <circle cx="50" cy="50" r="27" fill="none" stroke="#d4af37" stroke-width="1.5" stroke-dasharray="4,4"/>
      <!-- Sol no centro -->
      <circle cx="50" cy="50" r="8" fill="#f39c12"/>
      <path d="M50,30 L50,38 M50,62 L50,70 M30,50 L38,50 M62,50 L70,50 M36,36 L42,42 M58,58 L64,64 M64,36 L58,42 M42,58 L36,64" stroke="#e67e22" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
  `
};

const SUIT_MINIS = {
  espadas: '⚔️',
  paus: '🪵',
  copas: '🏆',
  ouros: '🟡'
};

// --- CONFIGURAÇÃO E EVENTOS DO LOBBY ---

// Estilo das Cartas (Tradicional ou Pixel)
let currentDeckStyle = localStorage.getItem('truco_deck_style') || 'traditional';

function updateDeckPreview() {
  if (deckPreviewImg) {
    if (currentDeckStyle === 'pixel') {
      deckPreviewImg.src = '/pixelDeck/pixelDeck/Espada/espada1.png';
      deckPreviewImg.style.imageRendering = 'pixelated';
    } else {
      deckPreviewImg.src = '/Baralho_Espanhol_Organizado/Espadas/1.png';
      deckPreviewImg.style.imageRendering = 'auto';
    }
  }
}

function updateBodyDeckStyle() {
  document.body.setAttribute('data-deck-style', currentDeckStyle);
}

// Inicializar botões e estado no lobby
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

// Chamar no carregamento
updateDeckPreview();
updateBodyDeckStyle();

// Seletor de Modo (1v1 ou 2v2)
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    selectedRoomMode = e.target.dataset.mode;
  });
});

// Opções de Sala (Configuração de Pontos e Privacidade)
let selectedRoomPrivacy = false; // false = Pública, true = Privada
let selectedRoomPoints = 24; // 24, 30 ou valor customizado

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
  const code = newRoomIdInput.value.trim().toUpperCase();

  if (!code) {
    alert('Bota um código na sala, jogador!');
    return;
  }

  socket.emit('create_room', {
    roomId: code,
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
  socket.emit('add_bot');
});

// Pronto
document.getElementById('ready-btn').addEventListener('click', () => {
  socket.emit('toggle_ready');
});

// Abandonar Sala
document.getElementById('leave-room-btn').addEventListener('click', () => {
  window.location.reload();
});

// Botão de volume / Mudo
const audioBtn = document.getElementById('toggle-audio-btn');
audioBtn.addEventListener('click', () => {
  initAudioContext();
  window.soundManager.toggleMute();
  if (window.soundManager.muted) {
    audioBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
  } else {
    audioBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
  }
});

// Controle de Volume
document.getElementById('music-volume').addEventListener('input', (e) => {
  initAudioContext();
  window.soundManager.setMusicVolume(e.target.value);
});

function initAudioContext() {
  if (!audioInitialized) {
    window.soundManager.initAudio();
    audioInitialized = true;
  }
  window.soundManager.playMusic();
}

// Tentar tocar imediatamente ao entrar no site
try {
  initAudioContext();
} catch (e) {
  console.log("Autoplay inicial bloqueado pelo navegador.");
}

// Ouvinte para a primeira interação do usuário (caso o autoplay seja bloqueado pelo navegador)
const startAutoplay = () => {
  initAudioContext();
  window.removeEventListener('click', startAutoplay);
  window.removeEventListener('keydown', startAutoplay);
  window.removeEventListener('mousedown', startAutoplay);
  window.removeEventListener('touchstart', startAutoplay);
};

window.addEventListener('click', startAutoplay);
window.addEventListener('keydown', startAutoplay);
window.addEventListener('mousedown', startAutoplay);
window.addEventListener('touchstart', startAutoplay);

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
    li.innerHTML = `
      <div class="room-info">
        <span class="room-code-badge">${room.id}</span>
        <span class="room-mode">${room.mode === '1v1' ? 'Individual' : 'Dupla'}</span>
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

// Erros do servidor
socket.on('error_msg', (msg) => {
  alert(msg);
});

// --- RECEBIMENTO DO ESTADO DE JOGO (SOCKET PRINCIPAL) ---

socket.on('game_state', (gameState) => {
  lastGameState = gameState; // Armazena a cópia local para verificação nos botões
  myPlayerId = socket.id;
  currentRoomMode = gameState.mode;

  // Sincronizar configuração de voz local com o servidor se necessário
  const me = gameState.players.find(p => p.id === myPlayerId || p.socketId === myPlayerId);
  if (me && JSON.stringify(me.voiceConfig) !== JSON.stringify(myVoiceConfig)) {
    socket.emit('update_voice_config', myVoiceConfig);
  }

  if (gameEndTimeout) {
    clearTimeout(gameEndTimeout);
    gameEndTimeout = null;
  }

  // Atualizar visualizações com base no estado do jogo
  if (gameState.state === 'lobby') {
    renderLobbyScreen(gameState);
    if (window.soundManager) {
      window.soundManager.changeMusic('/js/truco.mp3');
    }
  } else if (gameState.state === 'playing' || gameState.state === 'hand_end') {
    renderGameScreen(gameState);
    if (window.soundManager) {
      window.soundManager.changeMusic('/js/partida.mp3');
    }
  } else if (gameState.state === 'game_end') {
    // Renderiza a mesa de jogo para mostrar o estado final do jogo por 6 segundos
    renderGameScreen(gameState);
    gameEndTimeout = setTimeout(() => {
      renderGameEndScreen(gameState);
      gameEndTimeout = null;
    }, 6000);
    if (window.soundManager) {
      window.soundManager.changeMusic('/js/partida.mp3');
    }
  }
});

// --- RENDERIZAÇÃO DA SALA DE ESPERA (LOBBY) ---
function renderLobbyScreen(gameState) {
  screenLobby.classList.remove('active');
  screenWaiting.classList.add('active');
  screenGame.classList.remove('active');
  screenGameEnd.classList.remove('active');

  waitingRoomTitle.textContent = `Sala: ${gameState.id}`;
  waitingRoomSubtitle.textContent = `Modo: ${gameState.mode === '1v1' ? 'Individual (1v1)' : 'Em Dupla (2v2)'} | Pontos para vencer: ${gameState.maxPoints}`;

  // Renderizar slots de jogadores
  playersLobbyList.innerHTML = '';

  // Preencher slots
  for (let i = 0; i < gameState.maxPlayers; i++) {
    const p = gameState.players[i];
    const div = document.createElement('div');

    if (p) {
      div.className = `player-slot ${p.ready ? 'ready' : ''}`;
      div.innerHTML = `
        <span class="player-slot-name">
          ${p.isBot ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>'}
          ${p.name} ${p.id === myPlayerId ? '(Você)' : ''}
          <span style="font-size: 0.75rem; opacity: 0.6;">(Time ${p.team})</span>
        </span>
        <span class="status-badge ${p.ready ? 'ready' : 'waiting'}">
          ${p.ready ? 'Pronto' : 'Aguardando'}
        </span>
      `;
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

// --- RENDERIZAÇÃO DA ARENA DE JOGO ---

function renderGameScreen(gameState) {
  screenLobby.classList.remove('active');
  screenWaiting.classList.remove('active');
  screenGame.classList.add('active');
  screenGameEnd.classList.remove('active');

  // 1. Encontrar o meu index nos jogadores do servidor
  mySeatIndex = gameState.players.findIndex(p => p.id === myPlayerId);

  // 2. Atualizar o Placar e Narrativa
  scoreValTeam0.textContent = String(gameState.score[0]).padStart(2, '0');
  scoreValTeam1.textContent = String(gameState.score[1]).padStart(2, '0');

  if (mobileScoreUs) mobileScoreUs.textContent = String(gameState.score[0]).padStart(2, '0');
  if (mobileScoreThem) mobileScoreThem.textContent = String(gameState.score[1]).padStart(2, '0');

  // Desenhar os palitos gaúchos (pontos)
  drawMatchsticks(sticksTeam0, gameState.score[0]);
  drawMatchsticks(sticksTeam1, gameState.score[1]);

  // Narrativas/Logs
  renderLogs(gameState.logs);

  // Fase do Jogo
  if (gameState.state === 'hand_end') {
    phaseBadge.textContent = 'Fim da Mão';
    phaseBadge.style.background = '#8e44ad';
  } else {
    phaseBadge.textContent = `Rodada ${gameState.hand.currentRound + 1}`;
    phaseBadge.style.background = '#d4af37';
  }

  // 3. Mapear Posições na Mesa (Bottom é sempre você)
  setupSeatsLayout(gameState.players, gameState.dealerIndex, gameState.hand ? gameState.hand.currentPlayer : -1);

  // 4. Se a mão estiver ativa
  if (gameState.hand) {
    // Renderizar cartas jogadas na mesa
    renderPlayedCards(gameState.hand.playedCards, gameState.players, gameState);

    // Renderizar cartas do próprio jogador
    renderMyHand(gameState.hand.hands[mySeatIndex], gameState.hand.currentPlayer === mySeatIndex && !gameState.hand.trucoResponsePending && !gameState.hand.envidoResponsePending && !gameState.hand.florResponsePending);

    // Exibir balões de voz
    renderVoiceBubbles(gameState.hand.voiceBubble, gameState.players);

    // Atualizar banner de alerta
    updateAlertBanner(gameState);

    // Habilitar/Desabilitar botões de ações
    setupActionButtons(gameState);

    // Emitir som se uma nova carta foi jogada
    const currentPlayedCount = gameState.hand.playedCards.length;
    if (currentPlayedCount > prevPlayedCardsCount) {
      window.soundManager.playCardPlaySound();
      prevPlayedCardsCount = currentPlayedCount;
    }
  } else if ((gameState.state === 'hand_end' || gameState.state === 'game_end') && gameState.lastHandSummary) {
    // Fim de mão ou de jogo: manter as cartas jogadas na mesa para visualização e mostrar resultado
    renderPlayedCards(gameState.lastHandSummary.playedCards, gameState.players);

    // Limpar mão local do jogador
    playerHand.innerHTML = '';

    // Exibir balões de voz finais da última ação (ex: "Não Quero", "Mazo"), se houver
    if (gameState.lastHandSummary.voiceBubble) {
      renderVoiceBubbles(gameState.lastHandSummary.voiceBubble, gameState.players);
    }

    // Exibir balão de resultado na barra superior
    const summary = gameState.lastHandSummary;
    const myTeam = gameState.players[mySeatIndex].team;
    const lastLog = gameState.logs && gameState.logs.length > 0 ? gameState.logs[gameState.logs.length - 1].msg : '';

    if (gameState.state === 'game_end') {
      const isGameWinner = gameState.winner === myTeam;
      if (isGameWinner) {
        gameAlertText.innerHTML = `
          <div style="color: #dfb15b; font-weight: 800; text-shadow: 0 0 10px rgba(223, 177, 91, 0.6); font-size: 1.4rem;">¡VENCEMOS A PELEIA! 🏆</div>
          <div style="font-size: 0.95rem; opacity: 0.9; margin-top: 4px; font-weight: normal; color: #fff;">${lastLog}</div>
        `;
      } else {
        gameAlertText.innerHTML = `
          <div style="color: #e74c3c; font-weight: 800; text-shadow: 0 0 10px rgba(231, 76, 60, 0.6); font-size: 1.4rem;">¡FOMOS DERROTADOS! 😢</div>
          <div style="font-size: 0.95rem; opacity: 0.9; margin-top: 4px; font-weight: normal; color: #fff;">${lastLog}</div>
        `;
      }
    } else {
      const isWinner = summary.winnerTeam === myTeam;
      const ptsText = summary.pointsWon === 1 ? '1 ponto' : `${summary.pointsWon} pontos`;
      if (isWinner) {
        gameAlertText.innerHTML = `
          <div style="color: #2ecc71; font-weight: 800; text-shadow: 0 0 10px rgba(46, 204, 113, 0.4); font-size: 1.4rem;">¡GANHAMOS A RODADA! (+${ptsText})</div>
          <div style="font-size: 0.95rem; opacity: 0.9; margin-top: 4px; font-weight: normal; color: #fff;">${lastLog}</div>
        `;
      } else {
        gameAlertText.innerHTML = `
          <div style="color: #e74c3c; font-weight: 800; text-shadow: 0 0 10px rgba(231, 76, 60, 0.4); font-size: 1.4rem;">¡ELES GANHARAM A RODADA! (+${ptsText})</div>
          <div style="font-size: 0.95rem; opacity: 0.9; margin-top: 4px; font-weight: normal; color: #fff;">${lastLog}</div>
        `;
      }
    }

    gameAlertBanner.classList.remove('hide');
    disableAllActionButtons();
    prevPlayedCardsCount = 0;
  } else {
    // Estado de transição limpa
    playerHand.innerHTML = '';
    clearPlayedCardSlots();
    hideVoiceBubbles();
    gameAlertBanner.classList.add('hide');
    disableAllActionButtons();
    prevPlayedCardsCount = 0;
  }
}

// Mapeia e atualiza visualmente os assentos de cada jogador
function setupSeatsLayout(players, dealerIndex, currentPlayerIdx) {
  // Ocultar todos por padrão
  seatLeft.classList.add('hidden-seat');
  seatRight.classList.add('hidden-seat');

  // Remover marcações ativas anteriores
  document.querySelectorAll('.player-seat').forEach(seat => {
    seat.classList.remove('active-seat');
    seat.querySelector('.seat-role').classList.remove('ready');
    seat.querySelector('.seat-role').textContent = '';
  });

  const getSeatElement = (mappedPos) => {
    if (mappedPos === 'bottom') return seatBottom;
    if (mappedPos === 'top') return seatTop;
    if (mappedPos === 'left') return seatLeft;
    if (mappedPos === 'right') return seatRight;
    return null;
  };

  const maxPlayers = players.length;

  players.forEach((p, idx) => {
    let position = 'bottom';

    if (currentRoomMode === '1v1') {
      // 1v1: Me = bottom, Oponente = top
      position = (idx === mySeatIndex) ? 'bottom' : 'top';
    } else {
      // 2v2:
      // Posição relativa a mim
      const diff = (idx - mySeatIndex + 4) % 4;
      if (diff === 0) position = 'bottom'; // Eu
      else if (diff === 1) position = 'left';  // Oponente 1
      else if (diff === 2) position = 'top';   // Parceiro
      else if (diff === 3) position = 'right'; // Oponente 2
    }

    const seat = getSeatElement(position);
    if (!seat) return;

    seat.classList.remove('hidden-seat');

    // Atualizar info
    seat.querySelector('.seat-name').textContent = p.isBot ? `🤖 ${p.name}` : p.name;

    // Distintivo do Carteador (D) ou Mão (M)
    const roleBadge = seat.querySelector('.seat-role');
    if (idx === dealerIndex) {
      roleBadge.textContent = 'Doador';
      roleBadge.classList.add('ready');
    } else if (idx === (dealerIndex + 1) % maxPlayers) {
      roleBadge.textContent = 'Mão';
    }

    // Sinalizar de quem é o turno
    if (idx === currentPlayerIdx) {
      seat.classList.add('active-seat');
    }
  });
}

// Desenha o marcador de fósforos rústicos de pontos
function drawMatchsticks(container, score) {
  container.innerHTML = '';

  if (score === 0) {
    container.innerHTML = '<span style="color: #7f8c8d; font-size: 0.8rem; font-style: italic;">Nenhum ponto</span>';
    return;
  }

  const fullBoxes = Math.floor(score / 5);
  const remainder = score % 5;

  // Criar caixas cheias (5 pontos cada)
  for (let i = 0; i < fullBoxes; i++) {
    const box = document.createElement('div');
    box.className = 'stick-group-5';
    box.innerHTML = `
      <div class="stick-line line-top"></div>
      <div class="stick-line line-right"></div>
      <div class="stick-line line-bottom"></div>
      <div class="stick-line line-left"></div>
      <div class="stick-line line-diagonal"></div>
    `;
    container.appendChild(box);
  }

  // Criar caixa incompleta para o resto
  if (remainder > 0) {
    const box = document.createElement('div');
    box.className = 'stick-group-5';

    let html = '';
    if (remainder >= 1) html += '<div class="stick-line line-top"></div>';
    if (remainder >= 2) html += '<div class="stick-line line-right"></div>';
    if (remainder >= 3) html += '<div class="stick-line line-bottom"></div>';
    if (remainder >= 4) html += '<div class="stick-line line-left"></div>';
    // Diagonal opcionalmente não cai no 5 aqui (se for 5 vira loop anterior)
    box.innerHTML = html;
    container.appendChild(box);
  }
}

// Renderiza a Narrative/logs do jogo
function renderLogs(logs) {
  gameLogs.innerHTML = '';
  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = 'log-entry';

    const timeStr = new Date(log.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `<span class="log-time">[${timeStr}]</span> ${log.msg}`;

    gameLogs.appendChild(div);
  });

  // Rolar para o final
  gameLogs.scrollTop = gameLogs.scrollHeight;
}

// Ilustrações das figuras do baralho espanhol (Sota, Cavalo, Rei)
const FIG_10_SVG = (color) => `
  <svg class="suit-main-svg" viewBox="0 0 100 100">
    <path d="M50,15 C42,15 38,22 38,32 C38,42 45,50 50,72 C55,50 62,42 62,32 C62,22 58,15 50,15 Z" fill="none" stroke="${color}" stroke-width="2.5"/>
    <circle cx="50" cy="30" r="7" fill="${color}"/>
    <line x1="32" y1="80" x2="68" y2="20" stroke="${color}" stroke-width="2.5"/>
    <polygon points="68,20 64,28 72,26" fill="${color}"/>
    <rect x="42" y="45" width="4" height="22" fill="${color}" transform="rotate(45 42 45)"/>
  </svg>
`;

const FIG_11_SVG = (color) => `
  <svg class="suit-main-svg" viewBox="0 0 100 100">
    <path d="M68,75 C68,58 58,42 58,28 C58,22 48,12 38,18 C28,24 25,35 32,40 C38,42 42,40 48,45 C54,50 52,65 45,75 Z" fill="${color}"/>
    <path d="M30,35 C35,37 45,35 48,45" fill="none" stroke="#fff" stroke-width="1.5"/>
    <path d="M22,78 C22,85 78,85 78,78" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4,4"/>
  </svg>
`;

const FIG_12_SVG = (color) => `
  <svg class="suit-main-svg" viewBox="0 0 100 100">
    <path d="M18,68 L82,68 L88,38 L72,52 L50,28 L28,52 L12,38 Z" fill="${color}" stroke="#ecdcb0" stroke-width="1.5"/>
    <rect x="22" y="68" width="56" height="6" fill="#ecdcb0" rx="3"/>
    <circle cx="50" cy="28" r="4.5" fill="#c0392b"/>
    <circle cx="12" cy="38" r="3" fill="#2980b9"/>
    <circle cx="88" cy="38" r="3" fill="#2980b9"/>
    <circle cx="28" cy="52" r="3.5" fill="#27ae60"/>
    <circle cx="72" cy="52" r="3.5" fill="#27ae60"/>
  </svg>
`;

function getCardCenterHTML(card) {
  const value = card.value;
  const suit = card.suit;

  let color = '#333';
  if (suit === 'espadas') color = '#2c3e50';
  else if (suit === 'paus') color = '#1e8449';
  else if (suit === 'copas') color = '#b03a2e';
  else if (suit === 'ouros') color = '#d4ac0d';

  if (value === 10) {
    return `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
        ${FIG_10_SVG(color)}
        <span class="card-figure-label">Sota</span>
      </div>
    `;
  }
  if (value === 11) {
    return `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
        ${FIG_11_SVG(color)}
        <span class="card-figure-label">Cavalo</span>
      </div>
    `;
  }
  if (value === 12) {
    return `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
        ${FIG_12_SVG(color)}
        <span class="card-figure-label">Rei</span>
      </div>
    `;
  }

  return SUIT_SVGS[suit];
}

function getSuitFolder(suit) {
  switch (suit) {
    case 'espadas': return 'Espadas';
    case 'paus': return 'Bastos';
    case 'copas': return 'Copas';
    case 'ouros': return 'Ouros';
    default: return '';
  }
}

function getCardImgSrc(card) {
  if (currentDeckStyle === 'pixel') {
    let suitFolder = '';
    let imgPrefix = '';
    switch (card.suit) {
      case 'espadas':
        suitFolder = 'Espada';
        imgPrefix = 'espada';
        break;
      case 'paus':
        suitFolder = 'Basto';
        imgPrefix = 'basto';
        break;
      case 'copas':
        suitFolder = 'Copa';
        imgPrefix = 'copa';
        break;
      case 'ouros':
        suitFolder = 'Oro';
        imgPrefix = 'oro';
        break;
    }
    let val = card.value;
    if (val === 10) val = 8;
    else if (val === 11) val = 9;
    else if (val === 12) val = 10;

    return `/pixelDeck/pixelDeck/${suitFolder}/${imgPrefix}${val}.png`;
  } else {
    const suitFolder = getSuitFolder(card.suit);
    return `/Baralho_Espanhol_Organizado/${suitFolder}/${card.value}.png`;
  }
}

// Renderiza a mão do jogador local (3 cartas no bottom)
function renderMyHand(cards, isMyTurn) {
  playerHand.innerHTML = '';

  if (!cards || cards.length === 0) return;

  cards.forEach((card, idx) => {
    const cardEl = document.createElement('div');
    // Classe de naipe para cor
    cardEl.className = `card ${card.suit}`;
    cardEl.dataset.idx = idx;

    // Renderizar a imagem da carta
    cardEl.innerHTML = `<img src="${getCardImgSrc(card)}" class="card-img" alt="${card.value} de ${card.suit}">`;

    // Se for meu turno e sem aposta pendente, posso clicar para jogar
    if (isMyTurn) {
      cardEl.addEventListener('click', () => {
        socket.emit('game_action', { action: 'play_card', value: idx });
      });
    } else {
      cardEl.style.cursor = 'default';
    }

    playerHand.appendChild(cardEl);
  });
}

// Desenha as cartas jogadas por rodada no centro da mesa
function renderPlayedCards(playedCards, players, gameState) {
  clearPlayedCardSlots();

  // Limpar e atualizar os vencedores das rodadas
  for (let r = 0; r < 3; r++) {
    const winnerEl = document.getElementById(`vaza-winner-${r}`);
    if (winnerEl) {
      winnerEl.textContent = '';
      winnerEl.className = 'vaza-winner';
    }
  }

  if (gameState && gameState.hand && gameState.hand.roundWinners) {
    gameState.hand.roundWinners.forEach((winnerIdx, r) => {
      const winnerEl = document.getElementById(`vaza-winner-${r}`);
      if (winnerEl) {
        if (winnerIdx === -1) {
          winnerEl.textContent = 'Empate';
          winnerEl.className = 'vaza-winner tie';
        } else {
          const winnerPlayer = gameState.players[winnerIdx];
          const myTeam = gameState.players[mySeatIndex].team;
          if (winnerPlayer.team === myTeam) {
            winnerEl.textContent = 'Nós';
            winnerEl.className = 'vaza-winner win-us';
          } else {
            winnerEl.textContent = 'Eles';
            winnerEl.className = 'vaza-winner win-them';
          }
        }
      }
    });
  }

  playedCards.forEach(play => {
    // Determinar em qual assento o jogador está sentado
    let seat = 'bottom';
    const playerIdx = play.playerIdx;

    if (currentRoomMode === '1v1') {
      seat = (playerIdx === mySeatIndex) ? 'bottom' : 'top';
    } else {
      const diff = (playerIdx - mySeatIndex + 4) % 4;
      if (diff === 0) seat = 'bottom';
      else if (diff === 1) seat = 'left';
      else if (diff === 2) seat = 'top';
      else if (diff === 3) seat = 'right';
    }

    const round = play.round; // 0, 1 ou 2
    const slotId = `slot-v${round}-${seat}`;
    const slot = document.getElementById(slotId);

    if (slot) {
      const card = play.card;
      // Cria a carta miniatura para a mesa
      const cardEl = document.createElement('div');
      cardEl.className = `played-card ${card.suit}`;
      cardEl.innerHTML = `<img src="${getCardImgSrc(card)}" class="card-img" alt="${card.value} de ${card.suit}">`;
      slot.appendChild(cardEl);
    }
  });
}

function clearPlayedCardSlots() {
  document.querySelectorAll('.played-card-slot').forEach(slot => {
    slot.innerHTML = '';
  });
}

// Exibe balões de diálogo
function renderVoiceBubbles(voiceBubbles, players) {
  hideVoiceBubbles();

  if (!voiceBubbles) return;

  Object.keys(voiceBubbles).forEach(key => {
    const playerIdx = parseInt(key);
    const text = voiceBubbles[playerIdx];

    let seat = 'bottom';
    if (currentRoomMode === '1v1') {
      seat = (playerIdx === mySeatIndex) ? 'bottom' : 'top';
    } else {
      const diff = (playerIdx - mySeatIndex + 4) % 4;
      if (diff === 0) seat = 'bottom';
      else if (diff === 1) seat = 'left';
      else if (diff === 2) seat = 'top';
      else if (diff === 3) seat = 'right';
    }

    const bubble = document.getElementById(`bubble-${seat}`);
    if (bubble) {
      // Se for o áudio especial de flor sobre envido, mostra apenas "FLOR" no balão visual
      let displayText = text;
      if (text === '¡FLOR_SOBRE_ENVIDO!') {
        displayText = '¡FLOR!';
      }
      bubble.textContent = displayText;
      bubble.classList.add('show');

      // Tocar som de grito se for um grito novo (usa voz)
      if (prevVoiceBubbles[playerIdx] !== text) {
        const playerObj = players && players[playerIdx];
        const customConfig = playerObj ? playerObj.voiceConfig : null;
        window.soundManager.playVoiceChant(text, customConfig);
      }
    }
  });

  prevVoiceBubbles = { ...voiceBubbles };
}

function hideVoiceBubbles() {
  document.querySelectorAll('.voice-bubble').forEach(b => {
    b.classList.remove('show');
    b.textContent = '';
  });
}

// Alertas de turnos e apostas pendentes
function updateAlertBanner(gameState) {
  gameAlertBanner.classList.add('hide');

  const hand = gameState.hand;
  const myTeam = gameState.players[mySeatIndex].team;

  // 1. Resposta pendente de Flor para o meu time
  if (hand.florResponsePending && hand.florPendingTeam === myTeam) {
    gameAlertText.textContent = `Flor cantada! Tens contra-flor para rebater?`;
    gameAlertBanner.classList.remove('hide');
    return;
  }

  // 2. Resposta pendente de Envido para o meu time
  if (hand.envidoResponsePending && hand.envidoPendingTeam === myTeam) {
    const currentCall = hand.envidoChant;
    gameAlertText.textContent = `Eles gritaram ${currentCall}! Aceitas a aposta?`;
    gameAlertBanner.classList.remove('hide');
    return;
  }

  // 3. Resposta pendente de Truco para o meu time
  if (hand.trucoResponsePending && hand.trucoPendingTeam === myTeam) {
    gameAlertText.textContent = `Time adversário gritou ${hand.trucoChant}! O que fazes?`;
    gameAlertBanner.classList.remove('hide');
    return;
  }

  // 4. Vez normal de jogar
  if (hand.currentPlayer === mySeatIndex) {
    gameAlertText.textContent = 'É a tua vez de jogar, jogador!';
    gameAlertBanner.classList.remove('hide');
  }
}

function showAndEnableButton(btn) {
  if (!btn) return;
  btn.classList.remove('hide');
  btn.disabled = false;
}

// Configura dinamicamente os botões que o jogador pode clicar
function setupActionButtons(gameState) {
  disableAllActionButtons(gameState);

  const hand = gameState.hand;
  const myPlayer = gameState.players[mySeatIndex];
  const myTeam = myPlayer.team;
  const isMyTurn = hand.currentPlayer === mySeatIndex;

  const statusEl = document.getElementById('action-panel-status');

  // --- SE HOUVER APOSTA PENDENTE PARA O MEU TIME RESPONDER ---

  if (hand.trucoResponsePending && hand.trucoPendingTeam === myTeam) {
    if (statusEl) statusEl.classList.add('hide');
    groupResponse.classList.remove('hide');
    showAndEnableButton(btnQuero);
    showAndEnableButton(btnNaoQuero);

    // Opções de Aumentar Truco
    if (hand.trucoState === 'truco') {
      showAndEnableButton(btnRetruco);
    } else if (hand.trucoState === 'retruco') {
      showAndEnableButton(btnVale4);
    }

    // Os adversários do Truco podem chamar Envido/Flor antes de aceitar o Truco
    // Só na primeira rodada e se o jogador não jogou ainda
    const myCards = hand.hands[mySeatIndex] || [];
    const hasNotPlayedYet = myCards.length === 3;
    if (hand.currentRound === 0 && hasNotPlayedYet && hand.canCallEnvido) {
      if (!myPlayer.hasFlor && hand.envidoState === 'none') {
        groupEnvido.classList.remove('hide');
        showAndEnableButton(btnEnvido);
        showAndEnableButton(btnRealEnvido);
        showAndEnableButton(btnFaltaEnvido);
      }
      if (myPlayer.hasFlor && hand.florState === 'none') {
        groupFlor.classList.remove('hide');
        showAndEnableButton(btnFlor);
      }
    }
    return; // Impede outras ações simultâneas
  }

  if (hand.envidoResponsePending && hand.envidoPendingTeam === myTeam) {
    if (statusEl) statusEl.classList.add('hide');
    groupResponse.classList.remove('hide');
    showAndEnableButton(btnQuero);
    showAndEnableButton(btnNaoQuero);

    // Pode repicar o Envido se for a primeira rodada
    if (hand.currentRound === 0) {
      groupEnvido.classList.remove('hide');

      const history = hand.envidoHistory || [];
      const lastCall = history[history.length - 1];

      if (lastCall === 'envido') {
        const envidoCount = history.filter(c => c === 'envido').length;
        if (envidoCount < 2) {
          showAndEnableButton(btnEnvido);
        }
        showAndEnableButton(btnRealEnvido);
      } else if (lastCall === 'real_envido') {
        showAndEnableButton(btnFaltaEnvido);
      }

      // Pode cantar Flor se tiver Flor (cancela o Envido)
      if (myPlayer.hasFlor && hand.florState === 'none') {
        groupFlor.classList.remove('hide');
        showAndEnableButton(btnFlor);
      }
    }
    return;
  }

  if (hand.florResponsePending && hand.florPendingTeam === myTeam) {
    if (statusEl) statusEl.classList.add('hide');
    groupFlorResponse.classList.remove('hide');
    showAndEnableButton(btnContraFlor);
    showAndEnableButton(btnContraFlorResto);
    showAndEnableButton(btnAchique);
    return;
  }

  // --- AÇÕES QUE PODEM SER CHAMADAS EM QUALQUER MOMENTO (INDEPENDENTE DE TURNO) ---
  // Desde que não haja nenhuma resposta pendente na mesa
  const noResponsePending = !hand.trucoResponsePending && !hand.envidoResponsePending && !hand.florResponsePending;

  if (noResponsePending) {
    // 1. Botão de Truco / Retruco / Vale 4
    if (hand.trucoCallerTeam !== myTeam) {
      groupTruco.classList.remove('hide');
      if (hand.trucoState === 'none') {
        showAndEnableButton(btnTruco);
      } else if (hand.trucoState === 'truco') {
        showAndEnableButton(btnRetruco);
      } else if (hand.trucoState === 'retruco') {
        showAndEnableButton(btnVale4);
      }
    }

    // Só na primeira rodada e se eu tiver 3 cartas (ou seja, não joguei ainda)
    const myCards = hand.hands[mySeatIndex] || [];
    const hasNotPlayedYet = myCards.length === 3;

    if (hand.currentRound === 0 && hasNotPlayedYet && hand.canCallEnvido) {
      // 2. Botão de Envido / Real / Falta
      if (!myPlayer.hasFlor && hand.envidoState === 'none') {
        groupEnvido.classList.remove('hide');
        showAndEnableButton(btnEnvido);
        showAndEnableButton(btnRealEnvido);
        showAndEnableButton(btnFaltaEnvido);
      }

      // 3. Botão de Flor
      if (myPlayer.hasFlor && hand.florState === 'none') {
        groupFlor.classList.remove('hide');
        showAndEnableButton(btnFlor);
      }
    }
  }

  // --- SE FOR O MEU TURNO NORMAL DE JOGAR ---
  if (isMyTurn) {
    if (statusEl) statusEl.classList.add('hide');
    // Mazo (Sempre ativo no turno)
    showAndEnableButton(btnFold);
  }
}

function disableAllActionButtons(gameState) {
  // Esconder grupos de resposta que são apenas contextuais
  groupResponse.classList.add('hide');
  btnQuero.classList.add('hide');
  btnNaoQuero.classList.add('hide');

  groupFlorResponse.classList.add('hide');
  btnContraFlor.classList.add('hide');
  btnContraFlorResto.classList.add('hide');
  btnAchique.classList.add('hide');

  // Mostrar os botões padrão de ações, mas desativados
  groupTruco.classList.remove('hide');
  btnTruco.classList.remove('hide');
  btnTruco.disabled = true;
  btnRetruco.classList.add('hide'); // Esconder aumentos do oponente
  btnVale4.classList.add('hide');

  groupEnvido.classList.remove('hide');
  btnEnvido.classList.remove('hide');
  btnEnvido.disabled = true;
  btnRealEnvido.classList.remove('hide');
  btnRealEnvido.disabled = true;
  btnFaltaEnvido.classList.remove('hide');
  btnFaltaEnvido.disabled = true;

  groupFlor.classList.remove('hide');
  btnFlor.classList.remove('hide');
  btnFlor.disabled = true;

  btnFold.classList.remove('hide');
  btnFold.disabled = true;

  // Mostrar status de vez do adversário
  const statusEl = document.getElementById('action-panel-status');
  if (statusEl) {
    statusEl.classList.remove('hide');
    if (gameState) {
      if (gameState.state === 'hand_end') {
        statusEl.textContent = 'Mão finalizada. Aguardando...';
      } else if (gameState.state === 'game_end') {
        statusEl.textContent = 'Partida terminada!';
      } else {
        statusEl.textContent = 'Vez do adversário jogar...';
      }
    } else {
      statusEl.textContent = 'Vez do adversário jogar...';
    }
  }
}

// --- CLIQUE NOS BOTÕES DE AÇÕES ---

// Botoes Truco
btnTruco.addEventListener('click', () => socket.emit('game_action', { action: 'call_truco' }));
btnRetruco.addEventListener('click', () => {
  // Pode ser resposta ou grito de turno
  const hand = prevVoiceBubbles; // Apenas fallback
  socket.emit('game_action', { action: 'truco_raise', value: 'retruco' });
});
btnVale4.addEventListener('click', () => {
  socket.emit('game_action', { action: 'truco_raise', value: 'vale4' });
});

// Botoes Envido
btnEnvido.addEventListener('click', () => socket.emit('game_action', { action: 'call_envido', value: 'envido' }));
btnRealEnvido.addEventListener('click', () => socket.emit('game_action', { action: 'call_envido', value: 'real_envido' }));
btnFaltaEnvido.addEventListener('click', () => socket.emit('game_action', { action: 'call_envido', value: 'falta_envido' }));

// Flor
btnFlor.addEventListener('click', () => socket.emit('game_action', { action: 'call_flor' }));

// Quero / Não Quero (decidido contextualmente com base na aposta pendente)
btnQuero.addEventListener('click', () => {
  if (!lastGameState || !lastGameState.hand) return;
  const myTeam = lastGameState.players[mySeatIndex].team;
  if (lastGameState.hand.trucoResponsePending && lastGameState.hand.trucoPendingTeam === myTeam) {
    socket.emit('game_action', { action: 'truco_response', value: 'quero' });
  } else if (lastGameState.hand.envidoResponsePending && lastGameState.hand.envidoPendingTeam === myTeam) {
    socket.emit('game_action', { action: 'envido_response', value: 'quero' });
  } else if (lastGameState.hand.florResponsePending && lastGameState.hand.florPendingTeam === myTeam) {
    socket.emit('game_action', { action: 'flor_response', value: 'quero' });
  }
});

btnNaoQuero.addEventListener('click', () => {
  if (!lastGameState || !lastGameState.hand) return;
  const myTeam = lastGameState.players[mySeatIndex].team;
  if (lastGameState.hand.trucoResponsePending && lastGameState.hand.trucoPendingTeam === myTeam) {
    socket.emit('game_action', { action: 'truco_response', value: 'nao_quero' });
  } else if (lastGameState.hand.envidoResponsePending && lastGameState.hand.envidoPendingTeam === myTeam) {
    socket.emit('game_action', { action: 'envido_response', value: 'nao_quero' });
  } else if (lastGameState.hand.florResponsePending && lastGameState.hand.florPendingTeam === myTeam) {
    socket.emit('game_action', { action: 'flor_response', value: 'nao_quero' });
  }
});

// Contra-Flor
btnContraFlor.addEventListener('click', () => socket.emit('game_action', { action: 'flor_response', value: 'contra_flor' }));
btnContraFlorResto.addEventListener('click', () => socket.emit('game_action', { action: 'flor_response', value: 'contra_flor_resto' }));
btnAchique.addEventListener('click', () => socket.emit('game_action', { action: 'flor_response', value: 'nao_quero' }));

// Ir ao baralho
btnFold.addEventListener('click', () => {
  socket.emit('game_action', { action: 'fold' });
});

// --- RENDERIZAÇÃO DA TELA DE VITÓRIA ---

function renderGameEndScreen(gameState) {
  screenLobby.classList.remove('active');
  screenWaiting.classList.remove('active');
  screenGame.classList.remove('active');
  screenGameEnd.classList.add('active');

  const winner = gameState.winner;
  const isMyTeamWinner = gameState.players[mySeatIndex].team === winner;

  if (isMyTeamWinner) {
    document.getElementById('victory-title').textContent = 'Vitória Campeira!';
    document.getElementById('victory-title').style.color = 'var(--gold)';
    window.soundManager.playVictorySound();
  } else {
    document.getElementById('victory-title').textContent = 'Fomos Derrotados!';
    document.getElementById('victory-title').style.color = '#c0392b';
  }

  document.getElementById('final-score-t0').textContent = gameState.score[0];
  document.getElementById('final-score-t1').textContent = gameState.score[1];
}

// Botão Jogar Novamente
document.getElementById('restart-game-btn').addEventListener('click', () => {
  socket.emit('restart_game');
});

// --- LÓGICA DE CHAT E SAIR DA PARTIDA ---

// Enviar mensagens no chat
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) {
    socket.emit('send_chat', text);
    chatInput.value = '';
  }
});

// Receber mensagens de chat
socket.on('receive_chat', ({ sender, senderId, msg }) => {
  const isSelf = senderId === socket.id;
  const div = document.createElement('div');
  div.className = `chat-bubble ${isSelf ? 'self' : ''}`;
  div.innerHTML = `
    <span class="chat-sender">${sender}</span>
    <span class="chat-text">${msg}</span>
  `;
  chatMessages.appendChild(div);

  // Rolar para o final do chat
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Sair da Partida
gameLeaveBtn.addEventListener('click', () => {
  if (confirm("Tens certeza que queres abandonar a partida e voltar ao lobby, jogador?")) {
    window.location.reload();
  }
});

// --- CONFIGURAÇÃO DE VOZES / PERSONALIZAÇÃO EVENTOS ---

// Elementos da Configuração de Vozes
const btnVoiceSettings = document.getElementById('voice-settings-btn');
const modalVoiceSettings = document.getElementById('modal-voice-settings');
const btnCloseVoiceSettings = document.getElementById('close-voice-settings');
const btnSaveVoiceSettings = document.getElementById('save-voice-settings');

// Sincronizar UI com as configurações locais
function syncVoiceSettingsUI() {
  VOICE_ACTIONS.forEach(action => {
    const el = document.getElementById(`select-voice-${action}`);
    if (el && myVoiceConfig[action]) {
      el.value = myVoiceConfig[action].path;
    }
  });

  // Atualizar botões de pitch ativos
  document.querySelectorAll('.pitch-btn').forEach(btn => {
    const action = btn.getAttribute('data-action');
    const pitch = parseFloat(btn.getAttribute('data-pitch'));
    if (myVoiceConfig[action] && Math.abs(myVoiceConfig[action].pitch - pitch) < 0.05) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Abrir modal de configurações
if (btnVoiceSettings) {
  btnVoiceSettings.addEventListener('click', () => {
    syncVoiceSettingsUI();
    modalVoiceSettings.classList.remove('hide');
  });
}

// Fechar modal
if (btnCloseVoiceSettings) {
  btnCloseVoiceSettings.addEventListener('click', () => {
    modalVoiceSettings.classList.add('hide');
  });
}

// Evento nos botões de pitch para alternar classe ativo e atualizar localmente
document.querySelectorAll('.pitch-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const action = btn.getAttribute('data-action');
    const pitch = parseFloat(btn.getAttribute('data-pitch'));

    // Desativar outros botões de pitch para a mesma ação
    document.querySelectorAll(`.pitch-btn[data-action="${action}"]`).forEach(b => {
      b.classList.remove('active');
    });

    btn.classList.add('active');
    if (!myVoiceConfig[action]) myVoiceConfig[action] = { path: '', pitch: 1.0 };
    myVoiceConfig[action].pitch = pitch;
  });
});

// Eventos de mudança nos dropdowns de áudio base (dinâmico)
VOICE_ACTIONS.forEach(action => {
  const el = document.getElementById(`select-voice-${action}`);
  if (el) {
    el.addEventListener('change', (e) => {
      if (!myVoiceConfig[action]) myVoiceConfig[action] = { path: '', pitch: 1.0 };
      myVoiceConfig[action].path = e.target.value;
    });
  }
});

// Testar som individualmente (preview)
document.querySelectorAll('.btn-preview-voice').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const action = btn.getAttribute('data-action');
    const config = myVoiceConfig[action];

    if (window.soundManager && config) {
      window.soundManager.initAudio();

      let path = config.path;
      if (!path) {
        // Fallback padrão se não selecionado
        path = `/audio/${action}.ogg`;
      }

      const audio = new Audio(path);
      audio.volume = window.soundManager.sfxVolume;
      audio.playbackRate = config.pitch;
      audio.play().catch(err => {
        console.warn("Falha ao tocar preview de áudio", err);
        window.soundManager.playChantAlertSound();
      });
    }
  });
});

// Salvar e aplicar
if (btnSaveVoiceSettings) {
  btnSaveVoiceSettings.addEventListener('click', () => {
    localStorage.setItem('truco_voice_config', JSON.stringify(myVoiceConfig));
    modalVoiceSettings.classList.add('hide');

    // Se o jogo estiver ativo, envia para o servidor
    if (lastGameState) {
      socket.emit('update_voice_config', myVoiceConfig);
    }

    // Tocar um feedback sonoro amigável
    if (window.soundManager) {
      window.soundManager.playVictorySound();
    }
  });
}

// --- PAINEL ADMIN (TESTES) EVENTOS ---
const btnAdminPanel = document.getElementById('admin-panel-btn');
const modalAdminPanel = document.getElementById('modal-admin-panel');
const btnCloseAdminPanel = document.getElementById('close-admin-panel');
const btnApplyAdminCards = document.getElementById('apply-admin-cards');

const selectAdminCard1 = document.getElementById('select-admin-card1');
const selectAdminCard2 = document.getElementById('select-admin-card2');
const selectAdminCard3 = document.getElementById('select-admin-card3');

// Lista completa das 40 cartas do baralho espanhol
const ALL_DECK_CARDS = [];
const suitsBr = { espadas: 'Espadas', paus: 'Paus', copas: 'Copas', ouros: 'Ouros' };
const suitsEmoji = { espadas: '⚔️', paus: '🌿', copas: '❤️', ouros: '🪙' };

['espadas', 'paus', 'copas', 'ouros'].forEach(suit => {
  [1, 2, 3, 4, 5, 6, 7, 10, 11, 12].forEach(value => {
    ALL_DECK_CARDS.push({ value, suit });
  });
});

function populateAdminCardSelects() {
  const selects = [selectAdminCard1, selectAdminCard2, selectAdminCard3];
  selects.forEach(select => {
    if (!select) return;
    select.innerHTML = '';
    ALL_DECK_CARDS.forEach(card => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(card);

      let label = `${card.value} de ${suitsBr[card.suit]}`;
      if (card.value === 1 && card.suit === 'espadas') label += ' (Espadilha)';
      else if (card.value === 1 && card.suit === 'paus') label += ' (Bastião)';
      else if (card.value === 7 && card.suit === 'espadas') label += ' (7 de Espadas)';
      else if (card.value === 7 && card.suit === 'ouros') label += ' (7 de Ouros)';

      opt.textContent = `${suitsEmoji[card.suit]} ${label}`;
      select.appendChild(opt);
    });
  });
}

// Abrir modal Admin
if (btnAdminPanel) {
  btnAdminPanel.addEventListener('click', () => {
    if (!lastGameState || lastGameState.state !== 'playing' || !lastGameState.hand) {
      alert("Tens que estar jogando uma rodada para alterar as tuas cartas, jogador!");
      return;
    }
    if (isClientAdminAuthenticated) {
      populateAdminCardSelects();
      modalAdminPanel.classList.remove('hide');
    } else {
      const password = prompt("Digite a senha de administrador para acessar o painel:");
      if (password) {
        socket.emit('validate_admin', { password });
      }
    }
  });
}

// Escutar retorno de autenticação do administrador
socket.on('admin_validated', () => {
  isClientAdminAuthenticated = true;
  populateAdminCardSelects();
  modalAdminPanel.classList.remove('hide');
});

// Fechar modal Admin
if (btnCloseAdminPanel) {
  btnCloseAdminPanel.addEventListener('click', () => {
    modalAdminPanel.classList.add('hide');
  });
}

// Aplicar as cartas escolhidas
if (btnApplyAdminCards) {
  btnApplyAdminCards.addEventListener('click', () => {
    const c1 = JSON.parse(selectAdminCard1.value);
    const c2 = JSON.parse(selectAdminCard2.value);
    const c3 = JSON.parse(selectAdminCard3.value);

    socket.emit('game_action', {
      action: 'admin_set_cards',
      value: [c1, c2, c3]
    });

    modalAdminPanel.classList.add('hide');

    // Tocar um feedback sonoro amigável
    if (window.soundManager) {
      window.soundManager.playVictorySound();
    }
  });
}

// Toggle da Gaveta Lateral (Mobile)
if (sidebarToggleBtn && infoSidebar) {
  sidebarToggleBtn.addEventListener('click', () => {
    infoSidebar.classList.add('open');
    if (sidebarOverlay) {
      sidebarOverlay.classList.remove('hide');
    }
  });
}

if (sidebarCloseBtn && infoSidebar) {
  sidebarCloseBtn.addEventListener('click', () => {
    infoSidebar.classList.remove('open');
    if (sidebarOverlay) {
      sidebarOverlay.classList.add('hide');
    }
  });
}

if (sidebarOverlay && infoSidebar) {
  sidebarOverlay.addEventListener('click', () => {
    infoSidebar.classList.remove('open');
    sidebarOverlay.classList.add('hide');
  });
}
