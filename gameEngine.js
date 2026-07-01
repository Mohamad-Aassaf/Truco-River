// gameEngine.js
// Motor do Jogo de Truco Gaúcho (Truco Cego)

const SUITS = ['espadas', 'paus', 'copas', 'ouros'];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12]; // Sem 8 e 9

// Hierarquia do Truco Gaúcho (Cego) - Do menor para o maior (1 a 14)
function getTrucoRank(value, suit) {
  if (value === 1 && suit === 'espadas') return 14; // Espadilha
  if (value === 1 && suit === 'paus') return 13;    // Bastião
  if (value === 7 && suit === 'espadas') return 12; // Siete de espada
  if (value === 7 && suit === 'ouros') return 11;   // Siete de oro
  if (value === 3) return 10;
  if (value === 2) return 9;
  if (value === 1 && (suit === 'copas' || suit === 'ouros')) return 8; // Anchos falsos
  if (value === 12) return 7;
  if (value === 11) return 6;
  if (value === 10) return 5;
  if (value === 7 && (suit === 'paus' || suit === 'copas')) return 4;
  if (value === 6) return 3;
  if (value === 5) return 2;
  if (value === 4) return 1;
  return 0;
}

// Valor para pontos do Envido/Flor: 1 a 7 valem o próprio valor, 10/11/12 valem 0.
function getEnvidoPoints(value) {
  return value <= 7 ? value : 0;
}

// Cria um baralho espanhol completo (40 cartas)
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({
        value,
        suit,
        trucoRank: getTrucoRank(value, suit),
        envidoPoints: getEnvidoPoints(value)
      });
    }
  }
  return deck;
}

// Embaralha as cartas
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Calcula os pontos de Envido de uma mão (3 cartas)
function calculateEnvidoScore(cards) {
  // Se houver Flor (3 cartas do mesmo naipe), não se calcula Envido aqui
  if (cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit) {
    return 0; // É Flor
  }

  // Verificar se há duas cartas do mesmo naipe
  let maxScore = 0;
  
  // Combinações possíveis de pares
  const pairs = [
    [cards[0], cards[1]],
    [cards[1], cards[2]],
    [cards[0], cards[2]]
  ];

  let hasPair = false;
  for (const [c1, c2] of pairs) {
    if (c1.suit === c2.suit) {
      hasPair = true;
      const score = 20 + c1.envidoPoints + c2.envidoPoints;
      if (score > maxScore) maxScore = score;
    }
  }

  // Se todas as 3 cartas são de naipes diferentes, vale a de maior valor individual
  if (!hasPair) {
    maxScore = Math.max(cards[0].envidoPoints, cards[1].envidoPoints, cards[2].envidoPoints);
  }

  return maxScore;
}

// Calcula os pontos de Flor de uma mão (3 cartas)
function calculateFlorScore(cards) {
  if (cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit) {
    return 20 + cards[0].envidoPoints + cards[1].envidoPoints + cards[2].envidoPoints;
  }
  return 0; // Não tem Flor
}

class TrucoGame {
  constructor(id, mode, maxPoints = 24) {
    this.id = id;
    this.mode = mode; // '1v1' ou '2v2'
    this.maxPlayers = mode === '1v1' ? 2 : 4;
    this.players = []; // [{ id, name, socketId, isBot, team }]
    this.score = { 0: 0, 1: 0 }; // Pontuação por equipe
    this.state = 'lobby'; // 'lobby', 'playing', 'game_end'
    this.gameLogs = [];
    this.maxPoints = maxPoints;
    
    // Estado da rodada/mão atual
    this.dealerIndex = 0;
    this.hand = null;
  }

  log(message, team = null) {
    this.gameLogs.push({ time: Date.now(), msg: message, team });
    if (this.gameLogs.length > 50) this.gameLogs.shift();
  }

  addPlayer(id, name, socketId, isBot = false, difficulty = 'medium') {
    if (this.players.length >= this.maxPlayers) return false;
    
    // Determinar time:
    // No 1v1: Jogador 0 é Time 0, Jogador 1 é Time 1
    // No 2v2: Alternado: 0 e 2 são Time 0, 1 e 3 são Time 1
    const team = this.players.length % 2;

    this.players.push({
      id,
      name,
      socketId,
      isBot,
      difficulty,
      team,
      ready: isBot // Bots estão sempre prontos
    });
    
    this.log(`${name} entrou na partida.`);
    return true;
  }

  removePlayer(socketId) {
    const idx = this.players.findIndex(p => p.socketId === socketId);
    if (idx === -1) return null;
    
    const p = this.players[idx];
    
    if (this.state === 'playing') {
      const team = p.team;
      const opponentTeam = team === 0 ? 1 : 0;
      
      if (this.mode === '1v1') {
        const opponentIdx = idx === 0 ? 1 : 0;
        this.winner = opponentTeam;
        this.state = 'game_end';
        const oppName = this.players[opponentIdx] ? this.players[opponentIdx].name : 'Oponente';
        this.log(`${p.name} abandonou a partida. ${oppName} venceu por desistência!`);
        this.players.splice(idx, 1);
      } else {
        // 2v2:
        const partnerIdx = (idx + 2) % 4;
        const partner = this.players[partnerIdx];
        
        if (!partner || partner.isBot || !partner.socketId) {
          this.winner = opponentTeam;
          this.state = 'game_end';
          this.log(`Todos os jogadores do Time ${team + 1} saíram. Time ${opponentTeam + 1} venceu por desistência!`);
          this.players.splice(idx, 1);
        } else {
          // Substituir por Bot Médio
          p.isBot = true;
          p.name = `Bot ${p.name}`;
          p.socketId = null;
          p.difficulty = 'medium';
          p.ready = true;
          this.log(`${p.name.replace('Bot ', '')} saiu. Um Bot Médio assumiu seu lugar na dupla.`);
        }
      }
    } else {
      this.players.splice(idx, 1);
      this.log(`${p.name} saiu do jogo.`);
      this.state = 'lobby';
    }
    return p;
  }

