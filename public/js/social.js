// public/js/social.js
// Conta (entrar / criar conta / convidado), amigos e convites.
// Usa o `socket`, `usernameInput` e `initAudioContext` definidos no app.js.

(() => {
  const TOKEN_KEY = 'truco_auth_token';
  const GUEST_KEY = 'truco_guest_ok';
  const NAME_KEY = 'truco_guest_name';

  const $ = id => document.getElementById(id);
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* sem armazenamento */ } }
  };

  const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  let me = null;          // { username, stats, createdAt } ou null (convidado)
  let socialState = null; // último 'social:state'
  let authMode = 'login';
  let resumed = false;

  // ---------------------------------------------------------------------------
  // Modais
  // ---------------------------------------------------------------------------
  function openModal(id) {
    const m = $(id);
    m.classList.remove('hide');
    const focusable = m.querySelector('input');
    if (focusable && window.matchMedia('(pointer: fine)').matches) setTimeout(() => focusable.focus(), 50);
  }

  function closeModal(id) {
    $(id).classList.add('hide');
  }

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.add('hide'));
  });

  ['modal-auth', 'modal-friends', 'modal-rules'].forEach(id => {
    const overlay = $(id);
    overlay.addEventListener('mousedown', e => {
      if (e.target === overlay) closeAuthOrModal(id);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['modal-rules', 'modal-friends', 'modal-auth'].forEach(id => {
      if (!$(id).classList.contains('hide')) closeAuthOrModal(id);
    });
  });

  // Fechar a janela de conta sem escolher conta = jogar como convidado
  function closeAuthOrModal(id) {
    if (id === 'modal-auth' && !me) storage.set(GUEST_KEY, '1');
    closeModal(id);
  }

  // ---------------------------------------------------------------------------
  // Avisos flutuantes
  // ---------------------------------------------------------------------------
  const openToasts = new Map(); // chave -> função que fecha o aviso
  const MAX_TOASTS = 3;

  function dismissToast(key) {
    const close = openToasts.get(key);
    if (close) close();
  }

  function toast(html, { actions = [], timeout = 4500, kind = '', key = null } = {}) {
    const stack = $('toast-stack');
    if (key) dismissToast(key);
    // Não empilha demais: some o mais antigo
    while (stack.children.length >= MAX_TOASTS) stack.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<div class="toast-text">${html}</div>`;
    if (actions.length) {
      const row = document.createElement('div');
      row.className = 'toast-actions';
      actions.forEach(a => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn btn-sm ${a.primary ? 'btn-primary' : 'btn-secondary'}`;
        b.textContent = a.label;
        b.addEventListener('click', () => { dismiss(); a.onClick && a.onClick(); });
        row.appendChild(b);
      });
      el.appendChild(row);
    }
    stack.appendChild(el);
    let timer = timeout ? setTimeout(dismiss, timeout) : null;
    if (key) openToasts.set(key, dismiss);
    function dismiss() {
      if (key && openToasts.get(key) === dismiss) openToasts.delete(key);
      if (timer) clearTimeout(timer);
      timer = null;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 250);
    }
    return dismiss;
  }

  // ---------------------------------------------------------------------------
  // Conta
  // ---------------------------------------------------------------------------
  function setAuthMode(mode) {
    authMode = mode;
    const modal = $('modal-auth');
    modal.classList.toggle('mode-register', mode === 'register');
    modal.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b.dataset.authTab === mode));
    $('auth-password').setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
    $('auth-title').innerHTML = mode === 'register'
      ? '<i class="fa-solid fa-user-plus"></i> Criar conta'
      : '<i class="fa-solid fa-hat-cowboy"></i> Bem-vindo ao galpão';
    $('auth-error').textContent = '';
  }

  function openAuth(mode) {
    setAuthMode(mode);
    openModal('modal-auth');
  }

  document.querySelectorAll('[data-auth-tab]').forEach(btn => {
    btn.addEventListener('click', () => setAuthMode(btn.dataset.authTab));
  });

  $('auth-password-toggle').addEventListener('click', () => {
    const input = $('auth-password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('auth-password2').type = show ? 'text' : 'password';
    $('auth-password-toggle').innerHTML = `<i class="fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
  });

  $('auth-form').addEventListener('submit', e => {
    e.preventDefault();
    const username = $('auth-username').value.trim();
    const password = $('auth-password').value;
    const errorEl = $('auth-error');
    errorEl.textContent = '';

    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      errorEl.textContent = 'Usuário: de 3 a 16 caracteres, só letras, números ou _.';
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = 'A senha precisa ter pelo menos 6 caracteres.';
      return;
    }
    if (authMode === 'register' && password !== $('auth-password2').value) {
      errorEl.textContent = 'As senhas não são iguais.';
      return;
    }

    const submit = $('auth-submit');
    submit.disabled = true;
    submit.classList.add('loading');
    const event = authMode === 'register' ? 'auth:register' : 'auth:login';
    const timeout = setTimeout(() => done({ error: 'O servidor não respondeu. Tente de novo.' }), 10000);

    function done(res) {
      clearTimeout(timeout);
      submit.disabled = false;
      submit.classList.remove('loading');
      if (res.error) {
        errorEl.textContent = res.error;
        const card = document.querySelector('.auth-card');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        return;
      }
      storage.set(TOKEN_KEY, res.token);
      $('auth-password').value = '';
      $('auth-password2').value = '';
      closeModal('modal-auth');
      setUser(res.user);
      toast(authMode === 'register'
        ? `Conta criada! Bem-vindo, <b>${escapeHtml(res.user.username)}</b> 🎉`
        : `Bom te ver de novo, <b>${escapeHtml(res.user.username)}</b>!`, { kind: 'success' });
    }

    socket.emit(event, { username, password }, res => done(res || { error: 'Erro inesperado.' }));
  });

  $('auth-guest-btn').addEventListener('click', () => {
    storage.set(GUEST_KEY, '1');
    closeModal('modal-auth');
    if (window.matchMedia('(pointer: fine)').matches) usernameInput.focus();
  });

  $('open-login-btn').addEventListener('click', () => openAuth('login'));
  $('open-register-btn').addEventListener('click', () => openAuth('register'));

  $('logout-btn').addEventListener('click', () => {
    if (!confirm('Sair da sua conta neste aparelho?')) return;
    const token = storage.get(TOKEN_KEY);
    storage.del(TOKEN_KEY);
    socket.emit('auth:logout', { token }, () => {});
    setUser(null);
    toast('Você saiu da conta. Agora está jogando como convidado.');
  });

  function setUser(user) {
    if (!user && me && usernameInput.value === me.username) usernameInput.value = '';
    me = user;
    if (!user) socialState = null;
    renderAccount();
    renderFriends();
  }

  function renderAccount() {
    const strip = $('account-strip');
    strip.classList.toggle('is-guest', !me);
    strip.classList.toggle('is-user', !!me);

    if (me) {
      $('account-avatar').textContent = me.username.charAt(0).toUpperCase();
      $('account-name').textContent = me.username;
      const { played, won } = me.stats || { played: 0, won: 0 };
      $('account-sub').textContent = played
        ? `${won} ${won === 1 ? 'vitória' : 'vitórias'} em ${played} ${played === 1 ? 'partida' : 'partidas'}`
        : 'Nenhuma partida ainda. Bora jogar!';
      // Quem tem conta joga com o nome da conta
      usernameInput.value = me.username;
      usernameInput.disabled = true;
      usernameInput.title = 'Você joga com o nome da sua conta';
    } else {
      $('account-avatar').innerHTML = '<i class="fa-solid fa-user"></i>';
      $('account-name').textContent = 'Convidado';
      $('account-sub').textContent = 'Crie uma conta para adicionar amigos e guardar suas vitórias';
      usernameInput.disabled = false;
      usernameInput.title = '';
      const savedName = storage.get(NAME_KEY);
      if (!usernameInput.value && savedName) usernameInput.value = savedName;
    }

    $('invite-friends-btn').classList.toggle('hide', !me);
    const pending = socialState ? socialState.requestsIn.length : 0;
    const badge = $('friends-badge');
    badge.textContent = pending;
    badge.classList.toggle('hide', !me || pending === 0);
  }

  // Lembra o nome do convidado
  usernameInput.addEventListener('change', () => {
    if (!me) storage.set(NAME_KEY, usernameInput.value.trim());
  });

  // ---------------------------------------------------------------------------
  // Amigos
  // ---------------------------------------------------------------------------
  const STATUS_TEXT = {
    offline: 'Offline',
    lobby: 'Online no lobby',
    waiting: 'Na sala de espera',
    playing: 'Jogando agora',
    finished: 'Terminando uma partida'
  };

  function friendAction(event, username, extra = {}) {
    return new Promise(resolve => {
      socket.emit(event, { username, ...extra }, res => resolve(res || { error: 'Erro inesperado.' }));
    });
  }

  function inWaitingRoom() {
    return document.getElementById('screen-waiting').classList.contains('active');
  }

  function inLobby() {
    return document.getElementById('screen-lobby').classList.contains('active');
  }

  function joinRoom(roomId) {
    if (!inLobby()) {
      toast('Saia da sala atual antes de entrar em outra.', { kind: 'warn' });
      return;
    }
    if (typeof initAudioContext === 'function') initAudioContext();
    closeModal('modal-friends');
    socket.emit('join_room', { roomId, playerName: usernameInput.value.trim() || 'Jogador Anônimo', clientId: CLIENT_ID });
  }

  function avatarHtml(name, extraClass = '') {
    return `<span class="friend-avatar ${extraClass}">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
  }

  function renderFriends() {
    const list = $('friends-list');
    const inList = $('requests-in-list');
    const outList = $('requests-out-list');
    if (!list) return;

    const state = socialState || { friends: [], requestsIn: [], requestsOut: [] };

    // Pedidos recebidos
    $('friends-requests-in').classList.toggle('hide', state.requestsIn.length === 0);
    inList.innerHTML = state.requestsIn.map(name => `
      <li class="friend-item request">
        ${avatarHtml(name)}
        <div class="friend-info"><b>${escapeHtml(name)}</b><small>quer ser seu amigo</small></div>
        <div class="friend-actions">
          <button class="btn btn-sm btn-success" data-act="accept" data-user="${escapeHtml(name)}" title="Aceitar"><i class="fa-solid fa-check"></i></button>
          <button class="btn btn-sm btn-secondary" data-act="decline" data-user="${escapeHtml(name)}" title="Recusar"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </li>`).join('');

    // Pedidos enviados
    $('friends-requests-out').classList.toggle('hide', state.requestsOut.length === 0);
    outList.innerHTML = state.requestsOut.map(name => `
      <li class="friend-item pending">
        ${avatarHtml(name, 'muted')}
        <div class="friend-info"><b>${escapeHtml(name)}</b><small>aguardando resposta</small></div>
        <div class="friend-actions">
          <button class="btn btn-sm btn-secondary" data-act="cancel" data-user="${escapeHtml(name)}">Cancelar</button>
        </div>
      </li>`).join('');

    // Amigos
    const onlineCount = state.friends.filter(f => f.online).length;
    $('friends-count').textContent = state.friends.length ? `${onlineCount}/${state.friends.length} online` : '';

    if (!me) {
      list.innerHTML = '<li class="friends-empty">Entre na sua conta para ver seus amigos.</li>';
      return;
    }
    if (state.friends.length === 0) {
      list.innerHTML = `<li class="friends-empty"><i class="fa-solid fa-mug-hot"></i>
        Nenhum amigo ainda. Adicione pelo nome de usuário ali em cima!</li>`;
      return;
    }

    const canInvite = inWaitingRoom();
    list.innerHTML = state.friends.map(f => {
      let detail = STATUS_TEXT[f.status] || '';
      if (f.status === 'waiting' || f.status === 'playing') {
        detail += ` · ${escapeHtml(f.roomName)} (${f.mode === '2v2' ? '2v2' : '1v1'}, ${f.players}/${f.maxPlayers})`;
      }
      const buttons = [];
      if (f.joinable && !canInvite) {
        buttons.push(`<button class="btn btn-sm btn-primary" data-act="join" data-room="${escapeHtml(f.roomId)}">Entrar</button>`);
      }
      if (canInvite && f.online && f.status !== 'playing') {
        buttons.push(`<button class="btn btn-sm btn-primary" data-act="invite" data-user="${escapeHtml(f.username)}"><i class="fa-solid fa-envelope"></i> Convidar</button>`);
      }
      buttons.push(`<button class="icon-btn small" data-act="remove" data-user="${escapeHtml(f.username)}" title="Remover amigo" aria-label="Remover ${escapeHtml(f.username)}"><i class="fa-solid fa-user-minus"></i></button>`);
      return `
        <li class="friend-item status-${f.status}">
          ${avatarHtml(f.username)}
          <div class="friend-info"><b>${escapeHtml(f.username)}</b><small><i class="status-dot"></i>${detail}</small></div>
          <div class="friend-actions">${buttons.join('')}</div>
        </li>`;
    }).join('');
  }

  // Cliques nos botões das listas (delegados)
  $('modal-friends').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const user = btn.dataset.user;
    const act = btn.dataset.act;
    const msg = $('add-friend-msg');

    if (act === 'join') return joinRoom(btn.dataset.room);
    if (act === 'remove' && !confirm(`Remover ${user} dos seus amigos?`)) return;

    btn.disabled = true;
    const event = {
      accept: 'friends:respond', decline: 'friends:respond', cancel: 'friends:cancel',
      remove: 'friends:remove', invite: 'friends:invite'
    }[act];
    const res = await friendAction(event, user, act === 'accept' || act === 'decline' ? { accept: act === 'accept' } : {});
    btn.disabled = false;
    if (res.error) {
      msg.textContent = res.error;
      msg.className = 'form-msg error';
    } else if (res.message) {
      msg.textContent = res.message;
      msg.className = 'form-msg ok';
      if (act === 'invite') {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Enviado';
        btn.disabled = true;
      }
    }
  });

  $('add-friend-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('add-friend-input');
    const msg = $('add-friend-msg');
    const name = input.value.trim();
    if (!name) return;
    const res = await friendAction('friends:request', name);
    msg.textContent = res.error || res.message || '';
    msg.className = `form-msg ${res.error ? 'error' : 'ok'}`;
    if (!res.error) input.value = '';
  });

  function openFriends() {
    if (!me) return openAuth('register');
    [...openToasts.keys()].filter(k => k.startsWith('req:')).forEach(dismissToast);
    $('add-friend-msg').textContent = '';
    renderFriends();
    openModal('modal-friends');
  }

  $('open-friends-btn').addEventListener('click', openFriends);
  $('invite-friends-btn').addEventListener('click', openFriends);

  // Re-renderiza a lista ao trocar de tela (botão Entrar x Convidar)
  new MutationObserver(() => {
    if (!$('modal-friends').classList.contains('hide')) renderFriends();
  }).observe(document.getElementById('screen-waiting'), { attributes: true, attributeFilter: ['class'] });

  // ---------------------------------------------------------------------------
  // Eventos do servidor
  // ---------------------------------------------------------------------------
  socket.on('social:state', state => {
    const prevIn = socialState ? socialState.requestsIn : null;
    const prevOnline = socialState ? new Set(socialState.friends.filter(f => f.online).map(f => f.username)) : null;
    const prevKnown = new Set(socialState ? socialState.friends.map(f => f.username) : []);
    socialState = state;
    if (state.user) me = state.user;
    renderAccount();
    renderFriends();

    // Pedido respondido: some o aviso dele
    if (prevIn) prevIn.filter(n => !state.requestsIn.includes(n)).forEach(n => dismissToast('req:' + n));

    // Novo pedido de amizade (não avisa se a janela de amigos já está aberta)
    const friendsOpen = !$('modal-friends').classList.contains('hide');
    if (prevIn && !friendsOpen) {
      state.requestsIn.filter(n => !prevIn.includes(n)).forEach(name => {
        toast(`<i class="fa-solid fa-user-plus"></i> <b>${escapeHtml(name)}</b> quer ser seu amigo`, {
          key: 'req:' + name,
          timeout: 9000,
          actions: [
            { label: 'Ver', primary: true, onClick: openFriends }
          ]
        });
      });
    }
    // Amigo que já estava na lista ficou online
    if (prevOnline && !friendsOpen) {
      state.friends.filter(f => f.online && !prevOnline.has(f.username) && prevKnown.has(f.username)).forEach(f => {
        toast(`<span class="status-dot on"></span> <b>${escapeHtml(f.username)}</b> ficou online`, { timeout: 3500, key: 'on:' + f.username });
      });
    }
  });

  socket.on('social:invited', invite => {
    toast(`<i class="fa-solid fa-envelope-open-text"></i> <b>${escapeHtml(invite.from)}</b> te chamou para
      <b>${escapeHtml(invite.roomName)}</b> (${invite.mode === '2v2' ? 'dupla' : '1v1'})`, {
      timeout: 20000,
      kind: 'invite',
      actions: [
        { label: 'Entrar', primary: true, onClick: () => joinRoom(invite.roomId) },
        { label: 'Agora não' }
      ]
    });
  });

  // Ao conectar (e reconectar), retoma a sessão salva
  function resumeSession() {
    const token = storage.get(TOKEN_KEY);
    if (!token) {
      if (!resumed) {
        resumed = true;
        if (!storage.get(GUEST_KEY)) openAuth('login');
      }
      return;
    }
    socket.emit('auth:resume', { token }, res => {
      resumed = true;
      if (!res || res.error) {
        storage.del(TOKEN_KEY);
        setUser(null);
        if (!storage.get(GUEST_KEY)) openAuth('login');
        return;
      }
      setUser(res.user);
    });
  }

  socket.on('connect', resumeSession);
  if (socket.connected) resumeSession();

  renderAccount();

  // Usado por outros scripts (ex.: atualizar a lista ao trocar de tela)
  window.trucoSocial = { openAuth, openFriends, toast, dismissToast };
})();
