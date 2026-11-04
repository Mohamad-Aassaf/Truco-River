// server.js
// Servidor de WebSocket para o Truco Gaúcho Multiplayer

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { TrucoGame } = require('./gameEngine');
const bot = require('./bot');
const { createAccounts } = require('./accounts');
const { createSocial } = require('./social');
const { createNews } = require('./news');
const { createReports } = require('./reports');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Relatos podem trazer um print (já comprimido no navegador)
  maxHttpBufferSize: 2e6,
  // Comprime mensagens maiores que 1 KB (o estado da mesa encolhe bastante)
  perMessageDeflate: { threshold: 1024 },
  // Percebe mais rápido quem caiu (celular que perdeu sinal, aba fechada)
  pingInterval: 10000,
  pingTimeout: 8000
});

const PORT = process.env.PORT || 3000;
// Senha do painel admin: só pela variável de ambiente ADMIN_PASSWORD (o repositório
// é público, então a senha não fica no código). Sem a variável, o painel fica desligado.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));
app.use('/pixelDeck', express.static(path.join(__dirname, 'pixelDeck')));

// Banco de dados em memória para salas ativas
const activeGames = {};

// Contas e amigos
const accounts = createAccounts();

// Novidades (mesmo armazenamento das contas)
const news = createNews(accounts.store);

// Relatos de bugs e sugestões (só o admin vê)
const reports = createReports(accounts.store);
const reportAttempts = new Map(); // IP -> horários dos últimos envios

function adminSockets() {
  return [...io.sockets.sockets.values()].filter(s => s.isAdmin);
}

// Para o UptimeRobot: resposta mínima, só para manter o servidor acordado
app.get('/healthz', (req, res) => res.type('text').send('ok'));

// Diagnóstico: onde as contas estão sendo salvas (sem dados pessoais)
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    armazenamentoContas: accounts.store.kind,
    contasPersistentes: accounts.store.kind === 'postgres',
    contasCarregadas: accounts.isLoaded(),
    totalContas: accounts.count(),
    salasAtivas: Object.keys(activeGames).length
  });
});

// Sala em que um socket está jogando (ou null)
function roomOfSocket(socketId) {
  for (const roomId of Object.keys(activeGames)) {
    const game = activeGames[roomId];
    if (game.players.some(p => !p.isBot && p.socketId === socketId)) return { game, roomId };
  }
  return null;
}

const social = createSocial(io, accounts, roomOfSocket);

// Avisa os amigos de todos os humanos da sala que o status deles mudou
function touchRoomPresence(game) {
  game.players.forEach(p => { if (!p.isBot && p.socketId) social.presenceChanged(p.socketId); });
}

// Nome do jogador: quem tem conta joga com o nome da conta
function resolvePlayerName(socket, playerName) {
  const acc = socket.data.account;
  if (acc) return accounts.displayName(acc);
  const name = typeof playerName === 'string' ? playerName.trim().slice(0, 18) : '';
  return name || 'Jogador Anônimo';
}

function markAccount(game, socket) {
  const p = game.players.find(pl => pl.socketId === socket.id);
  if (p) {
    p.account = socket.data.account || null;
    p.clientId = socket.data.clientId || null;
  }
}

// Bots: nome mostra o nível
const BOT_LEVELS = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };
const botName = (num, difficulty) => `Bot River ${num} (${BOT_LEVELS[difficulty] || 'Médio'})`;

// Salas públicas para a lista do lobby
// Tem alguém de verdade (humano conectado) na sala?
function hasLiveHuman(game) {
  return game.players.some(p => !p.isBot && p.socketId && !p.disconnected && io.sockets.sockets.has(p.socketId));
}

function listRooms() {
  return Object.keys(activeGames)
    .filter(id => {
      const g = activeGames[id];
      return !g.isPrivate && g.state === 'lobby' && g.players.length < g.maxPlayers && hasLiveHuman(g);
    })
    .map(id => ({
      id,
      roomName: activeGames[id].roomName || id,
      mode: activeGames[id].mode,
      playersCount: activeGames[id].players.length,
      maxPlayers: activeGames[id].maxPlayers
    }));
}

// Faxina a cada 20s: sala sem humanos (só bots ou vazia) é apagada; humano cuja
// conexão sumiu sem aviso sai da sala (o lugar ainda espera os 30s da reconexão)
function sweepRooms() {
  let changed = false;
  Object.keys(activeGames).forEach(roomId => {
    const game = activeGames[roomId];
    game.players
      .filter(p => !p.isBot && !p.disconnected && (!p.socketId || !io.sockets.sockets.has(p.socketId)))
      .forEach(p => {
        if (p.socketId) removeFromRoom(roomId, p.socketId);
        changed = true;
      });
    const g = activeGames[roomId];
    if (g && !g.players.some(p => !p.isBot)) {
      deleteRoom(roomId);
      changed = true;
    }
  });
  if (changed) io.to('lobby').emit('available_rooms', listRooms());
}

function deleteRoom(roomId) {
  const game = activeGames[roomId];
  if (!game) return;
  game.players.forEach(p => { if (p.reconnectTimer) clearTimeout(p.reconnectTimer); });
  if (botTimers[roomId]) { clearTimeout(botTimers[roomId]); delete botTimers[roomId]; }
  if (nextHandTimers[roomId]) { clearTimeout(nextHandTimers[roomId]); delete nextHandTimers[roomId]; }
  if (game.turnTimer) clearTimeout(game.turnTimer);
  delete activeGames[roomId];
  console.log(`Sala ${roomId} sem jogadores de verdade apagada.`);
}

