// public/js/app.js
// Controlador e Orquestrador Principal do Cliente para o Truco Gaúcho

const socket = window.location.hostname.includes('vercel.app') 
  ? io('https://truco-river.onrender.com') 
  : io();

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

// Elementos da Interface Geral
const screenLobby = document.getElementById('screen-lobby');
const screenWaiting = document.getElementById('screen-waiting');
const screenGame = document.getElementById('screen-game');
const screenGameEnd = document.getElementById('screen-game-end');

const usernameInput = document.getElementById('username');
const newRoomIdInput = document.getElementById('new-room-id');
const joinRoomIdInput = document.getElementById('join-room-id');
const roomsList = document.getElementById('rooms-list');
const waitingRoomTitle = document.getElementById('waiting-room-title');
const waitingRoomSubtitle = document.getElementById('waiting-room-subtitle');
const playersLobbyList = document.getElementById('players-lobby-list');

const deckPreviewImg1 = document.getElementById('deck-preview-img-1');
const deckPreviewImg2 = document.getElementById('deck-preview-img-2');
const deckPreviewImg3 = document.getElementById('deck-preview-img-3');
const prevPreviewBtn = document.getElementById('prev-preview-btn');
const nextPreviewBtn = document.getElementById('next-preview-btn');
const deckOptions = document.querySelectorAll('.deck-option');

const scoreValTeam0 = document.getElementById('score-val-team0');
const scoreValTeam1 = document.getElementById('score-val-team1');
const sticksTeam0 = document.getElementById('sticks-team0');
const sticksTeam1 = document.getElementById('sticks-team1');
const gameLogs = document.getElementById('game-logs');
const phaseBadge = document.getElementById('phase-badge');

const playerHand = document.getElementById('player-hand');

// Elementos de Configurações Mobile / Desktop Unificados
const mobileSettingsToggleBtn = document.getElementById('mobile-settings-toggle-btn');
const desktopSettingsToggleBtn = document.getElementById('mobile-settings-toggle-btn-desktop');
const modalMobileSettings = document.getElementById('modal-mobile-settings');
const closeMobileSettings = document.getElementById('close-mobile-settings');
const mobileMuteBtn = document.getElementById('mobile-mute-btn');
const mobileVolumeSlider = document.getElementById('mobile-volume-slider');
const mobileVoiceBtn = document.getElementById('mobile-voice-btn');
const mobileAdminBtn = document.getElementById('mobile-admin-btn');
const audioBtn = document.getElementById('toggle-audio-btn');

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

const btnEnvidoMobileTrigger = document.getElementById('btn-envido-mobile-trigger');
const groupEnvidoMobileSub = document.getElementById('group-envido-mobile-sub');
const btnEnvidoSubEnvido = document.getElementById('btn-envido-sub-envido');
const btnRealEnvidoSubReal = document.getElementById('btn-envido-sub-real');
const btnFaltaEnvidoSubFalta = document.getElementById('btn-envido-sub-falta');
const btnEnvidoSubFlor = document.getElementById('btn-envido-sub-flor');
const btnEnvidoSubBack = document.getElementById('btn-envido-sub-back');

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
let lastGameState = null; 
let gameEndTimeout = null; 
let isClientAdminAuthenticated = false; 

// --- INICIALIZAÇÃO DE ÁUDIO ---
function initAudioContext() {
  if (!audioInitialized) {
    window.soundManager.initAudio();
    audioInitialized = true;
  }
  window.soundManager.playMusic();
}

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

// Tentar tocar imediatamente ao entrar no site
try {
  initAudioContext();
} catch (e) {
  console.log("Autoplay inicial bloqueado pelo navegador.");
}

// --- CONTROLES DE AJUSTES/SOM UNIFICADOS ---
const openSettingsFunc = () => {
  initAudioContext();
  if (modalMobileSettings) {
    modalMobileSettings.classList.remove('hide');
    if (window.soundManager) {
      if (window.soundManager.muted) {
        mobileMuteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
      } else {
        mobileMuteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
      }
      mobileVolumeSlider.value = window.soundManager.musicVolume;
    }
  }
};

if (mobileSettingsToggleBtn) mobileSettingsToggleBtn.addEventListener('click', openSettingsFunc);
if (desktopSettingsToggleBtn) desktopSettingsToggleBtn.addEventListener('click', openSettingsFunc);

if (closeMobileSettings) {
  closeMobileSettings.addEventListener('click', () => {
    modalMobileSettings.classList.add('hide');
  });
}