  startNewHand() {
    // Reordenar jogadores com base nos times escolhidos no lobby para coincidir com a perspectiva do motor
    if (this.mode === '2v2') {
      const team0 = this.players.filter(p => p.team === 0);
      const team1 = this.players.filter(p => p.team === 1);
      const sorted = [];
      for (let i = 0; i < 2; i++) {
        if (team0[i]) sorted.push(team0[i]);
        if (team1[i]) sorted.push(team1[i]);
      }
      // Sobrescrever se tivermos 4 jogadores válidos
      if (sorted.length === 4) {
        this.players = sorted;
      }
    } else if (this.mode === '1v1') {
      const team0 = this.players.find(p => p.team === 0);
      const team1 = this.players.find(p => p.team === 1);
      const sorted = [];
      if (team0) sorted.push(team0);
      if (team1) sorted.push(team1);
      this.players.forEach(p => {
        if (!sorted.includes(p)) sorted.push(p);
      });
      if (sorted.length === 2) {
        this.players = sorted;
      }
    }

    this.state = 'playing';
    const deck = shuffle(createDeck());
    
    // Distribuir 3 cartas para cada jogador
    const hands = {};
    for (let i = 0; i < this.players.length; i++) {
      hands[i] = [deck.pop(), deck.pop(), deck.pop()];
    }

    const mãoPlayer = (this.dealerIndex + 1) % this.maxPlayers;

    this.hand = {
      hands, // { playerIdx: [cards] }
      originalHands: JSON.parse(JSON.stringify(hands)), // Cópia para mostrar no final
      playedCards: [], // [{ playerIdx, card, round }]
      roundsWon: [], // [teamIndex] ou -1 para empate
      roundWinners: [], // [playerIndex] ou -1 para empate
      currentRound: 0,
      mão: mãoPlayer,
      currentPlayer: mãoPlayer,
      
      // Pontos do Truco
      trucoState: 'none', // 'none', 'truco', 'retruco', 'vale4'
      trucoPoints: 1, // Pontos que a mão vale atualmente
      trucoCallerTeam: null, // Time que chamou o truco por último
      trucoResponsePending: false,
      trucoPendingTeam: null,
      trucoChant: '', // Balão de texto do truco
      
      // Envido
      envidoState: 'none', // 'none', 'envido', 'real_envido', 'falta_envido', 'resolved', 'refused'
      envidoPointsAtStake: 0,
      envidoPointsBeforeLastRaise: 0,
      envidoCallerIdx: null,
      envidoResponsePending: false,
      envidoPendingTeam: null,
      envidoChant: '',
      envidoDeclares: {}, // { playerIdx: points } para comparar quando resolvido
      envidoHistory: [], // Histórico de cantadas: ['envido', 'real_envido', etc.]
      envidoResolutionDetails: null, // Detalhes do pop-up do resultado do envido
      canCallEnvido: true, // Envido/Flor só pode ser chamado antes do jogador jogar sua primeira carta
      
      // Flor
      florState: 'none', // 'none', 'flor', 'contra_flor', 'contra_flor_resto', 'resolved', 'refused'
      florPointsAtStake: 0,
      florCallers: [], // [playerIdx]
      florResponsePending: false,
      florPendingTeam: null,
      florChant: '',
      florHistory: [],
      
      // Fold / Ir ao baralho
      foldedPlayers: new Set(),
      
      // Controle de turnos adicionais
      voiceBubble: {} // { playerIdx: "Mensagem" } para animação visual
    };

    // Calcular Envido e Flor de cada jogador de forma oculta
    this.players.forEach((p, idx) => {
      p.envidoScore = calculateEnvidoScore(this.hand.hands[idx]);
      p.florScore = calculateFlorScore(this.hand.hands[idx]);
      p.hasFlor = p.florScore > 0;
    });

    this.log(`Mão iniciada. ${this.players[mãoPlayer].name} é o Mão.`);
  }

  // Permite que um administrador defina manualmente as cartas na mão de um jogador para fins de teste
  adminSetPlayerCards(playerIdx, cardsData) {
    if (!this.hand) return false;
    
    // Converter a lista de valores/naipes em objetos de carta do motor
    const newCards = cardsData.map(c => {
      const val = parseInt(c.value);
      const suit = c.suit;
      return {
        value: val,
        suit: suit,
        trucoRank: getTrucoRank(val, suit),
        envidoPoints: getEnvidoPoints(val)
      };
    });
    
    // Substituir a mão do jogador
    this.hand.hands[playerIdx] = newCards;
    this.hand.originalHands[playerIdx] = JSON.parse(JSON.stringify(newCards));
    
    // Recalcular pontuação de Envido e Flor do jogador
    const player = this.players[playerIdx];
    player.envidoScore = calculateEnvidoScore(newCards);
    player.florScore = calculateFlorScore(newCards);
    player.hasFlor = player.florScore > 0;
    
    this.log(`Admin definiu as cartas de ${player.name}.`);
    return true;
  }

