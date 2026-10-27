// cara eu técnicamente fiz uma engine

const SUITS = ['espadas', 'paus', 'copas', 'ouros'];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12]; // oitos e 9s não tem

// Hierarquia do Truco
function getTrucoRank(value, suit) {
  if (value === 1 && suit === 'espadas') return 14; // Espadão
  if (value === 1 && suit === 'paus') return 13;    // Pauzao
  if (value === 7 && suit === 'espadas') return 12; // 7 de espada
  if (value === 7 && suit === 'ouros') return 11;   // 7 de ouro
  if (value === 3) return 10;                      // 3
  if (value === 2) return 9;                       // 2
  if (value === 1 && (suit === 'copas' || suit === 'ouros')) return 8; // 1 de copão e 1 de ouro
  if (value === 12) return 7;                      // 12
  if (value === 11) return 6;                      // 11
  if (value === 10) return 5;                      // 10
  if (value === 7 && (suit === 'paus' || suit === 'copas')) return 4; // 7 de pau e 7 de copa
  if (value === 6) return 3;
  if (value === 5) return 2;
  if (value === 4) return 1;
  return 0;
}

// Valor para os pontos do Envido/Flor: 1 a 7 valem o próprio valor, 10/11/12 valem 0 pq são figuras
function getEnvidoPoints(value) {
  return value <= 7 ? value : 0;
}

// Cria um baralho completo 40 cartas
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

// Embaralha
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

  // se chamar envido sem par, vale a de maior valor sozinha sem contar as figuras
  if (!hasPair) {
    maxScore = Math.max(cards[0].envidoPoints, cards[1].envidoPoints, cards[2].envidoPoints);
  }

  return maxScore;
}

// Cartas que formam o envido (as que precisam ser mostradas no fim da mão):
// o par do mesmo naipe que dá mais pontos ou, sem par, a carta mais alta
function envidoProofCards(cards) {
  let best = null;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].suit !== cards[j].suit) continue;
      const score = 20 + cards[i].envidoPoints + cards[j].envidoPoints;
      if (!best || score > best.score) best = { score, cards: [cards[i], cards[j]] };
    }
  }
  if (best) return best.cards;
  return [cards.reduce((a, b) => (b.envidoPoints > a.envidoPoints ? b : a))];
}

// Calcula os pontos da flor
function calculateFlorScore(cards) {
  if (cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit) {
    return 20 + cards[0].envidoPoints + cards[1].envidoPoints + cards[2].envidoPoints;
  }
  return 0; // Não tem Flor
}

class TrucoGame { // TRUCO GURIZINHO
  constructor(id, mode, maxPoints = 24) {
    this.id = id;
    this.mode = mode; // 1v1 ou 2v2
    this.maxPlayers = mode === '1v1' ? 2 : 4;
    this.players = []; // [{ id, name, socketId, isBot, team }]
    this.score = { 0: 0, 1: 0 }; // Pontuação por equipe
    this.state = 'lobby'; // 'lobby', 'playing', 'game_end'
    this.gameLogs = [];
    this.maxPoints = maxPoints;

    // Estado da rodada/mão atual
    this.dealerIndex = 0;
    this.hand = null;
    this.revealSeq = 0; // id de cada "cantar os pontos" (envido/flor aceitos)
  }

  // Cantar os pontos depois de um Envido/Flor aceito.
  // A partir do mão, quem está perdendo canta os pontos se tiver mais; se não tiver,
  // diz "São boas" sem revelar. Parceiros de quem está ganhando não precisam cantar.
  // Empate: ganha quem está mais perto do mão.
  declarePoints(eligible, scoreOf) {
    const order = [];
    for (let i = 0; i < this.maxPlayers; i++) {
      const idx = (this.hand.mão + i) % this.maxPlayers;
      if (this.players[idx] && eligible(idx)) order.push(idx);
    }
    const pos = idx => order.indexOf(idx);
    const decided = new Set();
    const lines = [];
    let best = -1;
    let changed = true;
    while (changed) {
      changed = false;
      for (const idx of order) {
        if (decided.has(idx)) continue;
        if (best !== -1 && this.players[idx].team === this.players[best].team) continue;
        const score = scoreOf(idx);
        const wins = best === -1 || score > scoreOf(best) || (score === scoreOf(best) && pos(idx) < pos(best));
        decided.add(idx);
        changed = true;
        lines.push({ playerIdx: idx, name: this.players[idx].name, team: this.players[idx].team, score: wins ? score : null });
        if (wins) best = idx;
      }
    }
    return { winnerIdx: best, lines };
  }