setInterval(sweepRooms, 20000).unref();

// Contador do lobby: jogadores online e partidas em andamento.
// Vai para quem está no lobby a cada 5s, só quando o número muda.
function onlineStats() {
  const playing = Object.values(activeGames).filter(g => (g.state === 'playing' || g.state === 'hand_end') && hasLiveHuman(g)).length;
  return { online: io.engine.clientsCount, playing };
}
let lastStatsKey = '';
setInterval(() => {
  const stats = onlineStats();
  const key = `${stats.online}:${stats.playing}`;
  if (key === lastStatsKey) return;
  lastStatsKey = key;
  io.to('lobby').emit('online_stats', stats);
}, 5000).unref();

// Identificador do navegador (guardado no localStorage do jogador) para voltar à partida
function cleanClientId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(id) ? id : null;
}

// Quem fecha a aba ou cai a conexão tem este tempo para voltar à mesma partida
const RECONNECT_MS = Number(process.env.RECONNECT_MS) || 30000;
const TEAM_NAME_MAX = 16;

// Tira um jogador da sala de vez (saiu, foi expulso ou não voltou a tempo)
// Quem é o dono da sala (marcado no jogador, não pela posição na lista)
function isHostSocket(game, socketId) {
  const h = game.host();
  return !!h && h.socketId === socketId;
}

function removeFromRoom(roomId, socketId) {
  const game = activeGames[roomId];
  if (!game) return;
  const leaving = game.players.find(p => p.socketId === socketId);
  if (!leaving) return;
  if (leaving.reconnectTimer) clearTimeout(leaving.reconnectTimer);

  // Quem abandona uma partida em andamento leva a derrota
  if (leaving.account && (game.state === 'playing' || game.state === 'hand_end')) {
    accounts.recordResult(leaving.account, false);
  }
  game.removePlayer(socketId);

  // Se a sala ficar sem humanos (vazia ou só bots), exclui a sala
  const humanCount = game.players.filter(p => !p.isBot).length;
  if (humanCount === 0) {
    deleteRoom(roomId);
  } else {
    broadcastState(roomId);
    runBotLogic(roomId);
  }
  io.to('lobby').emit('available_rooms', listRooms());
}

function generateUniqueRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (activeGames[code]);
  return code;
}

// Função auxiliar para enviar o estado do jogo personalizado para cada jogador
function broadcastState(roomId) {
  const game = activeGames[roomId];
  if (!game) return;

  // Fim de partida: registra vitórias/derrotas de quem tem conta
  if (game.state === 'game_end' && !game.statsRecorded) {
    game.statsRecorded = true;
    game.players.forEach(p => {
      if (p.account && !p.isBot) accounts.recordResult(p.account, p.team === game.winner);
    });
  }

  // Mudou a fase ou o número de jogadores: atualiza o status para os amigos
  const presenceKey = `${game.state === 'hand_end' ? 'playing' : game.state}:${game.players.length}`;
  if (game.presenceKey !== presenceKey) {
    game.presenceKey = presenceKey;
    touchRoomPresence(game);
    // Lista de salas do lobby também muda (entrou/saiu gente, começou a partida)
    if (!game.isPrivate) io.to('lobby').emit('available_rooms', listRooms());
  }

  // Envido/Flor aceito: os bots esperam todos lerem os pontos (botão OK)
  startRevealPause(game);

  // Se o jogo terminou na mão anterior, checar transição
  if (game.state === 'hand_end') {
    // Dispara temporizador para iniciar nova mão após 5 segundos
    scheduleNextHand(roomId);
  }

  // Tempo para quem precisa agir agora (15s; acabou, o servidor joga por ele)
  updateTurnTimer(roomId, game);
  const turn = game.turn ? { playerIdx: game.turn.idx, kind: game.turn.kind, endsIn: Math.max(0, game.turn.deadline - Date.now()), total: TURN_MS } : null;

  const nextHandIn = game.state === 'hand_end' && game.nextHandAt ? Math.max(0, game.nextHandAt - Date.now()) : null;
  const withLogs = (target, state) => {
    const since = target.logSentSeq || 0;
    const lastSeq = game.gameLogs.length ? game.gameLogs[game.gameLogs.length - 1].seq : 0;
    const resetLogs = since === 0 || since > lastSeq || (game.gameLogs.length > 0 && game.gameLogs[0].seq > since + 1);
    state.logs = resetLogs ? game.gameLogs : game.gameLogs.filter(l => l.seq > since);
    state.logsReset = resetLogs;
    target.logSentSeq = lastSeq;
    if (game.state === 'playing' || game.state === 'lobby') state.lastHandSummary = null;
    state.nextHandIn = nextHandIn;
    state.turn = turn;
    state.turnTimerOff = !!game.noTurnTimer;
    return state;
  };

  // Admin assistindo: vê todas as cartas, do ponto de vista do primeiro jogador
  if (game.spectators && game.spectators.size) {
    game.spectators.forEach((spec, sid) => {
      if (!io.sockets.sockets.has(sid)) { game.spectators.delete(sid); return; }
      const st = withLogs(spec, game.getGameStateForPlayer(0, true));
      st.spectating = true;
      io.to(sid).emit('game_state', st);
    });
  }

  game.players.forEach((player, idx) => {
    if (!player.isBot && player.socketId) {
      // Narrativa só com as linhas novas; resumo da mão só quando precisa
      const stateForPlayer = withLogs(player, game.getGameStateForPlayer(idx));
      io.to(player.socketId).emit('game_state', stateForPlayer);
    }
  });
}