  // Verifica se o jogador já jogou alguma carta nesta mão
  hasPlayerPlayedCard(playerIdx) {
    if (!this.hand) return false;
    return this.hand.playedCards.some(p => p.playerIdx === playerIdx);
  }

  // Encontra qual jogador deve responder à aposta de Truco/Envido/Flor
  setPendingResponse(type, callingPlayerIdx, options) {
    const caller = this.players[callingPlayerIdx];
    const opponentTeam = caller.team === 0 ? 1 : 0;
    
    if (type === 'truco') {
      this.hand.trucoResponsePending = true;
      this.hand.trucoPendingTeam = opponentTeam;
    } else if (type === 'envido') {
      this.hand.envidoResponsePending = true;
      this.hand.envidoPendingTeam = opponentTeam;
    } else if (type === 'flor') {
      this.hand.florResponsePending = true;
      this.hand.florPendingTeam = opponentTeam;
    }
  }

  // Gritos / Cantos
  callTruco(playerIdx) {
    if (!this.hand || this.hand.trucoResponsePending || this.hand.envidoResponsePending || this.hand.florResponsePending) return false;
    
    const team = this.players[playerIdx].team;
    
    // Não pode cantar se o seu time foi o último a cantar
    if (this.hand.trucoCallerTeam === team) return false;

    let nextState = '';
    let chant = '';
    if (this.hand.trucoState === 'none') {
      nextState = 'truco';
      chant = '¡TRUCO!';
    } else if (this.hand.trucoState === 'truco') {
      nextState = 'retruco';
      chant = '¡RETRUCO!';
    } else if (this.hand.trucoState === 'retruco') {
      nextState = 'vale4';
      chant = '¡VALE QUATRO!';
    } else {
      return false; // Já está no Vale 4, não dá pra aumentar
    }

    this.hand.trucoState = nextState;
    this.hand.trucoCallerTeam = team;
    this.hand.trucoResponsePending = true;
    this.hand.trucoPendingTeam = team === 0 ? 1 : 0;
    this.hand.trucoChant = chant;
    this.hand.voiceBubble[playerIdx] = chant;

    this.log(`${this.players[playerIdx].name} gritou ${chant}`, this.players[playerIdx].team);
    return true;
  }

  respondTruco(playerIdx, response) {
    if (!this.hand || !this.hand.trucoResponsePending) return false;
    
    const player = this.players[playerIdx];
    const team = player.team;
    
    if (team !== this.hand.trucoPendingTeam) return false;

    this.hand.trucoResponsePending = false;
    delete this.hand.voiceBubble[playerIdx];

    if (response === 'quero') {
      // Aceitou. O valor dos pontos passa a ser o valor do estado atual.
      if (this.hand.trucoState === 'truco') this.hand.trucoPoints = 2;
      else if (this.hand.trucoState === 'retruco') this.hand.trucoPoints = 3;
      else if (this.hand.trucoState === 'vale4') this.hand.trucoPoints = 4;
      
      this.hand.voiceBubble[playerIdx] = '¡QUERO!';
      this.log(`Time ${team + 1} aceitou o Truco. A mão vale ${this.hand.trucoPoints} pontos.`, team);
    } else if (response === 'nao_quero') {
      // Não aceitou / Correu / Mazo. O time adversário ganha os pontos anteriores.
      const winnerTeam = team === 0 ? 1 : 0;
      
      let pointsWon = 1;
      if (this.hand.trucoState === 'truco') pointsWon = 1;
      else if (this.hand.trucoState === 'retruco') pointsWon = 2;
      else if (this.hand.trucoState === 'vale4') pointsWon = 3;
      
      this.hand.voiceBubble[playerIdx] = '¡NÃO QUERO!';
      this.log(`Time ${team + 1} não aceitou. Time ${winnerTeam + 1} ganha ${pointsWon} ponto(s).`, winnerTeam);
      this.endHand(winnerTeam, pointsWon);
    } else if (response === 'retruco' || response === 'vale4') {
      // Contra-proposta (aumento). O próprio jogador chama o aumento.
      this.hand.trucoResponsePending = false;
      this.callTruco(playerIdx);
    }
    return true;
  }

