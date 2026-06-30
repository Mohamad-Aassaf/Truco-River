// bot.js
// Inteligência Artificial do Truco Gaúcho com Dificuldade (Fácil, Médio, Difícil)

// Avalia o peso médio das cartas na mão do bot
function evaluateHandStrength(handCards) {
  if (handCards.length === 0) return 0;
  const ranks = handCards.map(c => c.trucoRank);
  return ranks.reduce((sum, r) => sum + r, 0) / handCards.length;
}

// Retorna a melhor carta para jogar
function selectCardToPlay(handCards, playedCards, currentRound, playerIdx, players, maxPlayers, difficulty = 'medium') {
  if (handCards.length === 1) return 0; // Só resta uma carta

  // Bot fácil tem 30% de chance de jogar uma carta totalmente aleatória
  if (difficulty === 'easy' && Math.random() < 0.3) {
    return Math.floor(Math.random() * handCards.length);
  }

  const myTeam = players[playerIdx].team;
  
  // Filtrar jogadas da rodada atual
  const roundPlays = playedCards.filter(p => p.round === currentRound);

  // Se ninguém jogou ainda nesta rodada
  if (roundPlays.length === 0) {
    if (currentRound === 0) {
      // Primeira rodada: joga a carta intermediária (média) para testar o terreno
      // Ordena por rank e pega a do meio
      const sorted = [...handCards].map((c, i) => ({ c, i })).sort((a, b) => a.c.trucoRank - b.c.trucoRank);
      return sorted[Math.floor(sorted.length / 2)].i;
    } else if (currentRound === 1) {
      // Segunda rodada:
      const r0Plays = playedCards.filter(p => p.round === 0);
      let r0WinnerTeam = -1;
      if (r0Plays.length > 0) {
        let maxPlay = r0Plays[0];
        let tie = false;
        for (let i = 1; i < r0Plays.length; i++) {
          if (r0Plays[i].card.trucoRank > maxPlay.card.trucoRank) {
            maxPlay = r0Plays[i];
            tie = false;
          } else if (r0Plays[i].card.trucoRank === maxPlay.card.trucoRank) {
            tie = true;
          }
        }
        r0WinnerTeam = tie ? -1 : players[maxPlay.playerIdx].team;
      }

      if (r0WinnerTeam === myTeam) {
        // Ganhamos a primeira, joga a mais baixa (estratégia de reter a maior)
        let minIdx = 0;
        for (let i = 1; i < handCards.length; i++) {
          if (handCards[i].trucoRank < handCards[minIdx].trucoRank) minIdx = i;
        }
        return minIdx;
      } else {
        // Perdemos ou empatou, joga a maior para tentar salvar
        let maxIdx = 0;
        for (let i = 1; i < handCards.length; i++) {
          if (handCards[i].trucoRank > handCards[maxIdx].trucoRank) maxIdx = i;
        }
        return maxIdx;
      }
    } else {
      // Rodada 3: joga a maior
      let maxIdx = 0;
      for (let i = 1; i < handCards.length; i++) {
        if (handCards[i].trucoRank > handCards[maxIdx].trucoRank) maxIdx = i;
      }
      return maxIdx;
    }
  }

  // Se já há cartas jogadas na rodada
  let bestPlay = roundPlays[0];
  let isTie = false;
  for (let i = 1; i < roundPlays.length; i++) {
    if (roundPlays[i].card.trucoRank > bestPlay.card.trucoRank) {
      bestPlay = roundPlays[i];
      isTie = false;
    } else if (roundPlays[i].card.trucoRank === bestPlay.card.trucoRank) {
      if (players[roundPlays[i].playerIdx].team !== players[bestPlay.playerIdx].team) {
        isTie = true;
      }
    }
  }

  const bestTeam = isTie ? -1 : players[bestPlay.playerIdx].team;

  // Se o parceiro está ganhando a vaza (no modo 2v2)
  if (maxPlayers === 4 && bestTeam === myTeam && bestPlay.playerIdx !== playerIdx) {
    // Parceiro já está ganhando. Descarta a carta mais baixa
    let minIdx = 0;
    for (let i = 1; i < handCards.length; i++) {
      if (handCards[i].trucoRank < handCards[minIdx].trucoRank) minIdx = i;
    }
    return minIdx;
  }

  // Senão, o adversário está ganhando ou está empatado. O bot precisa bater a carta dele se puder.
  let chosenIdx = -1;
  let minWinningRank = 99;

  for (let i = 0; i < handCards.length; i++) {
    const card = handCards[i];
    if (card.trucoRank > bestPlay.card.trucoRank) {
      if (card.trucoRank < minWinningRank) {
        minWinningRank = card.trucoRank;
        chosenIdx = i;
      }
    }
  }

  // Se tem uma carta que ganha, joga ela
  if (chosenIdx !== -1) {
    return chosenIdx;
  }

  // Se não tem nenhuma carta que ganhe da maior da mesa, descarta a mais baixa
  let minIdx = 0;
  for (let i = 1; i < handCards.length; i++) {
    if (handCards[i].trucoRank < handCards[minIdx].trucoRank) minIdx = i;
  }
  return minIdx;
}

