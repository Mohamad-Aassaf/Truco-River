// public/js/ui_game.js
// Interface e Lógica de Gameplay da Mesa de Jogo

// Controle do pop-up de resultado de envido
let envidoResultShown = false;

// Configurar o botão OK do pop-up de envido
const modalEnvidoResult = document.getElementById('modal-envido-result');
const btnEnvidoResultOk = document.getElementById('btn-envido-result-ok');
if (btnEnvidoResultOk) {
  btnEnvidoResultOk.addEventListener('click', () => {
    if (modalEnvidoResult) {
      modalEnvidoResult.classList.add('hide');
    }
  });
}

function showEnvidoResultModal(details) {
  const content = document.getElementById('envido-result-content');
  if (!modalEnvidoResult || !content) return;

  content.innerHTML = `
    <div style="font-weight: 700; color: var(--gold); font-size: 1.3rem; margin-bottom: 10px; font-family: 'Outfit', sans-serif;">
      Time ${details.winnerTeam + 1} venceu a disputa!
      <div style="font-size: 1rem; opacity: 0.8; margin-top: 4px;">+${details.pointsWon} ponto(s) obtido(s)</div>
    </div>
    <div style="background: rgba(0,0,0,0.35); border-radius: 8px; width: 100%; padding: 16px; box-sizing: border-box; text-align: left; font-family: 'Montserrat', sans-serif; display: flex; flex-direction: column; gap: 10px;">
      <div>
        <span style="opacity: 0.85;">${details.firstPlayerName} (cantou/aumentou):</span>
        <strong style="color: #60a5fa; font-size: 1.2rem; float: right;">${details.firstPlayerScore}</strong>
      </div>
      <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
        <span style="opacity: 0.85;">${details.secondPlayerName} (oponente):</span>
        <strong style="color: #f87171; font-size: 1.2rem; float: right;">${details.secondPlayerScore}</strong>
      </div>
    </div>
  `;

  modalEnvidoResult.classList.remove('hide');
}

// Ocultar balões de fala dos jogadores
function hideVoiceBubbles() {
  document.querySelectorAll('.voice-bubble').forEach(bubble => {
    bubble.classList.remove('show');
    bubble.textContent = '';
  });
}

// Limpa todos os slots das cartas jogadas na mesa
function clearPlayedCardSlots() {
  const seats = ['bottom', 'left', 'top', 'right'];
  seats.forEach(seat => {
    const el = document.getElementById(`arena-slot-${seat}`);
    if (el) el.innerHTML = '';
  });
}

// Exibe balões de diálogo com efeitos e temporizador rápido
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
      bubble.textContent = text;
      bubble.classList.add('show');
    }
  });
}