  // Chamadas de Envido
  callEnvido(playerIdx, type) {
    if (!this.hand || this.hand.envidoResponsePending || this.hand.florResponsePending) return false;
    
    // Se o truco estiver pendente, apenas o time que deve responder ao truco pode chamar envido
    if (this.hand.trucoResponsePending) {
      const callingTeam = this.players[playerIdx].team;
      if (callingTeam !== this.hand.trucoPendingTeam) return false;
    }
    
    // No 2v2, apenas o Pé (jogadores 2 e 3) pode cantar ou responder Envido
    if (this.mode === '2v2' && playerIdx !== 2 && playerIdx !== 3) return false;

    // Envido só pode ser chamado na primeira rodada
    if (this.hand.currentRound !== 0) return false;
    if (!this.hand.canCallEnvido) return false;
    if (this.hasPlayerPlayedCard(playerIdx)) return false;

    // Validar transições permitidas de aumento de Envido
    if (this.hand.envidoHistory.length > 0) {
      const lastCall = this.hand.envidoHistory[this.hand.envidoHistory.length - 1];
      if (type === 'envido') {
        const envidoCount = this.hand.envidoHistory.filter(c => c === 'envido').length;
        if (lastCall !== 'envido' || envidoCount >= 2) return false;
      } else if (type === 'real_envido') {
        if (lastCall !== 'envido') return false;
      } else if (type === 'falta_envido') {
        if (lastCall !== 'real_envido' && lastCall !== 'envido') return false;
      }
    }

    const player = this.players[playerIdx];
    const team = player.team;

    // Se o jogador tiver Flor, ele não pode cantar Envido no truco tradicional gaúcho! Ele deve cantar Flor.
    if (player.hasFlor) return false;

    let pointsToAdd = 0;
    let chant = '';
    
    if (type === 'envido') {
      pointsToAdd = 2;
      chant = '¡ENVIDO!';
    } else if (type === 'real_envido') {
      pointsToAdd = 3;
      chant = '¡REAL ENVIDO!';
    } else if (type === 'falta_envido') {
      // A pontuação real do Falta Envido é definida apenas quando ele é aceito.
      pointsToAdd = 0; 
      chant = '¡FALTA ENVIDO!';
    } else {
      return false;
    }

    this.hand.envidoHistory.push(type);
    this.hand.envidoState = type;
    this.hand.envidoCallerIdx = playerIdx;
    this.hand.envidoResponsePending = true;
    this.hand.envidoPendingTeam = team === 0 ? 1 : 0;
    this.hand.voiceBubble[playerIdx] = chant;

    // Guardar os pontos anteriores antes de atualizar
    this.hand.envidoPointsBeforeLastRaise = this.hand.envidoPointsAtStake;

    // Atualiza pontos do Envido acumulados
    if (type === 'falta_envido') {
      // Se não houver pontos anteriores acumulados, o não quero vale 1 ponto.
      this.hand.envidoPointsAtStake = Math.max(1, this.hand.envidoPointsAtStake);
    } else {
      this.hand.envidoPointsAtStake += pointsToAdd;
    }

    this.log(`${player.name} cantou ${chant}. Pontos em disputa: ${this.hand.envidoPointsAtStake}`);
    return true;
  }

  respondEnvido(playerIdx, response) {
    if (this.mode === '2v2' && playerIdx !== 2 && playerIdx !== 3) return false;
    if (!this.hand || !this.hand.envidoResponsePending) return false;
    
    const player = this.players[playerIdx];
    const team = player.team;
    
    if (team !== this.hand.envidoPendingTeam) return false;

    this.hand.envidoResponsePending = false;
    delete this.hand.voiceBubble[playerIdx];

    const opponentTeam = team === 0 ? 1 : 0;

    if (response === 'quero') {
      this.hand.voiceBubble[playerIdx] = '¡QUERO!';
      this.hand.envidoState = 'resolved';
      
      // Calcular pontos do Falta Envido se for o caso
      if (this.hand.envidoState === 'falta_envido' || this.hand.envidoHistory.includes('falta_envido')) {
        const leadingScore = Math.max(this.score[0], this.score[1]);
        if (leadingScore < 12) {
          // Nas Malas: Falta Envido vale a diferença para chegar a 12
          this.hand.envidoPointsAtStake = 12 - leadingScore;
        } else {
          // Nas Boas: Falta Envido vale a diferença para chegar a 24
          this.hand.envidoPointsAtStake = 24 - leadingScore;
        }
        // Garante que vale pelo menos 1 ponto
        if (this.hand.envidoPointsAtStake <= 0) this.hand.envidoPointsAtStake = 1;
      }
      
      this.log(`Envido aceito pelo Time ${team}. Pontos em jogo: ${this.hand.envidoPointsAtStake}`);
      this.resolveEnvido();
    } else if (response === 'nao_quero') {
      this.hand.voiceBubble[playerIdx] = '¡NÃO QUERO!';
      this.hand.envidoState = 'refused';
      
      // Se recusou o primeiro envido, o time adversário ganha 1 ponto.
      // Se recusou um aumento, ganha o valor acumulado até a rodada anterior.
      let pointsWon = this.hand.envidoPointsBeforeLastRaise === 0 ? 1 : this.hand.envidoPointsBeforeLastRaise;
      
      this.log(`Envido recusado. Time ${opponentTeam} ganha ${pointsWon} ponto(s).`);
      this.score[opponentTeam] += pointsWon;
      this.checkGameWinner();
      
      // Limpar estados pendentes de Envido
      this.hand.canCallEnvido = false;
    } else if (['envido', 'real_envido', 'falta_envido'].includes(response)) {
      // Aumentar aposta do Envido
      this.callEnvido(playerIdx, response);
    }
    return true;
  }

  getBestEnvidoPlayerOfTeam(team) {
    let bestPlayer = null;
    let bestScore = -1;
    let bestIdx = -1;
    for (let i = 0; i < this.maxPlayers; i++) {
      const idx = (this.hand.mão + i) % this.maxPlayers;
      const p = this.players[idx];
      if (p.team === team && !p.hasFlor) {
        if (p.envidoScore > bestScore) {
          bestScore = p.envidoScore;
          bestPlayer = p;
          bestIdx = idx;
        }
      }
    }
    return { player: bestPlayer, score: bestScore, index: bestIdx };
  }