  // Guarda as cartas que alguém vai ter que mostrar no fim da mão
  addProof(playerIdx, kind, score, cards) {
    if (!this.hand.proofs) this.hand.proofs = [];
    if (this.hand.proofs.some(p => p.playerIdx === playerIdx && p.kind === kind)) return;
    this.hand.proofs.push({ playerIdx, kind, score, cards: JSON.parse(JSON.stringify(cards)) });
  }

  addFlorProof(playerIdx) {
    const p = this.players[playerIdx];
    if (p && p.hasFlor) this.addProof(playerIdx, 'flor', p.florScore, this.hand.originalHands[playerIdx]);
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

  // Jogador foi ao mazo nesta mão?
  isFolded(playerIdx) {
    return !!(this.hand && this.hand.foldedPlayers.has(playerIdx));
  }

  // "Pé" de cada dupla: quem joga por último no time, a partir do Mão.
  // Ordem da mão: mão, mão+1, mão+2, mão+3 → pés são mão+2 e mão+3.
  // Se o pé foi ao mazo, o parceiro assume. No 1v1 todos são pé.
  isPe(playerIdx) {
    if (this.mode !== '2v2' || !this.hand) return true;
    const mao = this.hand.mão;
    const pes = [(mao + 2) % 4, (mao + 3) % 4];
    if (pes.includes(playerIdx)) return true;
    const partnerIdx = (playerIdx + 2) % 4;
    return pes.includes(partnerIdx) && this.isFolded(partnerIdx);
  }

  // Quem responde a um canto: o próximo adversário na ordem de jogo depois de
  // quem cantou (se ele foi ao mazo, o parceiro dele)
  responderAfter(callerIdx) {
    const callerTeam = this.players[callerIdx].team;
    for (let k = 1; k < this.maxPlayers; k++) {
      const idx = (callerIdx + k) % this.maxPlayers;
      if (this.players[idx].team !== callerTeam && !this.isFolded(idx)) return idx;
    }
    return -1;
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
    if (this.isFolded(playerIdx)) return false;

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
    this.hand.trucoResponderIdx = this.responderAfter(playerIdx);
    this.hand.trucoChant = chant;
    this.hand.voiceBubble[playerIdx] = chant;

    this.log(`${this.players[playerIdx].name} gritou ${chant}`, this.players[playerIdx].team);
    return true;
  }

  respondTruco(playerIdx, response) {
    if (!this.hand || !this.hand.trucoResponsePending) return false;
    if (this.isFolded(playerIdx)) return false;

    const player = this.players[playerIdx];
    const team = player.team;

    if (team !== this.hand.trucoPendingTeam) return false;
    // Só o próximo depois de quem cantou responde
    if (this.hand.trucoResponderIdx !== undefined && this.hand.trucoResponderIdx !== playerIdx) return false;

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
  callEnvido(playerIdx, type, isRaise = false) {
    if (!this.hand || this.hand.envidoResponsePending || this.hand.florResponsePending) return false;
    if (this.isFolded(playerIdx)) return false;

    if (isRaise) {
      // Aumento: feito por quem estava respondendo (já validado em respondEnvido)
    } else if (this.hand.trucoResponsePending) {
      // "O envido está primeiro": quem vai responder o Truco pode cantar Envido antes
      const callingTeam = this.players[playerIdx].team;
      if (callingTeam !== this.hand.trucoPendingTeam) return false;
      if (this.hand.trucoResponderIdx !== undefined && this.hand.trucoResponderIdx !== playerIdx) return false;
    } else if (!this.isPe(playerIdx)) {
      // No 2v2, apenas o Pé de cada dupla pode cantar o Envido
      return false;
    }

    // Envido só pode ser chamado na primeira rodada
    if (this.hand.currentRound !== 0) return false;
    if (!this.hand.canCallEnvido) return false;
    if (!isRaise && this.hasPlayerPlayedCard(playerIdx)) return false;

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
    this.hand.envidoResponderIdx = this.responderAfter(playerIdx);
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

  // O aumento do Envido é permitido? (mesmas regras do callEnvido)
  canRaiseEnvido(type, player) {
    if (player.hasFlor || this.hand.currentRound !== 0) return false;
    const history = this.hand.envidoHistory;
    const lastCall = history[history.length - 1];
    if (type === 'envido') return lastCall === 'envido' && history.filter(c => c === 'envido').length < 2;
    if (type === 'real_envido') return lastCall === 'envido';
    if (type === 'falta_envido') return lastCall === 'envido' || lastCall === 'real_envido';
    return false;
  }

  respondEnvido(playerIdx, response) {
    if (!this.hand || !this.hand.envidoResponsePending) return false;
    if (this.isFolded(playerIdx)) return false;

    const player = this.players[playerIdx];
    const team = player.team;

    if (team !== this.hand.envidoPendingTeam) return false;
    // Só o próximo depois de quem cantou responde
    if (this.hand.envidoResponderIdx !== undefined && this.hand.envidoResponderIdx !== playerIdx) return false;
    if (!['quero', 'nao_quero', 'envido', 'real_envido', 'falta_envido'].includes(response)) return false;
    // Aumento inválido não pode "engolir" a resposta pendente
    if (response !== 'quero' && response !== 'nao_quero' && !this.canRaiseEnvido(response, player)) return false;

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
      this.callEnvido(playerIdx, response, true);
    }
    return true;
  }

  resolveEnvido() {
    // Cada um canta os pontos em ordem a partir do Mão (quem tem Flor não participa)
    const { winnerIdx, lines } = this.declarePoints(
      idx => !this.players[idx].hasFlor && !this.isFolded(idx),
      idx => this.players[idx].envidoScore
    );
    const bestPlayerIdx = winnerIdx;
    const bestScore = winnerIdx !== -1 ? this.players[winnerIdx].envidoScore : -1;

    if (bestPlayerIdx !== -1) {
      const winner = this.players[bestPlayerIdx];
      const points = this.hand.envidoPointsAtStake;

      this.hand.reveal = {
        id: ++this.revealSeq,
        kind: 'envido',
        lines,
        winnerIdx: bestPlayerIdx,
        winnerTeam: winner.team,
        tentos: points
      };
      this.addProof(bestPlayerIdx, 'envido', bestScore, envidoProofCards(this.hand.originalHands[bestPlayerIdx]));

      this.log(`Disputa de Envido vencida por ${winner.name} com ${bestScore} pontos (Time ${winner.team + 1}).`, winner.team);
      this.score[winner.team] += points;

      // Registrar no estado da mão para mostrar no chat
      this.hand.envidoWinnerInfo = {
        name: winner.name,
        points: bestScore,
        team: winner.team,
        tentos: points
      };

      this.checkGameWinner();
    }

    this.hand.canCallEnvido = false;
  }

  callFlor(playerIdx) {
    if (!this.hand || this.hand.florResponsePending) return false;
    if (this.isFolded(playerIdx)) return false;
    if (this.hand.florState !== 'none') return false; // a dupla já cantou

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
    // Quem foi ao mazo não responde a Flor
    const opponentHasFlor = this.players.some((p, i) => p.team === opponentTeam && p.hasFlor && !this.isFolded(i));

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
      this.addFlorProof(playerIdx);
      if (points === 4) this.addFlorProof(partnerIdx);
      this.hand.florState = 'resolved';
      this.hand.canCallEnvido = false;
      this.checkGameWinner();
    }
    return true;
  }

  // A dupla que devia responder a Flor ficou sem ninguém com Flor (mazo): perde a aposta
  autoAchique(team) {
    const opponentTeam = team === 0 ? 1 : 0;
    const history = this.hand.florHistory;
    const prevCall = history.length > 1 ? history[history.length - 2] : 'flor';
    const pointsWon = prevCall === 'contra_flor' ? 6 : 3;
    this.hand.florResponsePending = false;
    this.hand.florState = 'refused';
    this.hand.canCallEnvido = false;
    this.score[opponentTeam] += pointsWon;
    this.log(`Ninguém respondeu a Flor. Time ${opponentTeam + 1} ganha ${pointsWon} ponto(s).`, opponentTeam);
    this.hand.florCallers.filter(i => this.players[i].team === opponentTeam).forEach(i => this.addFlorProof(i));
    this.checkGameWinner();
  }

  respondFlor(playerIdx, response) {
    if (!this.hand || !this.hand.florResponsePending) return false;

    const player = this.players[playerIdx];
    const team = player.team;

    if (team !== this.hand.florPendingTeam) return false;
    if (!player.hasFlor || this.isFolded(playerIdx)) return false; // Apenas quem tem flor pode responder à Contra-Flor

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
      this.hand.florCallers.filter(i => this.players[i].team === opponentTeam).forEach(i => this.addFlorProof(i));
      this.hand.canCallEnvido = false;
      this.checkGameWinner();
    }
    return true;
  }