// --- TEMPO DA JOGADA (15s) ---
const TURN_MS = Number(process.env.TURN_MS) || 20000;

// Quem precisa agir agora e o quê ('play', 'truco', 'envido', 'flor', 'sing')
function actorOf(game) {
  const h = game.hand;
  if (game.state !== 'playing' || !h) return null;
  if (h.florResponsePending) {
    const idx = game.players.findIndex((p, i) => p.team === h.florPendingTeam && p.hasFlor && !h.foldedPlayers.has(i));
    return idx === -1 ? null : { idx, kind: 'flor' };
  }
  if (h.envidoResponsePending) {
    const singer = game.pendingFlorSinger(h.envidoPendingTeam);
    if (singer !== -1) return { idx: singer, kind: 'sing' };
    return { idx: h.envidoResponderIdx, kind: 'envido' };
  }
  if (h.trucoResponsePending) return { idx: h.trucoResponderIdx, kind: 'truco' };
  return { idx: h.currentPlayer, kind: 'play' };
}

function updateTurnTimer(roomId, game) {
  // O admin desligou o tempo nesta partida
  if (game.noTurnTimer) {
    if (game.turnTimer) clearTimeout(game.turnTimer);
    game.turnTimer = null;
    game.turn = null;
    return;
  }
  const actor = actorOf(game);
  const p = actor && game.players[actor.idx];
  if (!p || p.isBot) {
    if (game.turnTimer) clearTimeout(game.turnTimer);
    game.turnTimer = null;
    game.turn = null;
    return;
  }
  const h = game.hand;
  const key = `${h.number}:${actor.idx}:${actor.kind}:${h.playedCards.length}:${h.trucoState}:${h.envidoHistory.length}:${h.florHistory.length}`;
  if (game.turn && game.turn.key === key) return;

  if (game.turnTimer) clearTimeout(game.turnTimer);
  // Enquanto todos leem os pontos do Envido/Flor o relógio não corre
  const extra = game.revealPause ? Math.max(0, game.revealPause.until - Date.now()) : 0;
  const deadline = Date.now() + TURN_MS + extra;
  game.turn = { key, idx: actor.idx, kind: actor.kind, deadline };
  game.turnTimer = setTimeout(() => turnTimeout(roomId, key), deadline - Date.now());
}

// Acabou o tempo: joga a carta mais alta (ou responde do jeito mais simples)
function turnTimeout(roomId, key) {
  const game = activeGames[roomId];
  if (!game || !game.turn || game.turn.key !== key || game.state !== 'playing') return;
  const { idx, kind } = game.turn;
  const p = game.players[idx];
  const h = game.hand;
  game.turnTimer = null;
  game.turn = null;

  let decision;
  if (kind === 'play') {
    const cards = h.hands[idx] || [];
    let best = 0;
    cards.forEach((c, i) => { if (c.trucoRank > cards[best].trucoRank) best = i; });
    decision = { action: 'play_card', value: best };
    game.log(`${p.name} demorou: a carta mais alta foi jogada automaticamente.`, p.team);
  } else if (kind === 'sing') {
    decision = { action: 'call_flor' };
    game.log(`${p.name} demorou: a Flor foi cantada automaticamente.`, p.team);
  } else if (kind === 'flor') {
    decision = { action: 'flor_response', value: 'quero' };
    game.log(`${p.name} demorou: aceitou a Flor automaticamente.`, p.team);
  } else if (kind === 'envido') {
    decision = { action: 'envido_response', value: 'nao_quero' };
    game.log(`${p.name} demorou: não quis o Envido.`, p.team);
  } else {
    decision = { action: 'truco_response', value: 'nao_quero' };
    game.log(`${p.name} demorou: não quis o Truco.`, p.team);
  }
  const before = gameSignature(game);
  executeGameAction(game, idx, decision);
  if (gameSignature(game) === before) botFallback(game, idx);
  broadcastState(roomId);
  runBotLogic(roomId);
}

// Pausa depois de cantar os pontos do Envido/Flor: o jogo só segue (bots) quando
// todos os humanos apertam OK, ou depois de REVEAL_MAX_MS
const REVEAL_MAX_MS = 15000;
function startRevealPause(game) {
  const reveal = game.hand && game.hand.reveal;
  if (!reveal || game.lastPausedRevealId === reveal.id) return;
  game.lastPausedRevealId = reveal.id;
  const pending = new Set(game.players.filter(p => !p.isBot && p.socketId).map(p => p.socketId));
  game.revealPause = pending.size ? { id: reveal.id, pending, until: Date.now() + REVEAL_MAX_MS } : null;
}