  resolveEnvido() {
    const callerTeam = this.players[this.hand.envidoCallerIdx].team;
    const opponentTeam = callerTeam === 0 ? 1 : 0;

    const bestCaller = this.getBestEnvidoPlayerOfTeam(callerTeam);
    const bestOpponent = this.getBestEnvidoPlayerOfTeam(opponentTeam);

    if (!bestCaller.player || !bestOpponent.player) {
      this.hand.canCallEnvido = false;
      return;
    }

    const hasPriority = (playerIdx1, playerIdx2, mãoIdx, maxPlayers) => {
      for (let i = 0; i < maxPlayers; i++) {
        const idx = (mãoIdx + i) % maxPlayers;
        if (idx === playerIdx1) return true;
        if (idx === playerIdx2) return false;
      }
      return false;
    };

    let callerWins = false;
    if (bestCaller.score > bestOpponent.score) {
      callerWins = true;
    } else if (bestCaller.score < bestOpponent.score) {
      callerWins = false;
    } else {
      callerWins = hasPriority(bestCaller.index, bestOpponent.index, this.hand.mão, this.maxPlayers);
    }

    const winner = callerWins ? bestCaller.player : bestOpponent.player;
    const points = this.hand.envidoPointsAtStake;

    let secondScoreShow = '';
    if (callerWins) {
      secondScoreShow = 'São boas...';
    } else {
      secondScoreShow = bestOpponent.score.toString();
    }

    this.log(`Disputa de Envido vencida por ${winner.name} com ${winner.envidoScore} pontos (Time ${winner.team + 1}).`, winner.team);
    this.score[winner.team] += points;

    // Registrar no estado da mão para mostrar no chat
    this.hand.envidoWinnerInfo = {
      name: winner.name,
      points: winner.envidoScore,
      team: winner.team,
      tentos: points
    };

    // Detalhes da resolução para o pop-up na tela
    this.hand.envidoResolutionDetails = {
      firstPlayerName: bestCaller.player.name,
      firstPlayerScore: bestCaller.score.toString(),
      secondPlayerName: bestOpponent.player.name,
      secondPlayerScore: secondScoreShow,
      winnerName: winner.name,
      winnerTeam: winner.team,
      pointsWon: points
    };

    this.checkGameWinner();
    this.hand.canCallEnvido = false;
  }

  callFlor(playerIdx) {
    if (!this.hand || this.hand.florResponsePending) return false;
    
    // Se o truco estiver pendente, apenas o time que deve responder ao truco pode chamar flor
    if (this.hand.trucoResponsePending) {
      const callingTeam = this.players[playerIdx].team;
      if (callingTeam !== this.hand.trucoPendingTeam) return false;
    }
    if (this.hand.currentRound !== 0) return false;
    if (!this.hand.canCallEnvido) return false;
    if (this.hasPlayerPlayedCard(playerIdx)) return false;

    const player = this.players[playerIdx];
    const team = player.team;

    if (!player.hasFlor) return false;

    this.hand.florState = 'flor';
    this.hand.florCallers.push(playerIdx);

    // Se houver aposta de Envido aberta e não resolvida, o canto de Flor cancela o Envido (ou sobrepõe).
    if (this.hand.envidoResponsePending) {
      this.hand.envidoResponsePending = false;
      this.log(`Envido cancelado devido ao canto de Flor.`);
      this.hand.voiceBubble[playerIdx] = '¡FLOR_SOBRE_ENVIDO!';
    } else {
      this.hand.voiceBubble[playerIdx] = '¡FLOR!';
    }
    this.hand.florHistory.push('flor');
    
    // Por padrão, uma Flor sem oposição vale 3 pontos
    this.hand.florPointsAtStake = 3;

    // Verificar se o time adversário tem alguém com Flor
    const opponentTeam = team === 0 ? 1 : 0;
    const opponentHasFlor = this.players.some(p => p.team === opponentTeam && p.hasFlor);

    if (opponentHasFlor) {
      // Pausa o jogo para o time adversário se manifestar
      this.hand.florResponsePending = true;
      this.hand.florPendingTeam = opponentTeam;
      this.log(`${player.name} cantou Flor! Time adversário possui Flor e deve responder.`);
    } else {
      // Ninguém do outro time tem flor.
      // O time que cantou ganha 3 pontos diretamente (ou 4 se o companheiro também tiver flor)
      let points = 3;
      const partnerIdx = (playerIdx + 2) % 4;
      if (this.maxPlayers === 4 && this.players[partnerIdx].hasFlor) {
        points = 4; // Flor e Flor
        this.log(`Ambos os parceiros têm Flor! Ganham 4 pontos.`);
      }
      
      this.score[team] += points;
      this.log(`Flor não contestada. Time ${team} ganha ${points} ponto(s).`);
      this.hand.florState = 'resolved';
      this.hand.canCallEnvido = false;
      this.checkGameWinner();
    }
    return true;
  }

