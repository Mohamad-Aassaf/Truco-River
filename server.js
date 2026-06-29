// server.js
// Servidor de WebSocket para o Truco Gaúcho Multiplayer

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { TrucoGame } = require('./gameEngine');
const bot = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mateusraeder'; // Senha de administrador de sua escolha

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));
app.use('/pixelDeck', express.static(path.join(__dirname, 'pixelDeck')));
app.use('/audio', express.static(path.join(__dirname, 'audio')));

// Banco de dados em memória para salas ativas
const activeGames = {};

// Função auxiliar para enviar o estado do jogo personalizado para cada jogador
function broadcastState(roomId) {
  const game = activeGames[roomId];
  if (!game) return;

  // Se o jogo terminou na mão anterior, checar transição
  if (game.state === 'hand_end') {
    // Dispara temporizador para iniciar nova mão após 5 segundos
    scheduleNextHand(roomId);
  }

  game.players.forEach((player, idx) => {
    if (!player.isBot && player.socketId) {
      const stateForPlayer = game.getGameStateForPlayer(idx);
      io.to(player.socketId).emit('game_state', stateForPlayer);
    }
  });
}

// Controla a transição automática de nova mão
const nextHandTimers = {};
function scheduleNextHand(roomId) {
  if (nextHandTimers[roomId]) return;

  nextHandTimers[roomId] = setTimeout(() => {
    delete nextHandTimers[roomId];
    const game = activeGames[roomId];
    if (game && game.state === 'hand_end') {
      game.startNewHand();
      broadcastState(roomId);
      runBotLogic(roomId);
    }
  }, 5000);
}

// Executa ações dos jogadores (humanos ou bots)
function executeGameAction(game, playerIdx, decision) {
  const { action, value } = decision;
  switch (action) {
    case 'play_card':
      game.playCard(playerIdx, value);
      break;
    case 'call_truco':
      game.callTruco(playerIdx);
      break;
    case 'truco_response':
      game.respondTruco(playerIdx, value);
      break;
    case 'truco_raise':
      if (game.hand && game.hand.trucoResponsePending) {
        game.respondTruco(playerIdx, value);
      } else {
        game.callTruco(playerIdx);
      }
      break;
    case 'call_envido':
      if (game.hand && game.hand.envidoResponsePending) {
        game.respondEnvido(playerIdx, value);
      } else {
        game.callEnvido(playerIdx, value);
      }
      break;
    case 'envido_response':
    case 'envido_raise':
      game.respondEnvido(playerIdx, value);
      break;
    case 'call_flor':
      game.callFlor(playerIdx);
      break;
    case 'flor_response':
    case 'flor_raise':
      game.respondFlor(playerIdx, value);
      break;
    case 'fold':
      game.foldPlayer(playerIdx);
      break;
    case 'admin_set_cards':
      game.adminSetPlayerCards(playerIdx, value);
      break;
  }
}

// Loop recursivo para gerenciar a vez dos Bots
function runBotLogic(roomId) {
  const game = activeGames[roomId];
  if (!game || game.state !== 'playing' || !game.hand) return;

  // Encontra se algum bot precisa agir
  let activeBotIdx = -1;

  if (game.hand.trucoResponsePending) {
    const pendingTeam = game.hand.trucoPendingTeam;
    // O bot que deve responder na equipe
    activeBotIdx = game.players.findIndex((p, idx) => p.isBot && p.team === pendingTeam && !game.hand.foldedPlayers.has(idx));
  } else if (game.hand.envidoResponsePending) {
    const pendingTeam = game.hand.envidoPendingTeam;
    activeBotIdx = game.players.findIndex((p, idx) => p.isBot && p.team === pendingTeam && !game.hand.foldedPlayers.has(idx));
  } else if (game.hand.florResponsePending) {
    const pendingTeam = game.hand.florPendingTeam;
    activeBotIdx = game.players.findIndex((p, idx) => p.isBot && p.team === pendingTeam && p.hasFlor && !game.hand.foldedPlayers.has(idx));
  } else {
    // Turno normal de carta
    const curr = game.hand.currentPlayer;
    if (game.players[curr] && game.players[curr].isBot) {
      activeBotIdx = curr;
    }
  }

  if (activeBotIdx !== -1) {
    // Simula tempo de pensamento
    setTimeout(() => {
      const g = activeGames[roomId];
      if (!g || g.state !== 'playing' || !g.hand) return;

      const decision = bot.handleBotAction(g, activeBotIdx);
      if (decision) {
        executeGameAction(g, activeBotIdx, decision);
        broadcastState(roomId);
        // Chama recursivamente para tratar outras ações em sequência (ex: outro bot jogar)
        runBotLogic(roomId);
      }
    }, 1500);
  }
}