// Toma decisões do Bot e executa no jogo
function handleBotAction(game, playerIdx) {
  if (!game.hand || game.state !== 'playing') return null;

  const player = game.players[playerIdx];
  const handCards = game.hand.hands[playerIdx];
  const difficulty = player.difficulty || 'medium';

  // 1. RESPONDER A TRUCO PENDENTE
  if (game.hand.trucoResponsePending && game.hand.trucoPendingTeam === player.team) {
    const strength = evaluateHandStrength(handCards);
    const maxRank = handCards.length > 0 ? Math.max(...handCards.map(c => c.trucoRank)) : 0;

    if (difficulty === 'easy') {
      // Bot Fácil: age muito aleatoriamente
      const rand = Math.random();
      if (rand < 0.4) {
        return { action: 'truco_response', value: 'quero' };
      } else if (rand < 0.7) {
        return { action: 'truco_response', value: 'nao_quero' };
      } else {
        // Tenta aumentar sem critério
        const nextAction = game.hand.trucoState === 'truco' ? 'retruco' : 'vale4';
        return { action: 'truco_raise', value: nextAction };
      }
    }

    if (difficulty === 'hard') {
      // Bot Difícil: joga muito calculado
      if (maxRank >= 11 || strength >= 7) {
        // Aceita e tem 50% de chance de aumentar se a mão for extremamente forte
        if (Math.random() < 0.5 && (game.hand.trucoState === 'truco' || game.hand.trucoState === 'retruco') && maxRank >= 12) {
          return { action: 'truco_raise', value: game.hand.trucoState === 'truco' ? 'retruco' : 'vale4' };
        }
        return { action: 'truco_response', value: 'quero' };
      }
      // Se não tem cartas boas, foge 95% das vezes (sem blefar no aceito)
      if (Math.random() < 0.05 && game.hand.trucoState === 'truco') {
        return { action: 'truco_response', value: 'quero' }; // Blefe raríssimo
      }
      return { action: 'truco_response', value: 'nao_quero' };
    }

    // Bot Médio (Padrão original)
    if (maxRank >= 11) {
      if (Math.random() < 0.3 && (game.hand.trucoState === 'truco' || game.hand.trucoState === 'retruco')) {
        return { action: 'truco_raise', value: game.hand.trucoState === 'truco' ? 'retruco' : 'vale4' };
      }
      return { action: 'truco_response', value: 'quero' };
    } else if (maxRank >= 9 || strength >= 6) {
      return { action: 'truco_response', value: 'quero' };
    } else {
      if (Math.random() < 0.20 && game.hand.trucoState === 'truco') {
        return { action: 'truco_response', value: 'quero' }; // Blefe
      }
      return { action: 'truco_response', value: 'nao_quero' };
    }
  }

  // 2. RESPONDER A ENVIDO PENDENTE
  if (game.hand.envidoResponsePending && game.hand.envidoPendingTeam === player.team) {
    const envidoScore = player.envidoScore;
    const history = game.hand.envidoHistory;
    const currentCall = history[history.length - 1];

    if (difficulty === 'easy') {
      // Fácil: 50% de chance de aceitar ou recusar sem olhar pontuação
      return { action: 'envido_response', value: Math.random() < 0.5 ? 'quero' : 'nao_quero' };
    }

    if (difficulty === 'hard') {
      // Difícil: aceita apenas com pontuação ideal
      if (currentCall === 'envido') {
        if (envidoScore >= 27) {
          if (envidoScore >= 31 && Math.random() < 0.5) return { action: 'envido_raise', value: 'real_envido' };
          return { action: 'envido_response', value: 'quero' };
        }
        return { action: 'envido_response', value: 'nao_quero' };
      } else if (currentCall === 'real_envido') {
        if (envidoScore >= 29) {
          if (envidoScore >= 32 && Math.random() < 0.4) return { action: 'envido_raise', value: 'falta_envido' };
          return { action: 'envido_response', value: 'quero' };
        }
        return { action: 'envido_response', value: 'nao_quero' };
      } else if (currentCall === 'falta_envido') {
        return { action: 'envido_response', value: envidoScore >= 30 ? 'quero' : 'nao_quero' };
      }
    }

    // Médio
    if (currentCall === 'envido') {
      if (envidoScore >= 26) {
        if (envidoScore >= 30 && Math.random() < 0.4) return { action: 'envido_raise', value: 'real_envido' };
        return { action: 'envido_response', value: 'quero' };
      }
      return { action: 'envido_response', value: 'nao_quero' };
    } else if (currentCall === 'real_envido') {
      if (envidoScore >= 28) {
        if (envidoScore >= 31 && Math.random() < 0.3) return { action: 'envido_raise', value: 'falta_envido' };
        return { action: 'envido_response', value: 'quero' };
      }
      return { action: 'envido_response', value: 'nao_quero' };
    } else if (currentCall === 'falta_envido') {
      return { action: 'envido_response', value: envidoScore >= 29 ? 'quero' : 'nao_quero' };
    }
  }

  // 3. RESPONDER A FLOR PENDENTE
  if (game.hand.florResponsePending && game.hand.florPendingTeam === player.team) {
    if (player.hasFlor) {
      const florScore = player.florScore;
      const history = game.hand.florHistory;
      const currentCall = history[history.length - 1];

      if (difficulty === 'easy') {
        return { action: 'flor_response', value: Math.random() < 0.7 ? 'quero' : 'nao_quero' };
      }

      if (currentCall === 'flor') {
        if (florScore >= 30 && Math.random() < 0.4) {
          return { action: 'flor_raise', value: 'contra_flor_resto' };
        } else if (florScore >= 27) {
          return { action: 'flor_raise', value: 'contra_flor' };
        }
        return { action: 'flor_response', value: 'quero' };
      } else if (currentCall === 'contra_flor') {
        return { action: 'flor_response', value: florScore >= (difficulty === 'hard' ? 29 : 28) ? 'quero' : 'nao_quero' };
      } else if (currentCall === 'contra_flor_resto') {
        return { action: 'flor_response', value: florScore >= (difficulty === 'hard' ? 31 : 30) ? 'quero' : 'nao_quero' };
      }
    } else {
      return { action: 'flor_response', value: 'nao_quero' };
    }
  }

  // SE NÃO FOR SUA VEZ DE JOGAR CARTA OU APOSTAR
  if (game.hand.currentPlayer !== playerIdx) return null;

  // 4. CHAMAR FLOR OU ENVIDO (No primeiro round, antes de jogar cartas)
  if (game.hand.currentRound === 0 && !game.hasPlayerPlayedCard(playerIdx) && game.hand.canCallEnvido) {
    if (player.hasFlor && game.hand.florState === 'none') {
      return { action: 'call_flor' };
    } else if (!player.hasFlor && game.hand.envidoState === 'none') {
      const envidoScore = player.envidoScore;
      
      if (difficulty === 'easy') {
        // Fácil canta envido aleatório com 25% de chance
        if (Math.random() < 0.25) {
          return { action: 'call_envido', value: Math.random() < 0.5 ? 'envido' : 'real_envido' };
        }
      } else if (difficulty === 'hard') {
        // Difícil só canta com pontuações altíssimas
        if (envidoScore >= 30 && Math.random() < 0.8) {
          return { action: 'call_envido', value: 'real_envido' };
        } else if (envidoScore >= 28 && Math.random() < 0.7) {
          return { action: 'call_envido', value: 'envido' };
        }
      } else {
        // Médio
        if (envidoScore >= 29 && Math.random() < 0.7) {
          return { action: 'call_envido', value: 'real_envido' };
        } else if (envidoScore >= 27 && Math.random() < 0.6) {
          return { action: 'call_envido', value: 'envido' };
        }
      }
    }
  }

  // 5. CHAMAR TRUCO
  if (game.hand.trucoState !== 'vale4' && game.hand.trucoCallerTeam !== player.team) {
    const maxRank = Math.max(...handCards.map(c => c.trucoRank));
    const strength = evaluateHandStrength(handCards);
    let wantTruco = false;

    if (difficulty === 'easy') {
      // Fácil pede truco aleatório 15% das vezes
      if (Math.random() < 0.15) wantTruco = true;
    } else if (difficulty === 'hard') {
      // Difícil é super agressivo com manilhas reais e super conservador sem elas
      if (maxRank >= 13 && Math.random() < 0.95) wantTruco = true;
      else if (maxRank >= 11 && Math.random() < 0.5) wantTruco = true;
      else if (strength >= 8.5 && Math.random() < 0.4) wantTruco = true;
    } else {
      // Médio
      if (maxRank >= 13 && Math.random() < 0.7) wantTruco = true;
      else if (maxRank >= 10 && Math.random() < 0.4) wantTruco = true;
      else if (strength >= 8 && Math.random() < 0.3) wantTruco = true;
    }

    if (wantTruco) {
      return { action: 'call_truco' };
    }
  }

  // 6. JOGAR CARTA
  const cardIdx = selectCardToPlay(
    handCards,
    game.hand.playedCards,
    game.hand.currentRound,
    playerIdx,
    game.players,
    game.maxPlayers,
    difficulty
  );

  return { action: 'play_card', value: cardIdx };
}

module.exports = {
  handleBotAction
};