  respondFlor(playerIdx, response) {
    if (!this.hand || !this.hand.florResponsePending) return false;
    
    const player = this.players[playerIdx];
    const team = player.team;
    
    if (team !== this.hand.florPendingTeam) return false;
    if (!player.hasFlor) return false; // Apenas quem tem flor pode responder à Contra-Flor

    this.hand.florResponsePending = false;
    delete this.hand.voiceBubble[playerIdx];

    const opponentTeam = team === 0 ? 1 : 0;

    if (response === 'quero') {
      // Aceitar a disputa da Flor
      this.hand.voiceBubble[playerIdx] = '¡QUERO!';
      this.hand.florState = 'resolved';
      this.resolveFlor();
    } else if (response === 'contra_flor') {
      // Aumenta para Contra-Flor (vale 6 pontos)
      this.hand.voiceBubble[playerIdx] = '¡CONTRA-FLOR!';
      this.hand.florState = 'contra_flor';
      this.hand.florHistory.push('contra_flor');
      this.hand.florPointsAtStake = 6;
      this.hand.florResponsePending = true;
      this.hand.florPendingTeam = opponentTeam;
      this.log(`${player.name} gritou Contra-Flor!`);
    } else if (response === 'contra_flor_resto') {
      // Aumenta para o Resto da partida (Falta)
      this.hand.voiceBubble[playerIdx] = '¡CONTRA-FLOR E O RESTO!';
      this.hand.florState = 'contra_flor_resto';
      this.hand.florHistory.push('contra_flor_resto');
      
      const leadingScore = Math.max(this.score[0], this.score[1]);
      this.hand.florPointsAtStake = 24 - leadingScore;
      if (this.hand.florPointsAtStake <= 0) this.hand.florPointsAtStake = 1;

      this.hand.florResponsePending = true;
      this.hand.florPendingTeam = opponentTeam;
      this.log(`${player.name} gritou Contra-Flor e o Resto! Pontos em jogo: ${this.hand.florPointsAtStake}`);
    } else if (response === 'nao_quero' || response === 'achique') {
      // Achicou (correu). O oponente ganha os pontos anteriores (3 se era só Flor)
      this.hand.voiceBubble[playerIdx] = '¡ACHIQUE!';
      this.hand.florState = 'refused';
      
      let pointsWon = 3;
      if (this.hand.florHistory.length > 1) {
        const prevCall = this.hand.florHistory[this.hand.florHistory.length - 2];
        if (prevCall === 'flor') pointsWon = 3;
        else if (prevCall === 'contra_flor') pointsWon = 6;
      }
      
      this.log(`Contra-Flor recusada. Time ${opponentTeam} ganha ${pointsWon} ponto(s).`);
      this.score[opponentTeam] += pointsWon;
      this.hand.canCallEnvido = false;
      this.checkGameWinner();
    }
    return true;
  }

  resolveFlor() {
    // Determinar o maior placar de Flor entre todos que têm Flor
    let bestPlayerIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < this.maxPlayers; i++) {
      const idx = (this.hand.mão + i) % this.maxPlayers;
      const p = this.players[idx];
      if (p.hasFlor && p.florScore > bestScore) {
        bestScore = p.florScore;
        bestPlayerIdx = idx;
      }
    }