  resolveFlor() {
    // Determinar o maior placar de Flor entre todos que têm Flor
    const { winnerIdx, lines } = this.declarePoints(
      idx => this.players[idx].hasFlor && !this.isFolded(idx),
      idx => this.players[idx].florScore
    );
    const bestPlayerIdx = winnerIdx;
    const bestScore = winnerIdx !== -1 ? this.players[winnerIdx].florScore : -1;

    if (bestPlayerIdx !== -1) {
      const winner = this.players[bestPlayerIdx];
      const points = this.hand.florPointsAtStake;

      this.hand.reveal = {
        id: ++this.revealSeq,
        kind: 'flor',
        lines,
        winnerIdx: bestPlayerIdx,
        winnerTeam: winner.team,
        tentos: points
      };
      this.addFlorProof(bestPlayerIdx);

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
    if (this.isFolded(playerIdx)) return false;

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
      // No 2v2: o jogador larga as cartas e o parceiro segue sozinho
      if (this.isFolded(playerIdx)) return false;
      this.hand.foldedPlayers.add(playerIdx);
      this.hand.hands[playerIdx] = [];
      const partnerIdx = (playerIdx + 2) % 4;

      // Se ambos os jogadores da equipe dobraram, a outra equipe vence
      if (this.hand.foldedPlayers.has(partnerIdx)) {
        const opponentTeam = team === 0 ? 1 : 0;
        this.endHand(opponentTeam, pointsWon);
      } else {
        // Se apenas um dobrou, o jogo continua apenas com o parceiro.
        this.log(`${this.players[partnerIdx].name} segue sozinho pela dupla.`, team);
        // Se ele ia responder um canto, quem responde passa a ser o parceiro
        if (this.hand.trucoResponderIdx === playerIdx) this.hand.trucoResponderIdx = partnerIdx;
        if (this.hand.envidoResponderIdx === playerIdx) this.hand.envidoResponderIdx = partnerIdx;
        // Era o único da dupla com Flor para responder: a dupla "achica"
        const florHolderLeft = this.players.some((p, i) => p.team === team && p.hasFlor && !this.isFolded(i));
        if (this.hand.florResponsePending && this.hand.florPendingTeam === team && !florHolderLeft) {
          this.autoAchique(team);
        }
        // Avança o turno se era a vez de quem foi ao mazo
        if (this.hand.currentPlayer === playerIdx) {
          this.nextTurn();
        }
      }
    }
    return true;
  }

