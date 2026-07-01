// testEngine.js
// Script de testes unitários do motor do jogo (gameEngine.js)

const {
  createDeck,
  getTrucoRank,
  calculateEnvidoScore,
  calculateFlorScore,
  TrucoGame
} = require('./gameEngine');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALHOU: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSOU: ${message}`);
  }
}

console.log("=== Iniciando Testes do Motor do Truco Gaúcho ===\n");

// 1. Teste de Deck
const deck = createDeck();
assert(deck.length === 40, "Baralho deve conter exatamente 40 cartas.");

// 2. Teste de Hierarquia de Cartas
const espadilha = getTrucoRank(1, 'espadas');
const bastiao = getTrucoRank(1, 'paus');
const seteEspadas = getTrucoRank(7, 'espadas');
const seteOuros = getTrucoRank(7, 'ouros');
const tres = getTrucoRank(3, 'copas');
const dois = getTrucoRank(2, 'ouros');
const anchoFalso = getTrucoRank(1, 'copas');
const figura = getTrucoRank(12, 'paus');
const quatro = getTrucoRank(4, 'espadas');

assert(espadilha === 14, "Espadilha (1 de Espadas) deve ter rank 14.");
assert(bastiao === 13, "Bastião (1 de Paus) deve ter rank 13.");
assert(seteEspadas === 12, "7 de Espadas deve ter rank 12.");
assert(seteOuros === 11, "7 de Ouros deve ter rank 11.");
assert(espadilha > bastiao, "Espadilha deve ganhar de Bastião.");
assert(bastiao > seteEspadas, "Bastião deve ganhar de 7 de Espadas.");
assert(seteEspadas > seteOuros, "7 de Espadas deve ganhar de 7 de Ouros.");
assert(seteOuros > tres, "7 de Ouros deve ganhar de 3.");
assert(tres > dois, "3 deve ganhar de 2.");
assert(dois > anchoFalso, "2 deve ganhar de Ancho Falso (1 de Copas/Ouros).");
assert(anchoFalso > figura, "Ancho Falso deve ganhar de Reis (12).");
assert(figura > quatro, "Reis (12) deve ganhar de 4.");

// 3. Teste de Cálculo do Envido
// Caso A: Par de mesmo naipe
const cardsEnvidoPar = [
  { value: 7, suit: 'espadas', envidoPoints: 7 },
  { value: 6, suit: 'espadas', envidoPoints: 6 },
  { value: 3, suit: 'paus', envidoPoints: 3 }
];
const envido1 = calculateEnvidoScore(cardsEnvidoPar);
assert(envido1 === 33, `7 e 6 de espadas deve dar 33 de Envido. Calculado: ${envido1}`);

// Caso B: Par de figuras (valem 0)
const cardsEnvidoFiguras = [
  { value: 12, suit: 'copas', envidoPoints: 0 },
  { value: 10, suit: 'copas', envidoPoints: 0 },
  { value: 1, suit: 'ouros', envidoPoints: 1 }
];
const envido2 = calculateEnvidoScore(cardsEnvidoFiguras);
assert(envido2 === 20, `12 e 10 de mesmo naipe deve dar 20 de Envido. Calculado: ${envido2}`);

// Caso C: Todos os naipes diferentes (pega o maior)
const cardsEnvidoDiferentes = [
  { value: 1, suit: 'espadas', envidoPoints: 1 },
  { value: 3, suit: 'paus', envidoPoints: 3 },
  { value: 10, suit: 'copas', envidoPoints: 0 }
];
const envido3 = calculateEnvidoScore(cardsEnvidoDiferentes);
assert(envido3 === 3, `Diferentes naipes (1, 3, 10) deve dar 3 de Envido. Calculado: ${envido3}`);

// Caso D: Flor na mão (envido deve retornar 0, pois é Flor)
const cardsFlor = [
  { value: 1, suit: 'espadas', envidoPoints: 1 },
  { value: 2, suit: 'espadas', envidoPoints: 2 },
  { value: 3, suit: 'espadas', envidoPoints: 3 }
];
const envido4 = calculateEnvidoScore(cardsFlor);
assert(envido4 === 0, "Mão com Flor deve retornar Envido = 0.");

// 4. Teste de Cálculo de Flor
const flor1 = calculateFlorScore(cardsFlor);
assert(flor1 === 26, `1, 2, 3 de espadas deve dar 26 de Flor. Calculado: ${flor1}`);

const flor2 = calculateFlorScore(cardsEnvidoPar);
assert(flor2 === 0, "Mão sem Flor deve retornar Flor = 0.");

// 5. Teste de Lógica de Desempate de Vazas (checkHandWinner)
const game = new TrucoGame("TEST", "1v1");
game.addPlayer("P1", "Jogador 1", "s1");
game.addPlayer("P2", "Jogador 2", "s2");
game.startNewHand();

// Simular rodada 1 ganha por Time 0, rodada 2 por Time 1, rodada 3 empatada
game.hand.roundsWon = [0, 1, -1];
assert(game.checkHandWinner() === 0, "Se 1ª ganha por T0, 2ª por T1, e 3ª empata, T0 vence (ganhador da primeira).");

// Simular rodada 1 empatada, rodada 2 ganha por T1
game.hand.roundsWon = [-1, 1];
assert(game.checkHandWinner() === 1, "Se 1ª empata e 2ª é ganha por T1, T1 vence a mão.");

// Simular todas as rodadas empatadas
game.hand.roundsWon = [-1, -1, -1];
// Jogador Mão é o P2 (index 1), pois dealerIndex = 0 e mão = (0+1)%2 = 1.
assert(game.checkHandWinner() === 1, "Se todas empatarem, o Mão (Time 1) deve vencer.");

// 6. Teste de Lógica de Transições de Envido
const gameEnvidoTest = new TrucoGame("TEST_ENV", "1v1");
gameEnvidoTest.addPlayer("P1", "Jogador 1", "s1");
gameEnvidoTest.addPlayer("P2", "Jogador 2", "s2");
gameEnvidoTest.startNewHand();

// Garantir que nenhum jogador tenha Flor para permitir Envido
gameEnvidoTest.players[0].hasFlor = false;
gameEnvidoTest.players[1].hasFlor = false;

// Jogador 1 (Mão - index 1) chama Envido (Ok)
assert(gameEnvidoTest.callEnvido(1, "envido") === true, "Jogador Mão pode chamar Envido inicialmente.");

// Simular resposta (Zera envidoResponsePending para simular aumento via callEnvido)
gameEnvidoTest.hand.envidoResponsePending = false;

// Jogador 2 (Pé - index 0) chama Falta Envido direto em resposta (Agora é permitido)
assert(gameEnvidoTest.callEnvido(0, "falta_envido") === true, "Deve ser permitido chamar Falta Envido diretamente em resposta a Envido.");

// Resetar o estado de envido pendente para continuar outros testes
gameEnvidoTest.hand.envidoHistory = ['envido'];
gameEnvidoTest.hand.envidoState = 'envido';
gameEnvidoTest.hand.envidoResponsePending = false;

// Jogador 2 (Pé - index 0) chama Real Envido em resposta (Ok)
assert(gameEnvidoTest.callEnvido(0, "real_envido") === true, "Pode aumentar de Envido para Real Envido.");

// 7. Novos testes para correção de regras de Envido e Retruco
console.log("\n=== Rodando Novos Testes de Regras (Envido e Retruco) ===");

const gameRulesTest = new TrucoGame("TEST_RULES", "1v1");
gameRulesTest.addPlayer("P1", "Jogador 1", "s1");
gameRulesTest.addPlayer("P2", "Jogador 2", "s2");
gameRulesTest.startNewHand();

// Garantir que nenhum jogador tenha Flor para permitir Envido
gameRulesTest.players[0].hasFlor = false;
gameRulesTest.players[1].hasFlor = false;

// Jogador 1 é o Mão (index 1), joga uma carta
assert(gameRulesTest.playCard(1, 0) === true, "Jogador 1 (Mão) joga sua primeira carta.");

// Jogador 2 (Pé - index 0) deve ser capaz de chamar Envido mesmo após Jogador 1 jogar carta
assert(gameRulesTest.callEnvido(0, "envido") === true, "Jogador 2 (Pé) pode chamar Envido após oponente jogar carta.");

// Resolver o Envido
gameRulesTest.hand.envidoResponsePending = false;
gameRulesTest.resolveEnvido();

// Jogador 2 joga sua carta para fechar a primeira rodada
assert(gameRulesTest.playCard(0, 0) === true, "Jogador 2 joga sua primeira carta.");

// Agora na segunda rodada, jogador 2 não pode mais chamar Envido (rodada > 0)
assert(gameRulesTest.callEnvido(0, "real_envido") === false, "Não é permitido chamar Envido na segunda rodada.");

// Teste de Retruco durante jogada normal (sem responder a Truco pendente)
const gameRetrucoTest = new TrucoGame("TEST_RETRUCO", "1v1");
gameRetrucoTest.addPlayer("P1", "Jogador 1", "s1");
gameRetrucoTest.addPlayer("P2", "Jogador 2", "s2");
gameRetrucoTest.startNewHand();

// Jogador 1 chama Truco (Ok)
assert(gameRetrucoTest.callTruco(1) === true, "Jogador 1 chama Truco.");
// Jogador 2 aceita Truco normal (Quero)
assert(gameRetrucoTest.respondTruco(0, "quero") === true, "Jogador 2 aceita o Truco.");

// Jogador 2 tenta chamar Retruco em seu turno normal
assert(gameRetrucoTest.callTruco(0) === true, "Jogador 2 pode chamar Retruco durante jogada normal.");

// Teste de chamar Envido quando Truco está pendente
const gameEnvidoPendingTruco = new TrucoGame("TEST_ENVIDO_PENDING_TRUCO", "1v1");
gameEnvidoPendingTruco.addPlayer("P1", "Jogador 1", "s1");
gameEnvidoPendingTruco.addPlayer("P2", "Jogador 2", "s2");
gameEnvidoPendingTruco.startNewHand();

gameEnvidoPendingTruco.players[0].hasFlor = false;
gameEnvidoPendingTruco.players[1].hasFlor = false;

// Jogador 1 (Mão - index 1) chama Truco (Ok)
assert(gameEnvidoPendingTruco.callTruco(1) === true, "Jogador 1 chama Truco.");
assert(gameEnvidoPendingTruco.hand.trucoResponsePending === true, "Truco fica pendente.");

// Jogador 2 (Pé - index 0) deve ser capaz de chamar Envido antes de aceitar o Truco
assert(gameEnvidoPendingTruco.callEnvido(0, "envido") === true, "Jogador 2 (Pé) pode chamar Envido com Truco pendente.");
assert(gameEnvidoPendingTruco.hand.envidoResponsePending === true, "Envido fica pendente.");

// Teste de Flor cancelando Envido e marcando como flor_sobre_envido
const gameFlorOverEnvido = new TrucoGame("TEST_FLOR_OVER_ENVIDO", "1v1");
gameFlorOverEnvido.addPlayer("P1", "Jogador 1", "s1");
gameFlorOverEnvido.addPlayer("P2", "Jogador 2", "s2");
gameFlorOverEnvido.startNewHand();

// Jogador 1 (Mão - index 1) chama Envido (Ok)
gameFlorOverEnvido.players[0].hasFlor = false;
gameFlorOverEnvido.players[1].hasFlor = false;
assert(gameFlorOverEnvido.callEnvido(1, "envido") === true, "Jogador 1 chama Envido.");

// Jogador 2 tem Flor
gameFlorOverEnvido.players[0].hasFlor = true;
gameFlorOverEnvido.players[0].florScore = 25;

// Jogador 2 (Pé - index 0) deve ser capaz de chamar Flor com Envido pendente
assert(gameFlorOverEnvido.callFlor(0) === true, "Jogador 2 pode chamar Flor com Envido pendente.");
assert(gameFlorOverEnvido.hand.envidoResponsePending === false, "Envido pendente foi cancelado.");
assert(gameFlorOverEnvido.hand.voiceBubble[0] === '¡FLOR_SOBRE_ENVIDO!', "Balão de voz configurado como flor_sobre_envido.");

// Teste de Admin definir cartas na mão do jogador
const gameAdminTest = new TrucoGame("TEST_ADMIN_SET_CARDS", "1v1");
gameAdminTest.addPlayer("P1", "Jogador 1", "s1");
gameAdminTest.addPlayer("P2", "Jogador 2", "s2");
gameAdminTest.startNewHand();

const targetCards = [
  { value: 1, suit: 'espadas' }, // Espadilha
  { value: 7, suit: 'espadas' }, // 7 de Espadas
  { value: 3, suit: 'copas' }    // 3 de Copas
];

assert(gameAdminTest.adminSetPlayerCards(0, targetCards) === true, "Admin define cartas do Jogador 2.");
assert(gameAdminTest.hand.hands[0][0].value === 1 && gameAdminTest.hand.hands[0][0].suit === 'espadas', "Carta 1 foi alterada para Espadilha.");
assert(gameAdminTest.hand.hands[0][1].value === 7 && gameAdminTest.hand.hands[0][1].suit === 'espadas', "Carta 2 foi alterada para 7 de Espadas.");
assert(gameAdminTest.hand.hands[0][2].value === 3 && gameAdminTest.hand.hands[0][2].suit === 'copas', "Carta 3 foi alterada para 3 de Copas.");
assert(gameAdminTest.players[0].envidoScore === 28, "Pontuação de Envido do Jogador 2 recalculada para 28.");

// Teste de desistir de Retruco ou Vale 4 dar pontos corretos
const gameTrucoDeclineTest = new TrucoGame("TEST_TRUCO_DECLINE", "1v1");
gameTrucoDeclineTest.addPlayer("P1", "Jogador 1", "s1"); // Team 0
gameTrucoDeclineTest.addPlayer("P2", "Jogador 2", "s2"); // Team 1
gameTrucoDeclineTest.startNewHand();

// Jogador 1 chama Truco
gameTrucoDeclineTest.callTruco(0);
// Jogador 2 aumenta para Retruco
gameTrucoDeclineTest.respondTruco(1, 'retruco');
// Jogador 1 recusa o Retruco (nao_quero)
gameTrucoDeclineTest.respondTruco(0, 'nao_quero');
// Deve dar 2 pontos para o Time 1
assert(gameTrucoDeclineTest.score[1] === 2, "Recusar Retruco deve conceder 2 pontos ao oponente.");

// Teste de ir ao baralho na primeira rodada dar 2 pontos
const gameMazoFirstRoundTest = new TrucoGame("TEST_MAZO_FIRST_ROUND", "1v1");
gameMazoFirstRoundTest.addPlayer("P1", "Jogador 1", "s1"); // Team 0
gameMazoFirstRoundTest.addPlayer("P2", "Jogador 2", "s2"); // Team 1
gameMazoFirstRoundTest.startNewHand();

// Jogador 1 vai ao mazo na primeira rodada
gameMazoFirstRoundTest.foldPlayer(0);
// Deve dar 2 pontos para o Time 1
assert(gameMazoFirstRoundTest.score[1] === 2, "Ir ao mazo na primeira rodada sem truco aceito deve conceder 2 pontos ao oponente.");

console.log("\n================================================");
console.log("🎉 TODOS OS TESTES PASSARAM COM SUCESSO! 🎉");
console.log("================================================");