// Eventos de conexão Socket.io
io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  let currentRoomId = null;

  // Validar senha de administrador
  socket.on('validate_admin', ({ password }) => {
    if (password === ADMIN_PASSWORD) {
      socket.isAdmin = true;
      socket.emit('admin_validated');
    } else {
      socket.emit('error_msg', 'Senha de administrador incorreta!');
    }
  });

  // Envia salas disponíveis ao conectar
  socket.emit('available_rooms', Object.keys(activeGames)
    .filter(id => !activeGames[id].isPrivate)
    .map(id => ({
      id,
      mode: activeGames[id].mode,
      playersCount: activeGames[id].players.length,
      maxPlayers: activeGames[id].maxPlayers
    })));

  // Criar Sala
  socket.on('create_room', ({ roomId, mode, playerName, maxPoints, isPrivate }) => {
    const cleanRoomId = roomId.trim().toUpperCase();
    if (activeGames[cleanRoomId]) {
      socket.emit('error_msg', 'Sala já existe com esse código.');
      return;
    }

    if (!cleanRoomId) {
      socket.emit('error_msg', 'Código de sala inválido.');
      return;
    }

    const points = parseInt(maxPoints) || 24;
    const game = new TrucoGame(cleanRoomId, mode, points);
    game.isPrivate = !!isPrivate;
    activeGames[cleanRoomId] = game;
    game.addPlayer(socket.id, playerName, socket.id);

    currentRoomId = cleanRoomId;
    socket.join(cleanRoomId);

    broadcastState(cleanRoomId);
    io.emit('available_rooms', Object.keys(activeGames)
      .filter(id => !activeGames[id].isPrivate)
      .map(id => ({
        id,
        mode: activeGames[id].mode,
        playersCount: activeGames[id].players.length,
        maxPlayers: activeGames[id].maxPlayers
      })));
  });

  // Entrar na Sala
  socket.on('join_room', ({ roomId, playerName }) => {
    const cleanRoomId = roomId.trim().toUpperCase();
    const game = activeGames[cleanRoomId];

    if (!game) {
      socket.emit('error_msg', 'Sala não encontrada.');
      return;
    }

    if (game.players.length >= game.maxPlayers) {
      socket.emit('error_msg', 'Sala cheia.');
      return;
    }

    game.addPlayer(socket.id, playerName, socket.id);
    currentRoomId = cleanRoomId;
    socket.join(cleanRoomId);

    broadcastState(cleanRoomId);
    io.emit('available_rooms', Object.keys(activeGames)
      .filter(id => !activeGames[id].isPrivate)
      .map(id => ({
        id,
        mode: activeGames[id].mode,
        playersCount: activeGames[id].players.length,
        maxPlayers: activeGames[id].maxPlayers
      })));
  });

  // Adicionar Bot
  socket.on('add_bot', () => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby') return;

    if (game.players.length < game.maxPlayers) {
      const botNum = game.players.filter(p => p.isBot).length + 1;
      game.addPlayer(`bot_${Date.now()}`, `Bot River ${botNum}`, null, true);
      broadcastState(currentRoomId);
    }
  });

  // Alterar status Pronto
  socket.on('toggle_ready', () => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby') return;

    const p = game.players.find(player => player.socketId === socket.id);
    if (p) {
      p.ready = !p.ready;

      // Se todos estiverem prontos e a sala estiver cheia, inicia o jogo
      const allReady = game.players.every(player => player.ready);
      if (allReady && game.players.length === game.maxPlayers) {
        game.startNewHand();
        runBotLogic(currentRoomId);
      }

      broadcastState(currentRoomId);
    }
  });

  // Ações de jogo enviadas do cliente
  socket.on('game_action', (decision) => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'playing' || !game.hand) return;

    const playerIdx = game.players.findIndex(p => p.socketId === socket.id);
    if (playerIdx === -1) return;

    // Proteger ação de administrador
    if (decision && decision.action === 'admin_set_cards' && !socket.isAdmin) {
      socket.emit('error_msg', 'Acesso negado: Você não é administrador.');
      return;
    }

    // Executa a jogada do humano
    executeGameAction(game, playerIdx, decision);
    broadcastState(currentRoomId);

    // Se o jogo continuar ativo, dispara a lógica de bots
    runBotLogic(currentRoomId);
  });

  // Atualizar configuração de voz do jogador
  socket.on('update_voice_config', (voiceConfig) => {
    const game = activeGames[currentRoomId];
    if (!game) return;
    const p = game.players.find(player => player.socketId === socket.id);
    if (p) {
      p.voiceConfig = voiceConfig;
      broadcastState(currentRoomId);
    }
  });

  // Enviar mensagem de chat no lobby
  socket.on('send_chat', (msg) => {
    const game = activeGames[currentRoomId];
    if (game && msg.trim()) {
      const player = game.players.find(p => p.socketId === socket.id);
      const name = player ? player.name : 'Jogador';
      io.to(currentRoomId).emit('receive_chat', {
        sender: name,
        senderId: socket.id,
        msg: msg.trim()
      });
    }
  });

  // Reiniciar jogo completo
  socket.on('restart_game', () => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'game_end') return;

    // Reinicia scores
    game.score[0] = 0;
    game.score[1] = 0;
    game.winner = null;
    game.lastHandSummary = null;
    game.dealerIndex = 0;

    // Volta para o lobby pronto para iniciar
    game.state = 'lobby';
    game.players.forEach(p => {
      p.ready = p.isBot; // bots sempre prontos
    });

    broadcastState(currentRoomId);
  });

  // Desconexão
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
    if (currentRoomId && activeGames[currentRoomId]) {
      const game = activeGames[currentRoomId];
      game.removePlayer(socket.id);

      // Se a sala ficar vazia de humanos, exclui a sala
      const humanCount = game.players.filter(p => !p.isBot).length;
      if (humanCount === 0) {
        delete activeGames[currentRoomId];
        console.log(`Sala ${currentRoomId} vazia deletada.`);
      } else {
        broadcastState(currentRoomId);
      }

      io.emit('available_rooms', Object.keys(activeGames)
        .filter(id => !activeGames[id].isPrivate)
        .map(id => ({
          id,
          mode: activeGames[id].mode,
          playersCount: activeGames[id].players.length,
          maxPlayers: activeGames[id].maxPlayers
        })));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor de Truco Gaúcho rodando na porta ${PORT}`);
});
