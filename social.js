// social.js
// Eventos de socket de conta (entrar, criar conta, sair) e de amigos
// (pedidos, lista com status online, convites para a sala).

function createSocial(io, accounts, roomOfSocket) {
  // usuário (chave) -> Set de socket ids conectados
  const online = new Map();
  // Limite de tentativas de login/cadastro por IP
  const attempts = new Map();
  // Último convite enviado: "de>para" -> horário
  const lastInvite = new Map();

  const ipOf = socket => {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    return (fwd ? String(fwd).split(',')[0] : socket.handshake.address || '').trim();
  };

  function throttled(socket) {
    const ip = ipOf(socket);
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter(t => now - t < 5 * 60 * 1000);
    attempts.set(ip, list);
    return list.length >= 12;
  }

  function countAttempt(socket) {
    const ip = ipOf(socket);
    const list = attempts.get(ip) || [];
    list.push(Date.now());
    attempts.set(ip, list);
  }

  function statusOf(k) {
    const sockets = online.get(k);
    if (!sockets || sockets.size === 0) return { online: false, status: 'offline' };
    for (const sid of sockets) {
      const room = roomOfSocket(sid);
      if (!room) continue;
      const { game, roomId } = room;
      const status = game.state === 'lobby' ? 'waiting' : (game.state === 'game_end' ? 'finished' : 'playing');
      return {
        online: true,
        status,
        roomId,
        roomName: game.roomName || roomId,
        mode: game.mode,
        players: game.players.length,
        maxPlayers: game.maxPlayers,
        joinable: status === 'waiting' && game.players.length < game.maxPlayers
      };
    }
    return { online: true, status: 'lobby' };
  }

  function buildState(k) {
    const u = accounts.get(k);
    if (!u) return null;
    const order = { waiting: 0, lobby: 1, playing: 2, finished: 2, offline: 3 };
    const friends = u.friends
      .map(fk => ({ username: accounts.displayName(fk), ...statusOf(fk) }))
      .sort((a, b) => (order[a.status] - order[b.status]) || a.username.localeCompare(b.username));
    return {
      user: accounts.publicUser(u),
      friends,
      requestsIn: u.requestsIn.map(accounts.displayName),
      requestsOut: u.requestsOut.map(accounts.displayName)
    };
  }

  function pushState(k) {
    const sockets = online.get(k);
    if (!sockets || sockets.size === 0) return;
    const state = buildState(k);
    if (!state) return;
    sockets.forEach(sid => io.to(sid).emit('social:state', state));
  }

  // Avisa os amigos online de que o status de k mudou
  function notifyFriendsOf(k) {
    const u = accounts.get(k);
    if (!u) return;
    u.friends.forEach(fk => { if (online.has(fk)) pushState(fk); });
  }

  function setAccount(socket, user) {
    const prev = socket.data.account;
    if (prev) {
      const set = online.get(prev);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) online.delete(prev);
      }
      notifyFriendsOf(prev);
    }
    socket.data.account = user ? accounts.key(user.username) : null;
    if (socket.data.account) {
      const k = socket.data.account;
      if (!online.has(k)) online.set(k, new Set());
      online.get(k).add(socket.id);
      pushState(k);
      notifyFriendsOf(k);
    }
  }

  const reply = (cb, data) => { if (typeof cb === 'function') cb(data); };

  // Erros nunca derrubam o servidor: viram uma resposta de erro
  const safe = fn => async (data, cb) => {
    try {
      await fn(data, cb);
    } catch (err) {
      console.error('Erro em evento de conta:', err);
      reply(cb, { error: 'Erro no servidor. Tente de novo.' });
    }
  };

  function attach(socket) {
    socket.data.account = null;

    socket.on('auth:register', safe(async (data, cb) => {
      if (throttled(socket)) return reply(cb, { error: 'Muitas tentativas. Espere alguns minutos.' });
      countAttempt(socket);
      const res = await accounts.register(data && data.username, data && data.password);
      if (res.error) return reply(cb, res);
      setAccount(socket, res.user);
      reply(cb, res);
    }));

    socket.on('auth:login', safe(async (data, cb) => {
      if (throttled(socket)) return reply(cb, { error: 'Muitas tentativas. Espere alguns minutos.' });
      const res = await accounts.login(data && data.username, data && data.password);
      if (res.error) {
        countAttempt(socket);
        return reply(cb, res);
      }
      setAccount(socket, res.user);
      reply(cb, res);
    }));

    socket.on('auth:resume', safe(async (data, cb) => {
      const res = await accounts.resume(data && data.token);
      if (res.error) return reply(cb, res);
      setAccount(socket, res.user);
      reply(cb, res);
    }));

    socket.on('auth:logout', safe(async (data, cb) => {
      await accounts.logout(data && data.token);
      setAccount(socket, null);
      reply(cb, { ok: true });
    }));

    // Ações de amizade: todas exigem estar logado
    const friendAction = (event, fn) => {
      socket.on(event, safe((data, cb) => {
        const me = socket.data.account;
        if (!me) return reply(cb, { error: 'Entre na sua conta para usar os amigos.' });
        const other = data && typeof data.username === 'string' ? data.username.trim() : '';
        if (!other) return reply(cb, { error: 'Informe o usuário.' });
        const res = fn(me, other, data);
        (res.affected || []).forEach(pushState);
        reply(cb, { ok: !!res.ok, error: res.error, message: res.message });
      }));
    };

    friendAction('friends:request', (me, other) => accounts.sendRequest(me, other));
    friendAction('friends:respond', (me, other, data) => accounts.respondRequest(me, other, !!data.accept));
    friendAction('friends:cancel', (me, other) => accounts.cancelRequest(me, other));
    friendAction('friends:remove', (me, other) => accounts.removeFriend(me, other));

    friendAction('friends:invite', (me, other) => {
      if (!accounts.areFriends(me, other)) return { error: 'Vocês ainda não são amigos.' };
      const room = roomOfSocket(socket.id);
      if (!room || room.game.state !== 'lobby') return { error: 'Entre numa sala de espera para convidar.' };
      if (room.game.players.length >= room.game.maxPlayers) return { error: 'Sua sala já está cheia.' };
      const ko = accounts.key(other);
      const sockets = online.get(ko);
      if (!sockets || sockets.size === 0) return { error: `${accounts.displayName(ko)} está offline.` };
      if (statusOf(ko).status === 'playing') return { error: `${accounts.displayName(ko)} está no meio de uma partida.` };

      const pair = `${me}>${ko}`;
      if (Date.now() - (lastInvite.get(pair) || 0) < 10000) return { error: 'Espere um pouco antes de convidar de novo.' };
      lastInvite.set(pair, Date.now());

      const invite = {
        from: accounts.displayName(me),
        roomId: room.roomId,
        roomName: room.game.roomName || room.roomId,
        mode: room.game.mode
      };
      sockets.forEach(sid => io.to(sid).emit('social:invited', invite));
      return { ok: true, message: `Convite enviado para ${accounts.displayName(ko)}.` };
    });

    socket.on('disconnect', () => setAccount(socket, null));
  }

  // Chamado pelo servidor quando o jogador entra/sai de sala ou o jogo muda de fase
  function presenceChanged(socketId) {
    const s = io.sockets.sockets.get(socketId);
    if (s && s.data.account) notifyFriendsOf(s.data.account);
  }

  function accountOf(socketId) {
    const s = io.sockets.sockets.get(socketId);
    return s && s.data.account ? s.data.account : null;
  }

  return { attach, presenceChanged, accountOf };
}

module.exports = { createSocial };