if (mobileMuteBtn) {
  mobileMuteBtn.addEventListener('click', () => {
    initAudioContext();
    window.soundManager.toggleMute();
    if (window.soundManager.muted) {
      mobileMuteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
      if (audioBtn) audioBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else {
      mobileMuteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
      if (audioBtn) audioBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }
  });
}

if (mobileVolumeSlider) {
  mobileVolumeSlider.addEventListener('input', (e) => {
    initAudioContext();
    const vol = parseFloat(e.target.value);
    window.soundManager.setMusicVolume(vol);
    const desktopSlider = document.getElementById('music-volume');
    if (desktopSlider) desktopSlider.value = vol;
  });
}

if (mobileVoiceBtn) {
  mobileVoiceBtn.addEventListener('click', () => {
    modalMobileSettings.classList.add('hide');
    const voiceSettingsBtn = document.getElementById('voice-settings-btn');
    if (voiceSettingsBtn) voiceSettingsBtn.click();
  });
}

if (mobileAdminBtn) {
  mobileAdminBtn.addEventListener('click', () => {
    modalMobileSettings.classList.add('hide');
    const adminPanelBtn = document.getElementById('admin-panel-btn');
    if (adminPanelBtn) adminPanelBtn.click();
  });
}

// --- CONFIGURAÇÃO DE VOZES / PERSONALIZAÇÃO EVENTOS ---
const btnVoiceSettings = document.getElementById('voice-settings-btn');
const modalVoiceSettings = document.getElementById('modal-voice-settings');
const btnCloseVoiceSettings = document.getElementById('close-voice-settings');
const btnSaveVoiceSettings = document.getElementById('save-voice-settings');

function syncVoiceSettingsUI() {
  VOICE_ACTIONS.forEach(action => {
    const el = document.getElementById(`select-voice-${action}`);
    if (el && myVoiceConfig[action]) {
      el.value = myVoiceConfig[action].path;
    }
  });

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

if (btnVoiceSettings) {
  btnVoiceSettings.addEventListener('click', () => {
    syncVoiceSettingsUI();
    modalVoiceSettings.classList.remove('hide');
  });
}

if (btnCloseVoiceSettings) {
  btnCloseVoiceSettings.addEventListener('click', () => {
    modalVoiceSettings.classList.add('hide');
  });
}

document.querySelectorAll('.pitch-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.getAttribute('data-action');
    const pitch = parseFloat(btn.getAttribute('data-pitch'));

    document.querySelectorAll(`.pitch-btn[data-action="${action}"]`).forEach(b => {
      b.classList.remove('active');
    });

    btn.classList.add('active');
    if (!myVoiceConfig[action]) myVoiceConfig[action] = { path: '', pitch: 1.0 };
    myVoiceConfig[action].pitch = pitch;
  });
});

VOICE_ACTIONS.forEach(action => {
  const el = document.getElementById(`select-voice-${action}`);
  if (el) {
    el.addEventListener('change', (e) => {
      if (!myVoiceConfig[action]) myVoiceConfig[action] = { path: '', pitch: 1.0 };
      myVoiceConfig[action].path = e.target.value;
    });
  }
});

document.querySelectorAll('.btn-preview-voice').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.getAttribute('data-action');
    const config = myVoiceConfig[action];

    if (window.soundManager && config) {
      window.soundManager.initAudio();
      let path = config.path || `/audio/${action}.ogg`;

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

if (btnSaveVoiceSettings) {
  btnSaveVoiceSettings.addEventListener('click', () => {
    localStorage.setItem('truco_voice_config', JSON.stringify(myVoiceConfig));
    modalVoiceSettings.classList.add('hide');
    if (lastGameState) {
      socket.emit('update_voice_config', myVoiceConfig);
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

socket.on('admin_validated', () => {
  isClientAdminAuthenticated = true;
  populateAdminCardSelects();
  modalAdminPanel.classList.remove('hide');
});

if (btnCloseAdminPanel) {
  btnCloseAdminPanel.addEventListener('click', () => {
    modalAdminPanel.classList.add('hide');
  });
}

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
    if (window.soundManager) window.soundManager.playVictorySound();
  });
}

// --- GAVETA LATERAL MOBILE ---
const infoSidebar = document.querySelector('.info-sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');

if (sidebarToggleBtn && infoSidebar) {
  sidebarToggleBtn.addEventListener('click', () => {
    infoSidebar.classList.add('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('hide');
  });
}

if (sidebarCloseBtn && infoSidebar) {
  sidebarCloseBtn.addEventListener('click', () => {
    infoSidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.add('hide');
  });
}

if (sidebarOverlay && infoSidebar) {
  sidebarOverlay.addEventListener('click', () => {
    infoSidebar.classList.remove('open');
    sidebarOverlay.classList.add('hide');
  });
}

// --- COMUNICAÇÕES DE SOCKETS ---
socket.on('error_msg', (msg) => {
  alert(msg);
});

socket.on('kicked', () => {
  alert('Você foi removido da sala pelo criador.');
  screenLobby.classList.add('active');
  screenWaiting.classList.remove('active');
  screenGame.classList.remove('active');
  screenGameEnd.classList.remove('active');
});

socket.on('game_state', (gameState) => {
  lastGameState = gameState; 
  myPlayerId = socket.id;
  currentRoomMode = gameState.mode;

  // Sincronizar vozes locais com o servidor
  const me = gameState.players.find(p => p.id === myPlayerId || p.socketId === myPlayerId);
  if (me && JSON.stringify(me.voiceConfig) !== JSON.stringify(myVoiceConfig)) {
    socket.emit('update_voice_config', myVoiceConfig);
  }

  if (gameEndTimeout) {
    clearTimeout(gameEndTimeout);
    gameEndTimeout = null;
  }

  if (gameState.state === 'lobby') {
    document.body.setAttribute('data-screen', 'lobby');
    renderLobbyScreen(gameState);
    if (window.soundManager) window.soundManager.changeMusic('/js/musica.mp3');
  } else if (gameState.state === 'playing' || gameState.state === 'hand_end') {
    document.body.setAttribute('data-screen', 'game');
    renderGameScreen(gameState);
    if (window.soundManager) window.soundManager.changeMusic('/js/musicaJogo.mp3');
  } else if (gameState.state === 'game_end') {
    document.body.setAttribute('data-screen', 'game_end');
    renderGameScreen(gameState);
    gameEndTimeout = setTimeout(() => {
      renderGameEndScreen(gameState);
      gameEndTimeout = null;
    }, 6000);
    if (window.soundManager) window.soundManager.changeMusic(null);
  }
});

socket.on('chat_msg', (data) => {
  const isMe = data.playerId === myPlayerId;
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${isMe ? 'me' : ''}`;
  msgEl.innerHTML = `<span class="sender-name">${data.playerName}:</span> <span class="message-text">${data.message}</span>`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (!isMe && window.soundManager) {
    window.soundManager.playClickSound(); 
  }
});