// true enquanto alguém ainda está lendo os pontos
function revealPaused(game) {
  const pause = game.revealPause;
  if (!pause) return false;
  if (pause.pending.size === 0 || Date.now() >= pause.until) {
    game.revealPause = null;
    return false;
  }
  return true;
}

// Controla a transição automática de nova mão
const nextHandTimers = {};
function scheduleNextHand(roomId) {
  if (nextHandTimers[roomId]) return;
  const ended = activeGames[roomId];
  // Com cartas para provar o envido/flor, a mesa fica um pouco mais
  const proofs = ended && ended.lastHandSummary && ended.lastHandSummary.proofCards;
  // Intervalo entre as mãos: 3s (um pouco mais quando há cartas do envido/flor para ver)
  const delay = proofs && proofs.length ? 4500 : 3000;
  if (ended) ended.nextHandAt = Date.now() + delay;

  nextHandTimers[roomId] = setTimeout(() => {
    delete nextHandTimers[roomId];
    const game = activeGames[roomId];
    if (game && game.state === 'hand_end') {
      game.nextHandAt = null;
      game.startNewHand();
      broadcastState(roomId);
      runBotLogic(roomId);
    }
  }, delay);
}

// Retrato do jogo para saber se uma ação mudou alguma coisa
function gameSignature(g) {
  const h = g.hand;
  return JSON.stringify([g.state, g.score, h && [h.playedCards.length, h.trucoState, h.trucoResponsePending,
    h.envidoHistory.length, h.envidoResponsePending, h.envidoState, h.florHistory.length, h.florResponsePending,
    h.foldedPlayers.size, h.currentPlayer]]);
}

// A decisão do bot não valeu (regra mudou ou estado inesperado): faz o mais simples
function botFallback(g, idx) {
  const h = g.hand;
  if (!h) return;
  console.warn(`Bot ${g.players[idx].name} tentou uma ação inválida; usando o plano B.`);
  const tries = [];
  if (h.florResponsePending) tries.push({ action: 'flor_response', value: 'quero' }, { action: 'flor_response', value: 'nao_quero' });
  if (h.envidoResponsePending) tries.push({ action: 'envido_response', value: 'quero' });
  if (h.trucoResponsePending) tries.push({ action: 'truco_response', value: 'quero' });
  if (h.currentPlayer === idx) tries.push({ action: 'play_card', value: 0 });
  for (const t of tries) {
    const before = gameSignature(g);
    executeGameAction(g, idx, t);
    if (gameSignature(g) !== before) return;
  }
}

