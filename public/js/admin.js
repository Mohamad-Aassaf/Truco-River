// public/js/admin.js
// Acesso escondido ao Painel Admin, janela de senha e "assistir partidas".
// - Tela inicial: tocar 5 vezes nas cartas acima do título.
// - Durante a partida: tocar 5 vezes no título "Truco River" do menu lateral.
// Usa `socket`, `isClientAdminAuthenticated` e `openAdminPanel` do app.js.

(() => {
  const $ = id => document.getElementById(id);
  const escapeHtml = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  // --- 5 toques rápidos abrem o painel ---
  function secretTaps(el) {
    if (!el) return;
    let taps = [];
    el.addEventListener('click', () => {
      const now = Date.now();
      taps = taps.filter(t => now - t < 2500);
      taps.push(now);
      if (taps.length >= 5) {
        taps = [];
        requestAdminPanel();
      }
    });
  }
  secretTaps(document.querySelector('.hero-fan'));
  secretTaps(document.querySelector('.sidebar-title'));

  // --- Janela de senha (não mostra o que é digitado) ---
  const modal = $('modal-admin-login');
  const form = $('admin-login-form');
  const input = $('admin-password');
  const error = $('admin-login-error');
  const submit = $('admin-login-submit');

  function askPassword() {
    error.textContent = '';
    input.value = '';
    input.type = 'password';
    modal.classList.remove('hide');
    setTimeout(() => input.focus(), 60);
  }
  const close = () => modal.classList.add('hide');

  $('admin-password-toggle').addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('admin-password-toggle').innerHTML = `<i class="fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!input.value) return;
    submit.disabled = true;
    socket.emit('validate_admin', { password: input.value }, res => {
      submit.disabled = false;
      input.value = '';
      if (!res || res.error) {
        error.textContent = (res && res.error) || 'Erro ao entrar.';
        const card = modal.querySelector('.modal-card');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        return;
      }
      isClientAdminAuthenticated = true;
      close();
      openAdminPanel();
    });
  });
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', close));
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });

  // --- Aba "Partidas": listar e assistir ---
  const list = $('admin-games-list');
  const STATE = { lobby: 'Sala de espera', playing: 'Jogando', hand_end: 'Jogando', game_end: 'Terminou' };

  function loadGames() {
    if (!isClientAdminAuthenticated) return;
    list.innerHTML = '<li class="news-empty">Carregando...</li>';
    socket.emit('admin:games', {}, res => {
      if (!res || res.error) {
        list.innerHTML = `<li class="news-empty">${escapeHtml((res && res.error) || 'Erro')}</li>`;
        return;
      }
      if (!res.games.length) {
        list.innerHTML = '<li class="news-empty"><i class="fa-solid fa-mug-hot"></i> Nenhuma sala aberta agora.</li>';
        return;
      }
      const order = { playing: 0, hand_end: 0, lobby: 1, game_end: 2 };
      res.games.sort((a, b) => order[a.state] - order[b.state]);
      list.innerHTML = res.games.map(g => {
        const team = t => g.players.filter(p => p.team === t)
          .map(p => `${p.isBot ? '<i class="fa-solid fa-robot"></i> ' : ''}${escapeHtml(p.name)}${p.disconnected ? ' <small>(caiu)</small>' : ''}`).join(', ') || '—';
        const live = g.state === 'playing' || g.state === 'hand_end';
        return `
          <li class="admin-game ${live ? 'live' : ''}">
            <div class="admin-game-head">
              <b>${escapeHtml(g.roomName)}</b>
              <span class="admin-game-tag">${g.mode} · ${STATE[g.state] || g.state}${g.isPrivate ? ' · privada' : ''}</span>
            </div>
            <div class="admin-game-teams">
              <span class="t0">${team(0)}</span>
              <b class="admin-game-score">${g.score[0]} × ${g.score[1]}</b>
              <span class="t1">${team(1)}</span>
            </div>
            <div class="admin-game-foot">
              <small>Código ${escapeHtml(g.id)} · até ${g.limit}${g.spectators ? ` · ${g.spectators} assistindo` : ''}</small>
              <button type="button" class="btn btn-sm btn-primary" data-watch="${escapeHtml(g.id)}"><i class="fa-solid fa-eye"></i> Assistir</button>
            </div>
          </li>`;
      }).join('');
    });
  }

  $('admin-games-refresh').addEventListener('click', loadGames);
  const tab = document.querySelector('[data-admin-tab="games"]');
  if (tab) tab.addEventListener('click', loadGames);

  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-watch]');
    if (!btn) return;
    btn.disabled = true;
    socket.emit('admin:spectate', { roomId: btn.dataset.watch }, res => {
      btn.disabled = false;
      if (!res || res.error) {
        if (window.trucoSocial) window.trucoSocial.toast(escapeHtml((res && res.error) || 'Erro'), { kind: 'warn' });
        return;
      }
      $('modal-admin-panel').classList.add('hide');
    });
  });

  // Barra "Assistindo" e sair
  const bar = $('spectate-bar');
  socket.on('game_state', s => {
    if (!s || !s.spectating) return;
    bar.classList.remove('hide');
    $('spectate-text').textContent = `Assistindo: ${s.roomName} (${s.mode}) — você vê todas as cartas`;
  });
  $('spectate-exit').addEventListener('click', () => {
    socket.emit('admin:unspectate', {}, () => window.location.reload());
    setTimeout(() => window.location.reload(), 800);
  });

  window.trucoAdmin = { askPassword, loadGames };
})();