// Desenha as cartas jogadas por rodada no centro da mesa (Estilo Blyts - Pilhas)
function renderPlayedCards(playedCards, players, gameState) {
  clearPlayedCardSlots();

  // Limpar e atualizar os marcadores de rodadas (bolinhas)
  for (let r = 0; r < 3; r++) {
    const dotEl = document.getElementById(`round-dot-${r}`);
    if (dotEl) {
      dotEl.className = 'round-dot';
    }
  }

  if (gameState && gameState.hand && gameState.hand.roundWinners) {
    gameState.hand.roundWinners.forEach((winnerIdx, r) => {
      const dotEl = document.getElementById(`round-dot-${r}`);
      if (winnerIdx === -1) {
        if (dotEl) {
          dotEl.className = 'round-dot tie';
        }
      } else {
        const winnerPlayer = gameState.players[winnerIdx];
        const myTeam = gameState.players[mySeatIndex].team;
        const isUs = winnerPlayer.team === myTeam;
        if (dotEl) {
          dotEl.className = isUs ? 'round-dot win-us' : 'round-dot win-them';
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

    const slot = document.getElementById(`arena-slot-${seat}`);
    if (slot) {
      const card = play.card;
      const round = play.round; // 0, 1 ou 2
      
      // Cria a carta miniatura para a mesa
      const cardEl = document.createElement('div');
      cardEl.className = `played-card ${card.suit}`;
      
      // Calcular deslocamento tridimensional e rotação para efeito de pilha (Cascata para baixo e direita)
      const isMobile = window.innerWidth <= 850;
      const stepX = isMobile ? 10 : 22;
      const stepY = isMobile ? 6 : 14;
      
      let offsetX = round * 10;
      if (currentDeckStyle === 'pixel') {
         // Ajuste diferenciado de deslocamento para pixelado
         offsetX = round * (stepX - 2);
      } else {
         offsetX = round * stepX;
      }
      let offsetY = round * stepY;
      let rotate = (round - 1) * 8; // -8deg, 0deg, 8deg
      
      cardEl.style.position = 'absolute';
      cardEl.style.transform = `translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg)`;
      cardEl.style.zIndex = 10 + round;
      
      cardEl.innerHTML = `<img src="${getCardImgSrc(card)}" class="card-img" alt="${card.value} de ${card.suit}">`;
      slot.appendChild(cardEl);
    }
  });
}

// Renderiza a Narrative/logs do jogo
function renderLogs(logs) {
  gameLogs.innerHTML = '';
  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    if (log.team === 0) {
      div.classList.add('team-0');
    } else if (log.team === 1) {
      div.classList.add('team-1');
    }

    const timeStr = new Date(log.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `<span class="log-time">[${timeStr}]</span> ${log.msg}`;

    gameLogs.appendChild(div);
  });

  // Rolar para o final
  gameLogs.scrollTop = gameLogs.scrollHeight;
}

// Mapeia e atualiza visualmente os assentos de cada jogador
function setupSeatsLayout(players, dealerIndex, currentPlayerIdx, activeHand = null) {
  const seatLeft = document.getElementById('seat-left');
  const seatRight = document.getElementById('seat-right');
  const seatBottom = document.getElementById('seat-bottom');
  const seatTop = document.getElementById('seat-top');

  // Ocultar todos por padrão
  if (seatLeft) seatLeft.classList.add('hidden-seat');
  if (seatRight) seatRight.classList.add('hidden-seat');

  // Remover marcações ativas anteriores
  document.querySelectorAll('.player-seat').forEach(seat => {
    seat.classList.remove('active-seat');
    const roleBadge = seat.querySelector('.seat-role');
    if (roleBadge) {
      roleBadge.classList.remove('ready');
      roleBadge.textContent = '';
    }
    const seatCardsEl = seat.querySelector('.seat-cards');
    if (seatCardsEl) seatCardsEl.innerHTML = '';
  });

  const getSeatElement = (mappedPos) => {
    if (mappedPos === 'bottom') return seatBottom;
    if (mappedPos === 'top') return seatTop;
    if (mappedPos === 'left') return seatLeft;
    if (mappedPos === 'right') return seatRight;
    return null;
  };

  const maxPlayers = players.length;

  const suitClasses = {
    'espadas': 'sword',
    'paus': 'club',
    'copas': 'cup',
    'ouros': 'gold'
  };

  players.forEach((p, idx) => {
    let position = 'bottom';

    if (currentRoomMode === '1v1') {
      position = (idx === mySeatIndex) ? 'bottom' : 'top';
    } else {
      const diff = (idx - mySeatIndex + 4) % 4;
      if (diff === 0) position = 'bottom';
      else if (diff === 1) position = 'left';
      else if (diff === 2) position = 'top';
      else if (diff === 3) position = 'right';
    }

    const seat = getSeatElement(position);
    if (!seat) return;

    seat.classList.remove('hidden-seat');

    // Atualizar info
    const nameEl = seat.querySelector('.seat-name');
    if (nameEl) nameEl.textContent = p.isBot ? `🤖 ${p.name}` : p.name;

    // Distintivo do Carteador (D) ou Mão (M)
    const roleBadge = seat.querySelector('.seat-role');
    if (roleBadge) {
      if (idx === dealerIndex) {
        roleBadge.textContent = 'Doador';
        roleBadge.classList.add('ready');
      } else if (idx === (dealerIndex + 1) % maxPlayers) {
        roleBadge.textContent = 'Mão';
      }
    }

    // Sinalizar de quem é o turno
    if (idx === currentPlayerIdx) {
      seat.classList.add('active-seat');
    }

    // Renderizar mini-cartas do jogador na mesa
    const seatCardsEl = seat.querySelector('.seat-cards');
    if (seatCardsEl && activeHand && activeHand.hands && activeHand.hands[idx]) {
      const playerCards = activeHand.hands[idx];
      let cardsHtml = '';
      playerCards.forEach(card => {
        if (card.hidden) {
          cardsHtml += `<span class="mini-card-badge hidden-card"></span>`;
        } else {
          const cls = suitClasses[card.suit] || '';
          const svgMarkup = SUIT_SVGS[card.suit] || '';
          cardsHtml += `
            <span class="mini-card-badge ${cls}">
              <span>${card.value}</span>
              <div class="mini-card-suit-wrapper">${svgMarkup}</div>
            </span>`;
        }
      });
      seatCardsEl.innerHTML = cardsHtml;
    }
  });
}

// Oculta e reseta todos os botões de ação do painel
function disableAllActionButtons(gameState) {
  // Esconder botões
  btnTruco.classList.add('hide');
  btnRetruco.classList.add('hide');
  btnVale4.classList.add('hide');
  btnEnvido.classList.add('hide');
  btnRealEnvido.classList.add('hide');
  btnFaltaEnvido.classList.add('hide');
  btnFlor.classList.add('hide');
  btnQuero.classList.add('hide');
  btnNaoQuero.classList.add('hide');
  btnContraFlor.classList.add('hide');
  btnContraFlorResto.classList.add('hide');
  btnAchique.classList.add('hide');
  btnFold.classList.add('hide');

  // Esconder grupos
  groupTruco.classList.add('hide');
  groupEnvido.classList.add('hide');
  groupFlor.classList.add('hide');
  groupResponse.classList.add('hide');
  groupFlorResponse.classList.add('hide');

  if (btnEnvidoMobileTrigger) btnEnvidoMobileTrigger.classList.add('hide');
  if (groupEnvidoMobileSub) groupEnvidoMobileSub.classList.add('hide');

  // Habilitar cliques
  btnTruco.disabled = true;
  btnRetruco.disabled = true;
  btnVale4.disabled = true;
  btnEnvido.disabled = true;
  btnRealEnvido.disabled = true;
  btnFaltaEnvido.disabled = true;
  btnFlor.disabled = true;
  btnQuero.disabled = true;
  btnNaoQuero.disabled = true;
  btnContraFlor.disabled = true;
  btnContraFlorResto.disabled = true;
  btnAchique.disabled = true;
  btnFold.disabled = true;
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
  
  // Regra do Pé: no 2v2 apenas os pés (índices 2 e 3) controlam o Envido
  const isPe = (gameState.mode === '1v1') || (mySeatIndex === 2 || mySeatIndex === 3);

  const statusEl = document.getElementById('action-panel-status');

  // --- SE HOUVER APOSTA PENDENTE PARA O MEU TIME RESPONDER ---

  if (hand.trucoResponsePending && hand.trucoPendingTeam === myTeam) {
    if (statusEl) statusEl.classList.add('hide');
    groupResponse.classList.remove('hide');
    showAndEnableButton(btnQuero);
    showAndEnableButton(btnNaoQuero);

    // Opções de Aumentar Truco
    if (hand.trucoState === 'truco') {
      groupTruco.classList.remove('hide');
      showAndEnableButton(btnRetruco);
    } else if (hand.trucoState === 'retruco') {
      groupTruco.classList.remove('hide');
      showAndEnableButton(btnVale4);
    }

    // Os adversários do Truco podem chamar Envido/Flor antes de aceitar o Truco
    // Só na primeira rodada e se o jogador não jogou ainda
    const myCards = hand.hands[mySeatIndex] || [];
    const hasNotPlayedYet = myCards.length === 3;
    if (hand.currentRound === 0 && hasNotPlayedYet && hand.canCallEnvido && isPe) {
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

  if (hand.envidoResponsePending && hand.envidoPendingTeam === myTeam && isPe) {
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
        showAndEnableButton(btnFaltaEnvido);
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

    if (hand.currentRound === 0 && hasNotPlayedYet && hand.canCallEnvido && isPe) {
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

  // --- ADAPTAÇÃO DO ENVIDO/FLOR PARA CELULAR ---
  const isMobile = window.innerWidth <= 850;
  if (isMobile) {
    // 1. Oculta os botões normais do desktop
    groupEnvido.classList.add('hide');
    groupFlor.classList.add('hide');

    const hasEnvidoOption = !btnEnvido.classList.contains('hide') || 
                          !btnRealEnvido.classList.contains('hide') || 
                          !btnFaltaEnvido.classList.contains('hide');

    const hasFlorOption = !btnFlor.classList.contains('hide');

    if (hasEnvidoOption || hasFlorOption) {
      if (btnEnvidoMobileTrigger) {
        btnEnvidoMobileTrigger.classList.remove('hide');
        btnEnvidoMobileTrigger.disabled = false;
      }
    }

    // Atualiza opções internas do submenu de celular
    const updateSubMenuButton = (desktopBtn, mobileSubBtn) => {
      if (desktopBtn && mobileSubBtn) {
        if (!desktopBtn.classList.contains('hide')) {
          mobileSubBtn.classList.remove('hide');
          mobileSubBtn.disabled = false;
        } else {
          mobileSubBtn.classList.add('hide');
          mobileSubBtn.disabled = true;
        }
      }
    };

    updateSubMenuButton(btnEnvido, btnEnvidoSubEnvido);
    updateSubMenuButton(btnRealEnvido, btnRealEnvidoSubReal);
    updateSubMenuButton(btnFaltaEnvido, btnFaltaEnvidoSubFalta);
    updateSubMenuButton(btnFlor, btnEnvidoSubFlor);
  } else {
    if (btnEnvidoMobileTrigger) btnEnvidoMobileTrigger.classList.add('hide');
    if (groupEnvidoMobileSub) groupEnvidoMobileSub.classList.add('hide');
  }

  // --- EXIBIR TEXTO DE STATUS CASO NADA ESTEJA DISPONÍVEL ---
  const allButtons = [
    btnTruco, btnRetruco, btnVale4, 
    btnEnvido, btnRealEnvido, btnFaltaEnvido, btnFlor,
    btnQuero, btnNaoQuero, btnContraFlor, btnContraFlorResto, btnAchique,
    btnFold, btnEnvidoMobileTrigger
  ];
  const anyVisible = allButtons.some(btn => btn && !btn.classList.contains('hide'));

  if (!anyVisible) {
    if (statusEl) {
      statusEl.classList.remove('hide');
      if (hand.currentPlayer === mySeatIndex) {
        statusEl.textContent = 'Sua vez de jogar uma carta!';
      } else {
        const nextPlayer = gameState.players[hand.currentPlayer];
        statusEl.textContent = `Aguardando ${nextPlayer ? nextPlayer.name : 'oponente'}...`;
      }
    }
  } else {
    if (statusEl) statusEl.classList.add('hide');
  }
}

// Renderiza a mão do jogador local (3 cartas no bottom)
function renderMyHand(cards, isMyTurn) {
  const playerHand = document.getElementById('player-hand');
  if (!playerHand) return;
  playerHand.innerHTML = '';

  if (!cards || cards.length === 0) return;

  cards.forEach((card, idx) => {
    const cardEl = document.createElement('div');
    cardEl.className = `card ${card.suit}`;
    cardEl.dataset.idx = idx;

    cardEl.innerHTML = `<img src="${getCardImgSrc(card)}" class="card-img" alt="${card.value} de ${card.suit}">`;

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

// Renderiza toda a interface da mesa de jogo ativa
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

  const scoreLimitBadge = document.getElementById('score-limit-badge');
  if (scoreLimitBadge) scoreLimitBadge.textContent = `${gameState.maxPoints} PONTOS`;
  const mobileScoreLimit = document.getElementById('mobile-score-limit');
  if (mobileScoreLimit) mobileScoreLimit.textContent = `(${gameState.maxPoints} pts)`;

  // 3. Atualizar palitos/pontos do Truco Gaúcho
  updateSticksDisplay(gameState.score[0], sticksTeam0);
  updateSticksDisplay(gameState.score[1], sticksTeam1);

  // 4. Renderizar logs (Narrativa)
  renderLogs(gameState.logs);

  const hand = gameState.hand;
  if (!hand) {
    clearPlayedCardSlots();
    hideVoiceBubbles();
    // Limpar cartas da minha mão
    playerHand.innerHTML = '';
    return;
  }

  // 5. Configurar distintivo de fase do jogo
  let phaseText = 'TRUCO';
  if (hand.trucoState === 'truco') phaseText = 'RETRUCO';
  else if (hand.trucoState === 'retruco') phaseText = 'VALE 4';
  else if (hand.trucoState === 'vale4') phaseText = 'FIM DE APOSTAS';

  if (hand.envidoResponsePending) phaseText = 'DISPUTA DE ENVIDO';
  else if (hand.florResponsePending) phaseText = 'DISPUTA DE FLOR';

  phaseBadge.textContent = phaseText;

  // 6. Atualizar layout de assentos dos jogadores na mesa
  setupSeatsLayout(gameState.players, gameState.dealerIndex, hand.currentPlayer, hand);

  // 7. Renderizar cartas jogadas na mesa (Blyts stacks)
  renderPlayedCards(hand.playedCards, gameState.players, gameState);

  // 8. Renderizar balões de fala dos personagens
  renderVoiceBubbles(hand.voiceBubble, gameState.players);

  // 9. Atualizar painel de controle do jogador local
  const myCards = hand.hands[mySeatIndex] || [];
  const isMyTurn = hand.currentPlayer === mySeatIndex;

  renderMyHand(myCards, isMyTurn && !hand.trucoResponsePending && !hand.envidoResponsePending && !hand.florResponsePending);
  setupActionButtons(gameState);

  // 10. Pop-up de Resultado do Envido (Duelo)
  if (hand.envidoResolutionDetails) {
    if (!envidoResultShown) {
      envidoResultShown = true;
      showEnvidoResultModal(hand.envidoResolutionDetails);
    }
  } else {
    envidoResultShown = false;
  }
}

// Renderiza a tela de fim de jogo com podio
function renderGameEndScreen(gameState) {
  screenLobby.classList.remove('active');
  screenWaiting.classList.remove('active');
  screenGame.classList.remove('active');
  screenGameEnd.classList.add('active');

  const myTeam = gameState.players[mySeatIndex] ? gameState.players[mySeatIndex].team : -1;
  const isWin = gameState.winner === myTeam;

  const trophy = document.querySelector('.trophy-wrapper');
  const resultTitle = document.getElementById('game-result-title');
  const resultMsg = document.getElementById('game-result-message');

  if (isWin) {
    if (trophy) trophy.style.display = 'block';
    resultTitle.innerHTML = '¡VITÓRIA CONQUISTADA!';
    resultTitle.style.color = '#f1c40f';
    resultMsg.textContent = 'Parabéns, patrão! Vocês foram os melhores da mesa!';
  } else {
    if (trophy) trophy.style.display = 'none';
    resultTitle.innerHTML = 'Derrota...';
    resultTitle.style.color = '#c0392b';
    resultMsg.textContent = 'Não foi dessa vez! Ajeite as esporas para a próxima partida.';
  }

  // Placar final
  document.getElementById('final-score-us').textContent = gameState.score[0];
  document.getElementById('final-score-them').textContent = gameState.score[1];

  // Configurar clique para voltar ao lobby
  const restartBtn = document.getElementById('restart-game-btn');
  if (restartBtn) {
    // Substitui listeners anteriores
    const newBtn = restartBtn.cloneNode(true);
    restartBtn.parentNode.replaceChild(newBtn, restartBtn);
    newBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }
}

// Desenha os palitos de truco (estilo gaúcho tradicional)
function updateSticksDisplay(score, container) {
  if (!container) return;
  container.innerHTML = '';

  const groupsOfFive = Math.floor(score / 5);
  const remainder = score % 5;

  for (let g = 0; g < groupsOfFive; g++) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'sticks-group';
    groupDiv.innerHTML = `
      <div class="stick horizontal top"></div>
      <div class="stick vertical left"></div>
      <div class="stick horizontal bottom"></div>
      <div class="stick vertical right"></div>
      <div class="stick diagonal"></div>
    `;
    container.appendChild(groupDiv);
  }

  if (remainder > 0) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'sticks-group';
    let sticksHtml = '';
    if (remainder >= 1) sticksHtml += '<div class="stick horizontal top"></div>';
    if (remainder >= 2) sticksHtml += '<div class="stick vertical left"></div>';
    if (remainder >= 3) sticksHtml += '<div class="stick horizontal bottom"></div>';
    if (remainder >= 4) sticksHtml += '<div class="stick vertical right"></div>';
    groupDiv.innerHTML = sticksHtml;
    container.appendChild(groupDiv);
  }
}

// Binds de cliques para botões de jogo no PC
btnTruco.addEventListener('click', () => socket.emit('game_action', { action: 'call_truco' }));
btnRetruco.addEventListener('click', () => socket.emit('game_action', { action: 'call_truco' }));
btnVale4.addEventListener('click', () => socket.emit('game_action', { action: 'call_truco' }));

btnEnvido.addEventListener('click', () => socket.emit('game_action', { action: 'call_envido', value: 'envido' }));
btnRealEnvido.addEventListener('click', () => socket.emit('game_action', { action: 'call_envido', value: 'real_envido' }));
btnFaltaEnvido.addEventListener('click', () => socket.emit('game_action', { action: 'call_envido', value: 'falta_envido' }));

btnFlor.addEventListener('click', () => socket.emit('game_action', { action: 'call_flor' }));

btnQuero.addEventListener('click', () => socket.emit('game_action', { action: 'respond_challenge', value: 'quero' }));
btnNaoQuero.addEventListener('click', () => socket.emit('game_action', { action: 'respond_challenge', value: 'nao_quero' }));

btnContraFlor.addEventListener('click', () => socket.emit('game_action', { action: 'respond_flor', value: 'contra_flor' }));
btnContraFlorResto.addEventListener('click', () => socket.emit('game_action', { action: 'respond_flor', value: 'contra_flor_resto' }));
btnAchique.addEventListener('click', () => socket.emit('game_action', { action: 'respond_flor', value: 'achique' }));

btnFold.addEventListener('click', () => socket.emit('game_action', { action: 'fold' }));

// Submenu de celular click binds
if (btnEnvidoMobileTrigger) {
  btnEnvidoMobileTrigger.addEventListener('click', () => {
    btnEnvidoMobileTrigger.classList.add('hide');
    if (groupEnvidoMobileSub) groupEnvidoMobileSub.classList.remove('hide');
  });
}
if (btnEnvidoSubBack) {
  btnEnvidoSubBack.addEventListener('click', () => {
    if (groupEnvidoMobileSub) groupEnvidoMobileSub.classList.add('hide');
    btnEnvidoMobileTrigger.classList.remove('hide');
  });
}
if (btnEnvidoSubEnvido) {
  btnEnvidoSubEnvido.addEventListener('click', () => {
    btnEnvido.click();
    btnEnvidoSubBack.click();
  });
}
if (btnRealEnvidoSubReal) {
  btnRealEnvidoSubReal.addEventListener('click', () => {
    btnRealEnvido.click();
    btnEnvidoSubBack.click();
  });
}
if (btnFaltaEnvidoSubFalta) {
  btnFaltaEnvidoSubFalta.addEventListener('click', () => {
    btnFaltaEnvido.click();
    btnEnvidoSubBack.click();
  });
}
if (btnEnvidoSubFlor) {
  btnEnvidoSubFlor.addEventListener('click', () => {
    btnFlor.click();
    btnEnvidoSubBack.click();
  });
}

// Binds do Chat e resize vertical de contêineres
if (chatForm) {
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
      socket.emit('send_chat', msg);
      chatInput.value = '';
    }
  });
}

if (gameLeaveBtn) {
  gameLeaveBtn.addEventListener('click', () => {
    if (confirm('Tem certeza que deseja abandonar este jogo e voltar ao menu principal?')) {
      window.location.reload();
    }
  });
}

// Configuração do resize dos contêineres de chat e logs
const btnIncreaseLogs = document.getElementById('btn-increase-logs');
const btnDecreaseLogs = document.getElementById('btn-decrease-logs');
const btnIncreaseChat = document.getElementById('btn-increase-chat');
const btnDecreaseChat = document.getElementById('btn-decrease-chat');
const logsContainer = document.querySelector('.logs-container');
const chatContainer = document.querySelector('.chat-container');

if (btnIncreaseLogs && btnDecreaseLogs && logsContainer) {
  btnIncreaseLogs.addEventListener('click', () => {
    const currentHeight = logsContainer.offsetHeight;
    logsContainer.style.height = (currentHeight + 40) + 'px';
  });
  btnDecreaseLogs.addEventListener('click', () => {
    const currentHeight = logsContainer.offsetHeight;
    if (currentHeight > 80) {
      logsContainer.style.height = (currentHeight - 40) + 'px';
    }
  });
}

if (btnIncreaseChat && btnDecreaseChat && chatContainer) {
  btnIncreaseChat.addEventListener('click', () => {
    const currentHeight = chatContainer.offsetHeight;
    chatContainer.style.height = (currentHeight + 40) + 'px';
  });
  btnDecreaseChat.addEventListener('click', () => {
    const currentHeight = chatContainer.offsetHeight;
    if (currentHeight > 120) {
      chatContainer.style.height = (currentHeight - 40) + 'px';
    }
  });
}