  nextTurn() {
    const currentRound = this.hand.currentRound;
    const roundPlays = this.hand.playedCards.filter(p => p.round === currentRound);

    // Ainda precisa jogar nesta rodada: não foi ao mazo e não jogou ainda
    const needsToPlay = (idx) =>
      !this.hand.foldedPlayers.has(idx) &&
      !roundPlays.some(p => p.playerIdx === idx);

    // Procura o próximo na ordem de jogo
    for (let step = 1; step <= this.maxPlayers; step++) {
      const idx = (this.hand.currentPlayer + step) % this.maxPlayers;
      if (needsToPlay(idx)) {
        this.hand.currentPlayer = idx;
        return;
      }
    }

    // Todos os jogadores ativos jogaram: fim da rodada
    this.resolveRound();
  }

  resolveRound() {
    const currentRound = this.hand.currentRound;
    const roundPlays = this.hand.playedCards.filter(p => p.round === currentRound && !this.hand.foldedPlayers.has(p.playerIdx));

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
      voiceBubble: { ...this.hand.voiceBubble },
      reveal: this.hand.reveal || null,
      proofCards: this.buildProofCards()
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

  // Cartas para provar o Envido/Flor no fim da mão: só as que ainda não foram
  // jogadas, nas colunas de rodada que o jogador deixou livres
  buildProofCards() {
    const out = [];
    (this.hand.proofs || []).forEach(proof => {
      const plays = this.hand.playedCards.filter(pl => pl.playerIdx === proof.playerIdx);
      const usedRounds = new Set(plays.map(pl => pl.round));
      out.filter(c => c.playerIdx === proof.playerIdx).forEach(c => usedRounds.add(c.round));
      const same = (a, b) => a.value === b.value && a.suit === b.suit;
      const alreadyShown = card => plays.some(pl => same(pl.card, card))
        || out.some(c => c.playerIdx === proof.playerIdx && same(c.card, card));
      proof.cards.filter(card => !alreadyShown(card)).forEach(card => {
        let round = 0;
        while (usedRounds.has(round)) round++;
        usedRounds.add(round);
        out.push({ playerIdx: proof.playerIdx, card, round, kind: proof.kind, score: proof.score });
      });
    });
    return out;
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
        players: this.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot, difficulty: p.isBot ? p.difficulty : undefined, team: p.team, ready: p.ready, disconnected: !!p.disconnected })),
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
      // Pontos de envido e flor só vão para o próprio jogador e o parceiro
      players: this.players.map((p, idx) => {
        const own = idx === playerIdx || (this.players[playerIdx] && p.team === this.players[playerIdx].team);
        return {
          id: p.id,
          name: p.name,
          isBot: p.isBot,
          team: p.team,
          disconnected: !!p.disconnected,
          hasFlor: own ? p.hasFlor : undefined,
          envidoScore: own ? p.envidoScore : undefined
        };
      }),
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
        trucoResponderIdx: this.hand.trucoResponderIdx,

        // Envido
        envidoState: this.hand.envidoState,
        envidoPointsAtStake: this.hand.envidoPointsAtStake,
        envidoCallerIdx: this.hand.envidoCallerIdx,
        envidoResponsePending: this.hand.envidoResponsePending,
        envidoPendingTeam: this.hand.envidoPendingTeam,
        envidoChant: this.hand.envidoChant,
        envidoResponderIdx: this.hand.envidoResponderIdx,
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

        // Pontos cantados no último Envido/Flor aceito
        reveal: this.hand.reveal || null,

        // Folds, pés (quem controla o Envido no 2v2) e voice
        foldedPlayers: Array.from(this.hand.foldedPlayers),
        pes: this.players.map((_, i) => i).filter(i => this.isPe(i)),
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
