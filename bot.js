// bot.js
// Inteligência Artificial do Truco Gaúcho

// Avalia o peso médio das cartas na mão do bot
function evaluateHandStrength(handCards) {
  if (handCards.length === 0) return 0;
  const ranks = handCards.map(c => c.trucoRank);
  return ranks.reduce((sum, r) => sum + r, 0) / handCards.length;
}

// Retorna a melhor carta para jogar
function selectCardToPlay(handCards, playedCards, currentRound, playerIdx, players, maxPlayers) {
  if (handCards.length === 1) return 0; // Só resta uma carta

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
      // Se nosso time ganhou a primeira rodada, joga a mais baixa para 'fazer caranguejo' (guardar a maior para a última)
      // Se nosso time perdeu ou empatou, joga a maior carta
      // Para fins de simplificação, verifica o vencedor da primeira rodada:
      // (vamos assumir que se o bot começa jogando, ele pode olhar o resultado da rodada 0 no playedCards)
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
        // Ganhamos a primeira, joga a mais baixa
        let minIdx = 0;
        for (let i = 1; i < handCards.length; i++) {
          if (handCards[i].trucoRank < handCards[minIdx].trucoRank) minIdx = i;
        }
        return minIdx;
      } else {
        // Perdemos ou empatou, joga a maior
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
  // Identifica a maior carta na mesa até agora
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
  // Encontra a menor carta da mão do bot que ganhe da maior da mesa
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

  // 1. RESPONDER A TRUCO PENDENTE
  if (game.hand.trucoResponsePending && game.hand.trucoPendingTeam === player.team) {
    const strength = evaluateHandStrength(handCards);
    const maxRank = handCards.length > 0 ? Math.max(...handCards.map(c => c.trucoRank)) : 0;
    
    // Probabilidade baseada na força das cartas
    // Ranks altos: 14 (As Espadas), 13 (As Paus), 12 (7 Espadas), 11 (7 Ouros), 10 (3), 9 (2)
    // Se o bot tem cartas muito fortes, ele pode aceitar ou aumentar
    if (maxRank >= 11) {
      // Aceita e tem 30% de chance de retrucar (se já não estiver no limite)
      if (Math.random() < 0.3 && (game.hand.trucoState === 'truco' || game.hand.trucoState === 'retruco')) {
        return { action: 'truco_raise', value: game.hand.trucoState === 'truco' ? 'retruco' : 'vale4' };
      }
      return { action: 'truco_response', value: 'quero' };
    } else if (maxRank >= 9 || strength >= 6) {
      // Cartas médias/boas: aceita
      return { action: 'truco_response', value: 'quero' };
    } else {
      // Cartas fracas: 80% de chance de correr, 20% blefe
      if (Math.random() < 0.20 && game.hand.trucoState === 'truco') {
        return { action: 'truco_response', value: 'quero' }; // Blefe!
      }
      return { action: 'truco_response', value: 'nao_quero' };
    }
  }

  // 2. RESPONDER A ENVIDO PENDENTE
  if (game.hand.envidoResponsePending && game.hand.envidoPendingTeam === player.team) {
    const envidoScore = player.envidoScore;
    const history = game.hand.envidoHistory;
    const currentCall = history[history.length - 1];

    if (currentCall === 'envido') {
      if (envidoScore >= 26) {
        // Se pontos forem muito altos, pode querer aumentar
        if (envidoScore >= 30 && Math.random() < 0.4) {
          return { action: 'envido_raise', value: 'real_envido' };
        }
        return { action: 'envido_response', value: 'quero' };
      }
      return { action: 'envido_response', value: 'nao_quero' };
    } else if (currentCall === 'real_envido') {
      if (envidoScore >= 28) {
        if (envidoScore >= 31 && Math.random() < 0.3) {
          return { action: 'envido_raise', value: 'falta_envido' };
        }
        return { action: 'envido_response', value: 'quero' };
      }
      return { action: 'envido_response', value: 'nao_quero' };
    } else if (currentCall === 'falta_envido') {
      // Aceita se tiver pontos excelentes
      if (envidoScore >= 29) {
        return { action: 'envido_response', value: 'quero' };
      }
      return { action: 'envido_response', value: 'nao_quero' };
    }
  }

  // 3. RESPONDER A FLOR PENDENTE
  if (game.hand.florResponsePending && game.hand.florPendingTeam === player.team) {
    if (player.hasFlor) {
      const florScore = player.florScore;
      const history = game.hand.florHistory;
      const currentCall = history[history.length - 1];

      if (currentCall === 'flor') {
        if (florScore >= 30 && Math.random() < 0.4) {
          return { action: 'flor_raise', value: 'contra_flor_resto' };
        } else if (florScore >= 27) {
          return { action: 'flor_raise', value: 'contra_flor' };
        }
        return { action: 'flor_response', value: 'quero' };
      } else if (currentCall === 'contra_flor') {
        if (florScore >= 30) {
          return { action: 'flor_response', value: 'quero' };
        }
        return { action: 'flor_response', value: 'nao_quero' };
      } else if (currentCall === 'contra_flor_resto') {
        if (florScore >= 32) {
          return { action: 'flor_response', value: 'quero' };
        }
        return { action: 'flor_response', value: 'nao_quero' }; // Achique
      }
    } else {
      // Se de alguma forma caiu aqui e o bot não tem flor, ele diz não quero automaticamente
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
      // Bot canta Envido se tiver pontos muito bons
      if (envidoScore >= 29 && Math.random() < 0.7) {
        return { action: 'call_envido', value: 'real_envido' };
      } else if (envidoScore >= 27 && Math.random() < 0.6) {
        return { action: 'call_envido', value: 'envido' };
      }
    }
  }

  // 5. CHAMAR TRUCO
  // O bot pode gritar Truco se tiver cartas fortes e o Truco estiver disponível
  if (game.hand.trucoState !== 'vale4' && game.hand.trucoCallerTeam !== player.team) {
    const maxRank = Math.max(...handCards.map(c => c.trucoRank));
    const strength = evaluateHandStrength(handCards);
    
    // Condições para pedir truco:
    // Se tem uma carta muito forte (rank >= 11) ou força média alta
    // Chance aleatória para não ser 100% previsível
    let wantTruco = false;
    if (maxRank >= 13 && Math.random() < 0.7) wantTruco = true;
    else if (maxRank >= 10 && Math.random() < 0.4) wantTruco = true;
    else if (strength >= 8 && Math.random() < 0.3) wantTruco = true;
    
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
    game.maxPlayers
  );

  return { action: 'play_card', value: cardIdx };
}

module.exports = {
  handleBotAction
};