// Executa ações dos jogadores (humanos ou bots)
function executeGameAction(game, playerIdx, decision) {
  const { action, value } = decision;

  // Envido/Flor pendente tem prioridade: ninguém responde ou aumenta o Truco antes
  const betPending = game.hand && (game.hand.envidoResponsePending || game.hand.florResponsePending);
  if (betPending && ['call_truco', 'truco_response', 'truco_raise', 'play_card'].includes(action)) {
    return;
  }

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
// Um único timer por sala: se um humano agir enquanto o bot "pensa", o timer
// é reiniciado em vez de criar um segundo (que faria o bot agir duas vezes seguidas).
const botTimers = {};
function runBotLogic(roomId) {
  if (botTimers[roomId]) {
    clearTimeout(botTimers[roomId]);
    delete botTimers[roomId];
  }

  const game = activeGames[roomId];
  if (!game || game.state !== 'playing' || !game.hand) return;

  // Alguém ainda está lendo os pontos do Envido/Flor: tenta de novo quando acabar o prazo
  if (revealPaused(game)) {
    botTimers[roomId] = setTimeout(() => {
      delete botTimers[roomId];
      runBotLogic(roomId);
    }, Math.max(50, game.revealPause.until - Date.now()));
    return;
  }

  // Encontra se algum bot precisa agir
  let activeBotIdx = -1;

  // Ordem de prioridade: Flor > Envido > Truco (Envido/Flor precisam ser respondidos antes do Truco)
  if (game.hand.florResponsePending) {
    const pendingTeam = game.hand.florPendingTeam;
    activeBotIdx = game.players.findIndex((p, idx) => p.isBot && p.team === pendingTeam && p.hasFlor && !game.hand.foldedPlayers.has(idx));
  } else if (game.hand.envidoResponsePending) {
    // Quem tem Flor no time canta antes da resposta; senão responde o próximo de quem cantou
    const florSinger = game.pendingFlorSinger(game.hand.envidoPendingTeam);
    const r = florSinger !== -1 ? florSinger : game.hand.envidoResponderIdx;
    if (game.players[r] && game.players[r].isBot) activeBotIdx = r;
  } else if (game.hand.trucoResponsePending) {
    const r = game.hand.trucoResponderIdx;
    if (game.players[r] && game.players[r].isBot) activeBotIdx = r;
  } else {
    // Turno normal de carta
    const curr = game.hand.currentPlayer;
    if (game.players[curr] && game.players[curr].isBot) {
      activeBotIdx = curr;
    }
  }

  if (activeBotIdx !== -1) {
    // Simula tempo de pensamento: responder aposta demora um pouco mais que jogar carta
    const h = game.hand;
    const botDelay = (h.trucoResponsePending || h.envidoResponsePending || h.florResponsePending) ? 1300 : 900;
    botTimers[roomId] = setTimeout(() => {
      delete botTimers[roomId];
      const g = activeGames[roomId];
      if (!g || g.state !== 'playing' || !g.hand) return;
      if (revealPaused(g)) return runBotLogic(roomId);

      const decision = bot.handleBotAction(g, activeBotIdx);
      if (decision) {
        const before = gameSignature(g);
        executeGameAction(g, activeBotIdx, decision);
        if (gameSignature(g) === before) botFallback(g, activeBotIdx);
        broadcastState(roomId);
        // Chama recursivamente para tratar outras ações em sequência (ex: outro bot jogar)
        runBotLogic(roomId);
      }
    }, botDelay);
  }
}

// Eventos de conexão Socket.io
io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  let currentRoomId = null;
  socket.join('lobby');

  social.attach(socket);

  // Novidades: manda a lista ao conectar
  news.ready.then(() => socket.emit('news', news.list()));

  // Admin cria/edita (com id) ou apaga notícias; muda na hora para todos
  socket.on('news:save', (data, cb) => {
    const reply = res => { if (typeof cb === 'function') cb(res); };
    if (!socket.isAdmin) return reply({ error: 'Só o admin pode mexer nas novidades.' });
    const res = news.save(data);
    if (res.ok) io.emit('news', news.list());
    reply(res);
  });

  socket.on('news:delete', (data, cb) => {
    const reply = res => { if (typeof cb === 'function') cb(res); };
    if (!socket.isAdmin) return reply({ error: 'Só o admin pode mexer nas novidades.' });
    const res = news.remove(data && data.id);
    if (res.ok) io.emit('news', news.list());
    reply(res);
  });

  // Admin: partidas abertas e em andamento
  socket.on('admin:games', (data, cb) => {
    if (typeof cb !== 'function') return;
    if (!socket.isAdmin) return cb({ error: 'Só o admin pode ver as partidas.' });
    cb({
      ok: true,
      games: Object.keys(activeGames).map(id => {
        const g = activeGames[id];
        return {
          id,
          roomName: g.roomName || id,
          mode: g.mode,
          state: g.state,
          isPrivate: !!g.isPrivate,
          score: g.score,
          limit: g.maxPoints || 24,
          players: g.players.map(pl => ({ name: pl.name, team: pl.team, isBot: pl.isBot, disconnected: !!pl.disconnected })),
          spectators: g.spectators ? g.spectators.size : 0
        };
      })
    });
  });

  // Admin: assistir uma partida (vê todas as cartas, não joga)
  socket.on('admin:spectate', (data, cb) => {
    const reply = res => { if (typeof cb === 'function') cb(res); };
    if (!socket.isAdmin) return reply({ error: 'Só o admin pode assistir.' });
    const game = activeGames[data && data.roomId];
    if (!game) return reply({ error: 'Essa partida não existe mais.' });
    if (roomOfSocket(socket.id)) return reply({ error: 'Saia da sua sala antes de assistir.' });
    Object.values(activeGames).forEach(g => g.spectators && g.spectators.delete(socket.id));
    if (!game.spectators) game.spectators = new Map();
    game.spectators.set(socket.id, { logSentSeq: 0 });
    socket.data.spectating = data.roomId;
    socket.leave('lobby');
    reply({ ok: true });
    broadcastState(data.roomId);
  });

  socket.on('admin:unspectate', (data, cb) => {
    Object.values(activeGames).forEach(g => g.spectators && g.spectators.delete(socket.id));
    socket.data.spectating = null;
    socket.join('lobby');
    if (typeof cb === 'function') cb({ ok: true });
  });

  // Jogador envia um bug ou sugestão (com print opcional)
  socket.on('report:send', async (data, cb) => {
    const reply = res => { if (typeof cb === 'function') cb(res); };
    const fwd = socket.handshake.headers['x-forwarded-for'];
    const ip = (fwd ? String(fwd).split(',')[0] : socket.handshake.address || '').trim();
    const now = Date.now();
    const recent = (reportAttempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
    if (recent.length >= 5) return reply({ error: 'Você já enviou vários relatos agora. Tente de novo em alguns minutos.' });

    await reports.ready;
    const acc = socket.data.account;
    const typedName = data && typeof data.name === 'string' ? data.name.trim().slice(0, 18) : '';
    const author = {
      name: acc ? accounts.displayName(acc) : (typedName || 'Convidado'),
      account: acc ? accounts.displayName(acc) : null
    };
    const res = reports.add(data, author);
    if (res.error) return reply(res);

    recent.push(now);
    reportAttempts.set(ip, recent);
    adminSockets().forEach(s => s.emit('reports:new', { item: res.item, open: reports.openCount() }));
    reply({ ok: true });
  });

  // Admin: ver, abrir imagem, marcar resolvido e apagar relatos
  const adminOnly = handler => (data, cb) => {
    const reply = res => { if (typeof cb === 'function') cb(res); };
    if (!socket.isAdmin) return reply({ error: 'Só o admin pode ver os relatos.' });
    reports.ready.then(() => reply(handler(data || {})));
  };
  socket.on('reports:list', adminOnly(() => ({ ok: true, items: reports.list(), open: reports.openCount() })));
  socket.on('reports:image', adminOnly(d => reports.image(d.id)));
  socket.on('reports:status', adminOnly(d => reports.setStatus(d.id, d.status)));
  socket.on('reports:delete', adminOnly(d => reports.remove(d.id)));

  // Validar senha de administrador
  // Senha do admin (com limite de tentativas por conexão)
  socket.on('validate_admin', (data, cb) => {
    const password = data && typeof data.password === 'string' ? data.password : '';
    socket.data.adminTries = (socket.data.adminTries || 0) + 1;
    if (socket.data.adminTries > 8) {
      if (typeof cb === 'function') return cb({ error: 'Muitas tentativas. Recarregue a página para tentar de novo.' });
      return;
    }
    const ok = !!ADMIN_PASSWORD && password === ADMIN_PASSWORD;
    if (ok) socket.isAdmin = true;
    if (typeof cb === 'function') return cb(ok ? { ok: true } : { error: 'Senha incorreta.' });
    if (ok) socket.emit('admin_validated');
    else socket.emit('error_msg', 'Senha de administrador incorreta!');
  });

  // Envia salas disponíveis ao conectar
  socket.emit('available_rooms', listRooms());
  socket.emit('online_stats', onlineStats());

  // Criar Sala
  socket.on('create_room', ({ roomName, mode, playerName, maxPoints, isPrivate, clientId }) => {
    if (roomOfSocket(socket.id)) return; // já está numa sala
    socket.data.clientId = cleanClientId(clientId);
    const roomId = generateUniqueRoomId();
    playerName = resolvePlayerName(socket, playerName);

    let finalRoomName = typeof roomName === 'string' ? roomName.trim().slice(0, 20) : '';
    if (!finalRoomName) {
      finalRoomName = `Sala de ${playerName}`;
    }

    const points = parseInt(maxPoints) || 24;
    const game = new TrucoGame(roomId, mode, points);
    game.roomName = finalRoomName;
    game.isPrivate = !!isPrivate;
    activeGames[roomId] = game;
    game.addPlayer(socket.id, playerName, socket.id);
    game.players[game.players.length - 1].isHost = true;
    markAccount(game, socket);

    currentRoomId = roomId;
    socket.join(roomId);
    socket.leave('lobby');

    broadcastState(roomId);
    io.to('lobby').emit('available_rooms', listRooms());
  });

  // Entrar na Sala
  socket.on('join_room', ({ roomId, playerName, clientId }) => {
    if (typeof roomId !== 'string') return;
    if (roomOfSocket(socket.id)) return; // já está numa sala
    socket.data.clientId = cleanClientId(clientId);
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

    if (game.state !== 'lobby') {
      socket.emit('error_msg', 'Essa partida já começou.');
      return;
    }

    game.addPlayer(socket.id, resolvePlayerName(socket, playerName), socket.id);
    markAccount(game, socket);
    currentRoomId = cleanRoomId;
    socket.join(cleanRoomId);
    socket.leave('lobby');

    broadcastState(cleanRoomId);
    io.to('lobby').emit('available_rooms', listRooms());
  });

  // Adicionar Bot
  // Adicionar bot: entra direto como Médio; a dificuldade muda ao lado do nome dele
  socket.on('add_bot', (data) => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby') return;

    const difficulty = BOT_LEVELS[data && data.difficulty] ? data.difficulty : 'medium';

    if (game.players.length < game.maxPlayers) {
      // Número livre (Bot River 1, 2, 3...) mesmo depois de remover algum
      const used = new Set(game.players.filter(p => p.isBot).map(p => p.botNumber));
      let botNum = 1;
      while (used.has(botNum)) botNum++;
      game.addPlayer(`bot_${Date.now()}_${botNum}`, botName(botNum, difficulty), null, true, difficulty);
      game.players[game.players.length - 1].botNumber = botNum;
      broadcastState(currentRoomId);
    }
  });

  // Mudar a dificuldade de um bot (só o dono da sala, antes de começar)
  socket.on('set_bot_difficulty', (data) => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby' || !data || !BOT_LEVELS[data.difficulty]) return;
    const isHost = isHostSocket(game, socket.id);
    if (!isHost) return;
    const bot = game.players.find(p => p.isBot && p.id === data.playerId);
    if (!bot) return;
    bot.difficulty = data.difficulty;
    bot.name = botName(bot.botNumber || 1, data.difficulty);
    broadcastState(currentRoomId);
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

  // Trocar de time no lobby (duplas).
  // Cada um pode mudar a si mesmo; o dono da sala pode mudar qualquer um.
  // Se o outro time estiver cheio, troca de lugar com alguém de lá
  // (swapWithId, ou quem está na mesma posição).
  socket.on('switch_team', (data) => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby') return;
    const isHost = isHostSocket(game, socket.id);
    const me = game.players.find(pl => pl.socketId === socket.id);
    const target = data && data.targetId ? game.players.find(pl => pl.id === data.targetId) : me;
    if (!target || !me) return;
    if (target !== me && !isHost) return;

    const to = typeof (data && data.toTeam) === 'number' ? data.toTeam : (target.team === 0 ? 1 : 0);
    if (to !== 0 && to !== 1 || to === target.team) return;
    const perTeam = game.maxPlayers / 2;
    const others = game.players.filter(pl => pl.team === to);

    if (others.length < perTeam) {
      target.team = to;
    } else {
      // Time cheio: troca de lugar
      const mine = game.players.filter(pl => pl.team === target.team);
      let partner = data && data.swapWithId ? others.find(pl => pl.id === data.swapWithId) : null;
      if (!partner) {
        // Mesma posição do outro lado; se for quem está clicando (o dono), pega o outro
        const pool = others.length > 1 ? others.filter(pl => pl !== me) : others;
        partner = pool[Math.min(mine.indexOf(target), pool.length - 1)];
      }
      // Sem ser o dono, só dá para trocar com um bot
      if (!isHost && !partner.isBot) {
        socket.emit('error_msg', 'Esse time está cheio. Use o botão de troca ao lado do nome de alguém do outro time para pedir para trocar de lugar.');
        return;
      }
      partner.team = target.team;
      target.team = to;
      // Mantém a posição: quem troca fica no lugar do outro
      const a = game.players.indexOf(target);
      const b = game.players.indexOf(partner);
      [game.players[a], game.players[b]] = [game.players[b], game.players[a]];
    }
    broadcastState(currentRoomId);
  });

  // Admin liga/desliga o tempo de jogada só na partida em que está jogando
  socket.on('admin:turn_timer', (data, cb) => {
    const reply = r => { if (typeof cb === 'function') cb(r); };
    if (!socket.isAdmin) return reply({ error: 'Só o admin pode mudar o tempo de jogada.' });
    const game = activeGames[currentRoomId];
    const me = game && game.players.find(pl => pl.socketId === socket.id);
    if (!me) return reply({ error: 'Entre numa sala para mudar o tempo de jogada dela.' });
    game.noTurnTimer = !!(data && data.off);
    game.log(game.noTurnTimer ? 'O tempo de jogada foi desligado nesta partida.' : 'O tempo de jogada foi ligado de novo nesta partida.');
    broadcastState(currentRoomId);
    reply({ ok: true, off: game.noTurnTimer });
  });

  // Nome do time: só quem é do time muda, e só na sala de espera
  socket.on('set_team_name', (data, cb) => {
    const reply = r => { if (typeof cb === 'function') cb(r); };
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby') return reply({ error: 'O nome do time só muda na sala de espera.' });
    const me = game.players.find(pl => pl.socketId === socket.id);
    if (!me) return reply({ error: 'Você não está nesta sala.' });
    const raw = data && typeof data.name === 'string' ? data.name : '';
    const name = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, TEAM_NAME_MAX);
    game.teamNames[me.team] = name || null;
    broadcastState(currentRoomId);
    reply({ ok: true, name: game.teamNames[me.team] });
  });

  // Pedir para trocar de lugar com alguém do outro time (a pessoa aceita ou recusa)
  socket.on('swap_request', (data, cb) => {
    const reply = r => { if (typeof cb === 'function') cb(r); };
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby' || game.mode !== '2v2') return reply({ error: 'Só dá para trocar de lugar na sala de espera das duplas.' });
    const me = game.players.find(pl => pl.socketId === socket.id);
    const target = data && game.players.find(pl => pl.id === data.targetId);
    if (!me || !target || target === me || target.isBot || target.team === me.team) return reply({ error: 'Não dá para pedir troca com esse jogador.' });
    game.swapRequests = game.swapRequests || new Map();
    const prev = game.swapRequests.get(me.id);
    if (prev && prev.to === target.id && Date.now() - prev.at < 15000) return reply({ error: `Espere ${target.name} responder.` });
    game.swapRequests.set(me.id, { to: target.id, at: Date.now() });
    io.to(target.socketId).emit('swap_request', { fromId: me.id, fromName: me.name });
    reply({ ok: true, name: target.name });
  });

  socket.on('swap_answer', (data) => {
    const game = activeGames[currentRoomId];
    if (!game || !game.swapRequests || !data) return;
    const me = game.players.find(pl => pl.socketId === socket.id);
    const from = game.players.find(pl => pl.id === data.fromId);
    const req = game.swapRequests.get(data.fromId);
    if (!me || !from || !req || req.to !== me.id || Date.now() - req.at > 60000) return;
    game.swapRequests.delete(data.fromId);
    if (!data.accept) {
      io.to(from.socketId).emit('swap_result', { ok: false, name: me.name });
      return;
    }
    if (game.state !== 'lobby' || from.team === me.team) return;
    [from.team, me.team] = [me.team, from.team];
    const a = game.players.indexOf(from);
    const b = game.players.indexOf(me);
    [game.players[a], game.players[b]] = [game.players[b], game.players[a]];
    io.to(from.socketId).emit('swap_result', { ok: true, name: me.name });
    broadcastState(currentRoomId);
  });

  // Dono da sala sorteia os times
  socket.on('shuffle_teams', () => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby' || game.mode !== '2v2') return;
    if (!(isHostSocket(game, socket.id))) return;
    const order = game.players.map((_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((pi, k) => { game.players[pi].team = k % 2; });
    broadcastState(currentRoomId);
  });

  // Expulsar bot ou jogador
  socket.on('kick_player', ({ playerId }) => {
    const game = activeGames[currentRoomId];
    if (!game || game.state !== 'lobby') return;

    const senderIsHost = isHostSocket(game, socket.id);
    if (!senderIsHost) return;

    const targetIdx = game.players.findIndex(p => p.id === playerId);
    if (targetIdx === -1 || game.players[targetIdx] === game.host()) return;

    const targetPlayer = game.players[targetIdx];
    if (targetPlayer.isBot) {
      game.players.splice(targetIdx, 1);
      game.log(`${targetPlayer.name} foi removido pelo criador da sala.`);
    } else {
      const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
      if (targetSocket) {
        targetSocket.emit('kicked');
        targetSocket.leave(currentRoomId);
        targetSocket.join('lobby');
        targetSocket.emit('available_rooms', listRooms());
      }
      game.players.splice(targetIdx, 1);
      game.log(`${targetPlayer.name} foi expulso da sala.`);
      social.presenceChanged(targetPlayer.socketId);
    }

    broadcastState(currentRoomId);
    io.to('lobby').emit('available_rooms', listRooms());
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

  // Enviar mensagem de chat no lobby
  // Jogador apertou OK na janela dos pontos do Envido/Flor
  socket.on('reveal_ack', (data) => {
    const game = activeGames[currentRoomId];
    const pause = game && game.revealPause;
    if (!pause || !data || data.id !== pause.id) return;
    pause.pending.delete(socket.id);
    if (pause.pending.size === 0) {
      game.revealPause = null;
      runBotLogic(currentRoomId);
    }
  });

  socket.on('send_chat', (msg) => {
    const game = activeGames[currentRoomId];
    if (typeof msg !== 'string') return;
    msg = msg.trim().slice(0, 120);
    if (game && msg) {
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
    game.statsRecorded = false;
    game.lastHandSummary = null;
    game.dealerIndex = 0;
    game.hand = null;
    game.handNumber = 0;
    game.gameStartedAt = null;
    game.finalBlow = null;
    if (game.turnTimer) clearTimeout(game.turnTimer);
    game.turn = null;

    // Volta para o lobby pronto para iniciar
    game.state = 'lobby';
    game.players.forEach(p => {
      p.ready = p.isBot; // bots sempre prontos
    });

    broadcastState(currentRoomId);
  });

  // Sair da sala de propósito (botão Abandonar): sai na hora, sem esperar
  socket.on('leave_room', (data, cb) => {
    if (currentRoomId) removeFromRoom(currentRoomId, socket.id);
    currentRoomId = null;
    if (typeof cb === 'function') cb({ ok: true });
  });

  // Voltar para a partida depois de fechar a aba ou cair a conexão
  socket.on('rejoin', (data, cb) => {
    const reply = res => { if (typeof cb === 'function') cb(res); };
    const clientId = cleanClientId(data && data.clientId);
    if (!clientId || roomOfSocket(socket.id)) return reply({ ok: false });

    for (const roomId of Object.keys(activeGames)) {
      const game = activeGames[roomId];
      // Mesmo navegador: volta para o lugar. Se a conexão antiga ainda parecer
      // viva (o servidor ainda não percebeu a queda), ela é encerrada.
      const p = game.players.find(pl => !pl.isBot && pl.clientId === clientId && pl.socketId !== socket.id);
      if (!p) continue;

      // O lugar passa para a conexão nova ANTES de derrubar a antiga: assim a
      // queda da antiga não marca o jogador como "caiu" de novo
      const oldSocketId = p.socketId;
      p.socketId = socket.id;
      p.id = socket.id;
      const oldSocket = oldSocketId && io.sockets.sockets.get(oldSocketId);
      if (oldSocket) oldSocket.disconnect(true);
      clearTimeout(p.reconnectTimer);
      p.reconnectTimer = null;
      p.disconnected = false;
      p.reconnectUntil = null;
      p.logSentSeq = 0;
      if (game.revealPause && game.revealPause.pending.delete(oldSocketId)) game.revealPause.pending.add(socket.id);

      socket.data.clientId = clientId;
      currentRoomId = roomId;
      socket.join(roomId);
      socket.leave('lobby');
      if (game.state !== 'lobby') game.log(`${p.name} voltou para a partida.`, p.team);
      console.log(`${p.name} voltou para a sala ${roomId}`);

      broadcastState(roomId);
      runBotLogic(roomId);
      return reply({ ok: true, roomId });
    }
    reply({ ok: false });
  });

  // Desconexão: o lugar fica guardado por RECONNECT_MS para o jogador voltar
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
    Object.values(activeGames).forEach(g => g.spectators && g.spectators.delete(socket.id));
    const roomId = currentRoomId;
    const game = roomId && activeGames[roomId];
    if (!game) return;
    const p = game.players.find(pl => pl.socketId === socket.id);
    if (!p) return;

    if (!p.clientId) {
      removeFromRoom(roomId, socket.id);
      return;
    }

    if (p.disconnected) return;
    p.disconnected = true;
    p.reconnectUntil = Date.now() + RECONNECT_MS;
    if (!game.isPrivate) io.to('lobby').emit('available_rooms', listRooms());
    game.log(`${p.name} caiu. Esperando ${RECONNECT_MS / 1000}s para voltar...`, p.team);
    clearTimeout(p.reconnectTimer);
    p.reconnectTimer = setTimeout(() => {
      p.reconnectTimer = null;
      if (p.disconnected && activeGames[roomId] && !io.sockets.sockets.has(p.socketId)) removeFromRoom(roomId, p.socketId);
    }, RECONNECT_MS);
    broadcastState(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor de Truco Gaúcho rodando na porta ${PORT}`);
});