    if (bestPlayerIdx !== -1) {
      const winner = this.players[bestPlayerIdx];
      const points = this.hand.florPointsAtStake;
      
      this.log(`Disputa de Flor vencida por ${winner.name} com ${bestScore} pontos (Time ${winner.team + 1}).`, winner.team);
      this.score[winner.team] += points;
      
      this.hand.florWinnerInfo = {
        name: winner.name,
        points: bestScore,
        team: winner.team,
        tentos: points
      };

      this.checkGameWinner();
    }
    this.hand.canCallEnvido = false;
  }

  // Jogar uma carta
  playCard(playerIdx, cardIndex) {
    if (!this.hand || this.state !== 'playing') return false;

    // Impede jogar carta se houver respostas pendentes de aposta
    if (this.hand.trucoResponsePending || this.hand.envidoResponsePending || this.hand.florResponsePending) return false;

    if (this.hand.currentPlayer !== playerIdx) return false;

    const cards = this.hand.hands[playerIdx];
    if (cardIndex < 0 || cardIndex >= cards.length) return false;

    // Retira a carta da mão do jogador
    const card = cards.splice(cardIndex, 1)[0];
    
    // Cancela qualquer balão de fala do jogador anterior
    delete this.hand.voiceBubble[playerIdx];

    // Registra a jogada
    this.hand.playedCards.push({
      playerIdx,
      card,
      round: this.hand.currentRound
    });

    this.log(`${this.players[playerIdx].name} jogou ${card.value} de ${card.suit}.`, this.players[playerIdx].team);

    // Próximo turno de carta ou fim da rodada

    // Próximo turno de carta ou fim da rodada
    this.nextTurn();
    return true;
  }

  // Mazo (Correr / Ir para o baralho)
  foldPlayer(playerIdx) {
    if (!this.hand || this.state !== 'playing') return false;
    
    const player = this.players[playerIdx];
    const team = player.team;

    this.hand.voiceBubble[playerIdx] = '¡ME VOU AO MAZO!';
    this.log(`${player.name} foi ao Mazo.`);
    
    // Se for na primeira rodada e o time correr/ir ao mazo, vale no mínimo 2 pontos
    let pointsWon = this.hand.trucoPoints;
    if (this.hand.currentRound === 0 && pointsWon < 2) {
      pointsWon = 2;
    }
    
    if (this.mode === '1v1') {
      const opponentTeam = team === 0 ? 1 : 0;
      this.endHand(opponentTeam, pointsWon);
    } else {
      // No 2v2:
      this.hand.foldedPlayers.add(playerIdx);
      const partnerIdx = (playerIdx + 2) % 4;
      
      // Se ambos os jogadores da equipe dobraram, a outra equipe vence
      if (this.hand.foldedPlayers.has(partnerIdx)) {
        const opponentTeam = team === 0 ? 1 : 0;
        this.endHand(opponentTeam, pointsWon);
      } else {
        // Se apenas um dobrou, o jogo continua apenas com o parceiro.
        // Avança o turno se for o jogador que dobrou
        if (this.hand.currentPlayer === playerIdx) {
          this.nextTurn();
        }
      }
    }
    return true;
  }

  nextTurn() {
    const activePlayersCount = this.players.length;
    const currentRound = this.hand.currentRound;

    // Jogadas feitas na rodada atual
    const roundPlays = this.hand.playedCards.filter(p => p.round === currentRound);

    // Quantos jogadores ativos restaram para jogar nesta rodada (não contam os que foram ao mazo)
    const expectedPlaysCount = activePlayersCount - this.hand.foldedPlayers.size;

    if (roundPlays.length < expectedPlaysCount) {
      // Ainda faltam jogadores jogarem nesta rodada
      let nextPlayer = (this.hand.currentPlayer + 1) % this.maxPlayers;
      
      // Pular jogadores que já descartaram suas mãos ou foram ao mazo
      while (
        this.hand.foldedPlayers.has(nextPlayer) || 
        this.hand.hands[nextPlayer].length === 0 && this.hand.playedCards.filter(p => p.playerIdx === nextPlayer && p.round === currentRound).length === 0
      ) {
        nextPlayer = (nextPlayer + 1) % this.maxPlayers;
      }
      
      this.hand.currentPlayer = nextPlayer;
    } else {
      // Fim da rodada (todos os jogadores ativos jogaram)
      this.resolveRound();
    }
  }

  resolveRound() {
    const currentRound = this.hand.currentRound;
    const roundPlays = this.hand.playedCards.filter(p => p.round === currentRound);

    if (roundPlays.length === 0) return;

    // Encontra a maior carta da rodada
    let winningPlay = roundPlays[0];
    let isTie = false;

    for (let i = 1; i < roundPlays.length; i++) {
      const play = roundPlays[i];
      if (play.card.trucoRank > winningPlay.card.trucoRank) {
        winningPlay = play;
        isTie = false;
      } else if (play.card.trucoRank === winningPlay.card.trucoRank) {
        // Empate de cartas só ocorre se pertencerem a times opostos
        const t1 = this.players[play.playerIdx].team;
        const t2 = this.players[winningPlay.playerIdx].team;
        if (t1 !== t2) {
          isTie = true;
        }
      }
    }

    const roundWinnerTeam = isTie ? -1 : this.players[winningPlay.playerIdx].team;
    const roundWinnerPlayerIdx = isTie ? -1 : winningPlay.playerIdx;

    this.hand.roundsWon.push(roundWinnerTeam);
    this.hand.roundWinners.push(roundWinnerPlayerIdx);

    if (isTie) {
      this.log(`Rodada ${currentRound + 1} terminou EMPATADA.`);
    } else {
      this.log(`Rodada ${currentRound + 1} vencida por ${this.players[roundWinnerPlayerIdx].name} (Time ${roundWinnerTeam + 1}).`, roundWinnerTeam);
    }

    // Verificar se a mão acabou (melhor de 3)
    const handWinner = this.checkHandWinner();
    if (handWinner !== null) {
      this.endHand(handWinner, this.hand.trucoPoints);
    } else {
      // Avança para a próxima rodada
      this.hand.currentRound++;
      
      // Quem começa a próxima rodada é quem ganhou a rodada anterior.
      // Se deu empate, quem começa é o "Mão" da rodada anterior (ou o primeiro ativo a partir do mão).
      if (isTie) {
        this.hand.currentPlayer = this.hand.mão;
      } else {
        this.hand.currentPlayer = roundWinnerPlayerIdx;
      }

      // Se o jogador que venceu a rodada foi ao mazo ou não tem cartas, vai para o próximo ativo
      while (this.hand.foldedPlayers.has(this.hand.currentPlayer)) {
        this.hand.currentPlayer = (this.hand.currentPlayer + 1) % this.maxPlayers;
      }
    }
  }

  // Verifica se temos um vencedor para a mão atual
  checkHandWinner() {
    const r = this.hand.roundsWon;
    
    // Contar vitórias de cada time
    const t0Wins = r.filter(w => w === 0).length;
    const t1Wins = r.filter(w => w === 1).length;
    const ties = r.filter(w => w === -1).length;

    // Caso 1: Um time ganhou duas rodadas
    if (t0Wins === 2) return 0;
    if (t1Wins === 2) return 1;

    // Caso 2: Primeira rodada empatou (parda)
    if (r[0] === -1) {
      if (r[1] === 0) return 0;
      if (r[1] === 1) return 1;
      if (r[1] === -1) { // Primeira e segunda empataram
        if (r[2] === 0) return 0;
        if (r[2] === 1) return 1;
        if (r[2] === -1) { // Todas as três empataram
          // O Mão ganha
          return this.players[this.hand.mão].team;
        }
      }
    }

    // Caso 3: Segunda rodada empatou
    if (r[1] === -1 && r[0] !== -1) {
      return r[0]; // Quem ganhou a primeira leva a partida
    }

    // Caso 4: Terceira rodada empatou (1ª de um, 2ª de outro)
    if (r[2] === -1 && r[0] !== -1 && r[1] !== -1) {
      return r[0]; // Quem ganhou a primeira leva a partida
    }

    // Caso 5: Três rodadas jogadas e placar 1 a 1
    if (r.length === 3) {
      // Se chegou à terceira e ninguém ganhou duas, e não houve empate na terceira,
      // quem ganhou a 3ª rodada leva
      if (r[2] === 0) return 0;
      if (r[2] === 1) return 1;
    }

    return null; // Jogo continua
  }

  endHand(winnerTeam, points) {
    this.score[winnerTeam] += points;
    this.log(`Fim da mão. Time ${winnerTeam + 1} ganha ${points} ponto(s). Placar: Time 1 [${this.score[0]}] x [${this.score[1]}] Time 2`);

    // Guardar dados da última mão para histórico do cliente
    this.lastHandSummary = {
      originalHands: this.hand.originalHands,
      playedCards: this.hand.playedCards,
      roundsWon: this.hand.roundsWon,
      roundWinners: this.hand.roundWinners,
      winnerTeam,
      pointsWon: points,
      voiceBubble: { ...this.hand.voiceBubble }
    };

    // Verificar fim do jogo
    if (this.checkGameWinner()) {
      return;
    }

    // Passar o carteador para o próximo
    this.dealerIndex = (this.dealerIndex + 1) % this.maxPlayers;
    this.hand = null;
    
    // Delay para iniciar próxima mão de forma limpa (gerenciado no server.js)
    this.state = 'hand_end';
  }

  checkGameWinner() {
    const limit = this.maxPoints || 24;
    if (this.score[0] >= limit) {
      this.state = 'game_end';
      this.winner = 0;
      this.log(`FIM DE JOGO! TIME 1 VENCEU A PARTIDA!`);
      return true;
    }
    if (this.score[1] >= limit) {
      this.state = 'game_end';
      this.winner = 1;
      this.log(`FIM DE JOGO! TIME 2 VENCEU A PARTIDA!`);
      return true;
    }
    return false;
  }

  // Gera dados do jogo sanitizados para enviar para um cliente específico
  getGameStateForPlayer(playerIdx) {
    if (!this.hand) {
      return {
        id: this.id,
        roomName: this.roomName || this.id,
        mode: this.mode,
        maxPoints: this.maxPoints || 24,
        maxPlayers: this.maxPlayers,
        players: this.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot, team: p.team, ready: p.ready, voiceConfig: p.voiceConfig })),
        score: this.score,
        state: this.state,
        winner: this.winner,
        logs: this.gameLogs,
        dealerIndex: this.dealerIndex,
        lastHandSummary: this.lastHandSummary
      };
    }

    // Ocultar cartas dos outros jogadores (revelando parceiro no 2v2)
    const maskedHands = {};
    Object.keys(this.hand.hands).forEach(key => {
      const idx = parseInt(key);
      const isPartner = this.mode === '2v2' && this.players[idx] && this.players[playerIdx] && this.players[idx].team === this.players[playerIdx].team;
      if (idx === playerIdx || isPartner) {
        maskedHands[idx] = this.hand.hands[idx];
      } else {
        // Mapear apenas para representar que o jogador tem cartas, mas sem revelar o valor/naipe
        maskedHands[idx] = this.hand.hands[idx].map(() => ({ hidden: true }));
      }
    });

    return {
      id: this.id,
      roomName: this.roomName || this.id,
      mode: this.mode,
      maxPoints: this.maxPoints || 24,
      maxPlayers: this.maxPlayers,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        team: p.team,
        hasFlor: p.hasFlor,
        envidoScore: p.envidoScore, // Mostrado apenas no final ou disputa resolvida
        voiceConfig: p.voiceConfig
      })),
      score: this.score,
      state: this.state,
      winner: this.winner,
      logs: this.gameLogs,
      dealerIndex: this.dealerIndex,
      lastHandSummary: this.lastHandSummary,
      
      // Detalhes da mão
      hand: {
        hands: maskedHands,
        playedCards: this.hand.playedCards,
        roundsWon: this.hand.roundsWon,
        roundWinners: this.hand.roundWinners,
        currentRound: this.hand.currentRound,
        mão: this.hand.mão,
        currentPlayer: this.hand.currentPlayer,
        
        // Truco
        trucoState: this.hand.trucoState,
        trucoPoints: this.hand.trucoPoints,
        trucoCallerTeam: this.hand.trucoCallerTeam,
        trucoResponsePending: this.hand.trucoResponsePending,
        trucoPendingTeam: this.hand.trucoPendingTeam,
        trucoChant: this.hand.trucoChant,
        
        // Envido
        envidoState: this.hand.envidoState,
        envidoPointsAtStake: this.hand.envidoPointsAtStake,
        envidoCallerIdx: this.hand.envidoCallerIdx,
        envidoResponsePending: this.hand.envidoResponsePending,
        envidoPendingTeam: this.hand.envidoPendingTeam,
        envidoChant: this.hand.envidoChant,
        envidoWinnerInfo: this.hand.envidoWinnerInfo,
        envidoHistory: this.hand.envidoHistory,
        canCallEnvido: this.hand.canCallEnvido,
        
        // Flor
        florState: this.hand.florState,
        florPointsAtStake: this.hand.florPointsAtStake,
        florCallers: this.hand.florCallers,
        florResponsePending: this.hand.florResponsePending,
        florPendingTeam: this.hand.florPendingTeam,
        florChant: this.hand.florChant,
        florWinnerInfo: this.hand.florWinnerInfo,
        
        // Folds e voice
        foldedPlayers: Array.from(this.hand.foldedPlayers),
        voiceBubble: this.hand.voiceBubble
      }
    };
  }
}

module.exports = {
  TrucoGame,
  createDeck,
  shuffle,
  calculateEnvidoScore,
  calculateFlorScore,
  getTrucoRank
};
