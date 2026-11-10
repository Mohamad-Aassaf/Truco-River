// public/js/table-extras.js
// - Quadro de times da sala de espera nas duplas (estilo "dois lados")
// - Relógio da jogada (20s)
// - Avisos de conexão: "você caiu / voltando" e "fulano caiu, esperando"
// Usa `socket`, `mySeatIndex`, `myPlayerId` e `escapeText` do app.js.

(() => {
  const $ = id => document.getElementById(id);
  const LEVELS = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

  // ---------------------------------------------------------------------------
  // Quadro de times (duplas)
  // ---------------------------------------------------------------------------
  window.renderTeamsBoard = function renderTeamsBoard(gameState, container) {
    const meIdx = gameState.players.findIndex(p => p.id === myPlayerId);
    const me = gameState.players[meIdx];
    const hostId = gameState.hostId || (gameState.players[0] && gameState.players[0].id);
    const isHost = hostId === myPlayerId;
    const perTeam = gameState.maxPlayers / 2;
    const duo = gameState.mode === '2v2';

    const card = p => {
      const isMe = p === me;
      const canMove = duo && (isHost || isMe);
      const other = p.team === 0 ? 1 : 0;
      const arrow = p.team === 0 ? 'fa-arrow-right' : 'fa-arrow-left';
      const name = p.isBot && isHost ? escapeText(p.name.replace(/\s*\([^)]*\)\s*$/, '')) : escapeText(p.name);
      const level = p.isBot && isHost
        ? `<select class="bot-level-select" data-id="${p.id}" aria-label="Dificuldade do bot">${Object.keys(LEVELS)
          .map(k => `<option value="${k}" ${p.difficulty === k ? 'selected' : ''}>${LEVELS[k]}</option>`).join('')}</select>`
        : '';
      const tags = [
        p.ready ? '<span class="tp-status ok"><i class="fa-solid fa-check"></i> Pronto</span>' : '<span class="tp-status">Aguardando</span>',
        p.id === hostId ? '<span class="tp-tag tp-host">dono</span>' : '',
        p.disconnected ? '<span class="tp-tag off">caiu</span>' : ''
      ].join('');
      // Linha de altura fixa: ícone | nome + detalhes | botões (não desalinha quando alguém entra)
      return `
        <div class="team-player ${p.ready ? 'ready' : ''} ${isMe ? 'me' : ''} ${p.disconnected ? 'offline' : ''}">
          <span class="tp-icon">${p.isBot ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>'}</span>
          <span class="tp-main">
            <span class="tp-name" title="${name}">${name}${isMe ? ' <small>(você)</small>' : ''}</span>
            <span class="tp-sub">${tags}${level}</span>
          </span>
          <span class="tp-actions">
            ${canMove ? `<button type="button" class="icon-btn small tp-move" data-move="${p.id}" data-to="${other}" title="Passar para o outro time" aria-label="Passar ${name} para o outro time"><i class="fa-solid ${arrow}"></i></button>` : ''}
            ${duo && !isHost && me && !isMe && !p.isBot && p.team !== me.team ? `<button type="button" class="icon-btn small tp-swap" data-swap-req="${p.id}" title="Pedir para trocar de lugar" aria-label="Pedir para trocar de lugar com ${name}"><i class="fa-solid fa-right-left"></i></button>` : ''}
            ${friendBtn(p, isMe)}
            ${isHost && !isMe ? `<button type="button" class="icon-btn small danger tp-kick" data-kick="${p.id}" title="Remover" aria-label="Remover ${name}"><i class="fa-solid fa-user-xmark"></i></button>` : ''}
          </span>
        </div>`;
    };

    // Adicionar amigo: só para quem tem conta (convidado não tem lista de amigos)
    function friendBtn(p, isMe) {
      if (isMe || p.isBot || !p.hasAccount || !window.trucoSocial) return '';
      const rel = window.trucoSocial.relationWith(p.name);
      if (rel === 'friend') return '<span class="tp-friend" title="Vocês são amigos"><i class="fa-solid fa-user-check"></i></span>';
      if (rel === 'sent') return '<span class="tp-friend" title="Pedido de amizade enviado"><i class="fa-solid fa-paper-plane"></i></span>';
      if (rel === 'self') return '';
      const label = rel === 'received' ? 'Aceitar pedido de amizade' : 'Adicionar amigo';
      return `<button type="button" class="icon-btn small tp-add-friend" data-add-friend="${escapeText(p.name)}" title="${label}" aria-label="${label}: ${escapeText(p.name)}"><i class="fa-solid fa-user-plus"></i></button>`;
    }

    const column = team => {
      const members = gameState.players.filter(p => p.team === team);
      const slots = [];
      for (let i = 0; i < perTeam; i++) {
        if (members[i]) slots.push(card(members[i]));
        else {
          const canJoin = duo && me && me.team !== team;
          slots.push(`<div class="team-player empty">
            <span class="tp-icon"><i class="fa-regular fa-user"></i></span>
            <span class="tp-main"><span class="tp-name">Vaga livre</span></span>
            ${canJoin ? `<button type="button" class="btn btn-sm btn-secondary" data-join-team="${team}">Entrar aqui</button>` : ''}
          </div>`);
        }
      }
      const isMine = me && me.team === team;
      return `
        <div class="team-col team-${team} ${isMine ? 'mine' : ''}">
          ${teamHead(team, isMine)}
          ${slots.join('')}
        </div>`;
    };

    // Cabeçalho do time: nome (padrão "Nós"/"Eles") e lápis para o próprio time renomear
    function teamHead(team, isMine) {
      const label = escapeText(window.teamLabel ? window.teamLabel(gameState, team) : `Time ${team + 1}`);
      if (isMine && renameDraft !== null) {
        return `
          <form class="team-rename-form" data-rename-form>
            <input type="text" id="team-rename-input" maxlength="${TEAM_NAME_MAX}" value="${escapeText(renameDraft)}" placeholder="Nome do time" aria-label="Nome do time" autocomplete="off">
            <button type="submit" class="icon-btn small" title="Salvar" aria-label="Salvar nome"><i class="fa-solid fa-check"></i></button>
            <button type="button" class="icon-btn small" data-rename-cancel title="Cancelar" aria-label="Cancelar"><i class="fa-solid fa-xmark"></i></button>
          </form>`;
      }
      return `
        <div class="team-col-head">
          <span class="team-col-name" title="${label}">${label}</span>
          ${isMine ? `<button type="button" class="icon-btn small tp-rename" data-rename-team title="Mudar o nome do time" aria-label="Mudar o nome do time"><i class="fa-solid fa-pen"></i></button>` : ''}
          ${isMine ? '<small>seu time</small>' : ''}
        </div>`;
    }

    const hint = !duo
      ? '<small>Toque no lápis para dar um nome ao seu lado.</small>'
      : isHost
        ? '<button type="button" class="btn btn-sm btn-secondary" id="shuffle-teams-btn"><i class="fa-solid fa-shuffle"></i> Sortear times</button><small>Use as setas para passar alguém de time. Se o outro time estiver cheio, eles trocam de lugar. Toque no lápis para dar nome ao seu time.</small>'
        : '<small>Use a seta para trocar de time. Com o time cheio, toque em <i class="fa-solid fa-right-left"></i> ao lado de alguém do outro time para pedir para trocar de lugar. Toque no lápis para dar nome ao seu time.</small>';
    const specCount = gameState.spectatorCount || 0;
    const allow = gameState.allowSpectators !== false;
    const specRow = isHost
      ? `<div class="spec-setting"><label class="spec-toggle"><input type="checkbox" id="allow-spectators" ${allow ? 'checked' : ''}>
          <span class="spec-switch" aria-hidden="true"></span><i class="fa-solid fa-eye"></i> Permitir espectadores</label>
          ${specCount ? `<small>${specCount} assistindo</small>` : ''}</div>`
      : `<div class="spec-setting"><small><i class="fa-solid ${allow ? 'fa-eye' : 'fa-eye-slash'}"></i> ${allow ? 'Espectadores liberados' : 'Sem espectadores'}${specCount ? ` · ${specCount} assistindo` : ''}</small></div>`;
    container.innerHTML = `
      <div class="teams-board ${duo ? '' : 'solo'}">
        ${column(0)}
        <div class="teams-vs">VS</div>
        ${column(1)}
      </div>
      <div class="teams-tools">${hint}</div>
      ${specRow}`;

    // Mantém a edição do nome mesmo quando a sala atualiza
    const input = container.querySelector('#team-rename-input');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  };

  // Nome do time
  const TEAM_NAME_MAX = 16;
  let renameDraft = null; // texto sendo digitado (null = não está editando)
  const rerender = () => { if (lastGameState && window.renderTeamsBoard) window.renderTeamsBoard(lastGameState, $('players-lobby-list')); };

  // Cliques no quadro (delegados: o quadro é refeito a cada atualização)
  const lobbyList = $('players-lobby-list');
  lobbyList.addEventListener('click', e => {
    const move = e.target.closest('[data-move]');
    const kick = e.target.closest('[data-kick]');
    const join = e.target.closest('[data-join-team]');
    if (move) socket.emit('switch_team', { targetId: move.dataset.move, toTeam: Number(move.dataset.to) });
    else if (join) socket.emit('switch_team', { toTeam: Number(join.dataset.joinTeam) });
    else if (kick) socket.emit('kick_player', { playerId: kick.dataset.kick });
    else if (e.target.closest('[data-swap-req]')) {
      const btn = e.target.closest('[data-swap-req]');
      socket.emit('swap_request', { targetId: btn.dataset.swapReq }, r => {
        if (!r) return;
        note(r.ok ? `<i class="fa-solid fa-right-left"></i> Pedido de troca enviado para <b>${escapeText(r.name)}</b>.` : escapeText(r.error));
      });
    }
    else if (e.target.closest('#shuffle-teams-btn')) socket.emit('shuffle_teams');
    else if (e.target.closest('[data-add-friend]')) {
      const btn = e.target.closest('[data-add-friend]');
      btn.disabled = true;
      window.trucoSocial.requestFriend(btn.dataset.addFriend).then(() => rerender());
    }
    else if (e.target.closest('[data-rename-team]')) {
      const s = lastGameState;
      const me = s && s.players.find(p => p.id === myPlayerId);
      renameDraft = (me && s.teamNames && s.teamNames[me.team]) || '';
      rerender();
    } else if (e.target.closest('[data-rename-cancel]')) {
      renameDraft = null;
      rerender();
    }
  });
  lobbyList.addEventListener('input', e => {
    if (e.target.id === 'team-rename-input') renameDraft = e.target.value;
  });
  lobbyList.addEventListener('keydown', e => {
    if (e.target.id === 'team-rename-input' && e.key === 'Escape') { renameDraft = null; rerender(); }
  });
  lobbyList.addEventListener('submit', e => {
    if (!e.target.closest('[data-rename-form]')) return;
    e.preventDefault();
    const name = (renameDraft || '').trim().slice(0, TEAM_NAME_MAX);
    socket.emit('set_team_name', { name }, r => {
      if (r && r.error && window.trucoSocial) window.trucoSocial.toast(escapeText(r.error));
    });
    renameDraft = null;
    rerender();
  });
  socket.on('game_state', s => { if (s && s.state !== 'lobby') renameDraft = null; });
  lobbyList.addEventListener('change', e => {
    if (e.target.id === 'allow-spectators') socket.emit('set_allow_spectators', { allow: e.target.checked });
    const sel = e.target.closest('.teams-board .bot-level-select');
    if (sel) socket.emit('set_bot_difficulty', { playerId: sel.dataset.id, difficulty: sel.value });
  });

  // Amizades mudaram (pedido enviado/aceito): atualiza os botões
  window.addEventListener('truco:social', () => {
    if (lastGameState && lastGameState.state === 'lobby') rerender();
    if (seatMenu && !seatMenu.classList.contains('hide') && seatMenu.dataset.name) openSeatMenuFor(seatMenu.dataset.name, null);
  });

  // ---------------------------------------------------------------------------
  // Na partida: tocar no lugar de alguém abre um menu com "Adicionar amigo"
  // ---------------------------------------------------------------------------
  let seatMenu = null;
  let seatMenuAnchor = null;
  function closeSeatMenu() { if (seatMenu) seatMenu.classList.add('hide'); seatMenuAnchor = null; }
  function openSeatMenuFor(name, anchor) {
    const s = lastGameState;
    const p = s && s.players.find(x => x.name === name);
    if (!p) return closeSeatMenu();
    if (!seatMenu) {
      seatMenu = document.createElement('div');
      seatMenu.className = 'seat-menu hide';
      seatMenu.setAttribute('role', 'dialog');
      document.body.appendChild(seatMenu);
      seatMenu.addEventListener('click', e => {
        const b = e.target.closest('button[data-seat-act]');
        if (!b) return;
        if (b.dataset.seatAct === 'login') { closeSeatMenu(); window.trucoSocial.openAuth('login'); return; }
        b.disabled = true;
        window.trucoSocial.requestFriend(seatMenu.dataset.name).then(() => openSeatMenuFor(seatMenu.dataset.name, null));
      });
    }
    if (anchor) seatMenuAnchor = anchor;
    const social = window.trucoSocial;
    const rel = p.isBot ? 'bot' : !p.hasAccount ? 'noaccount' : !social || !social.isLogged() ? 'guest' : social.relationWith(p.name);
    const body = {
      bot: '<p>É um bot: não dá para adicionar.</p>',
      noaccount: '<p>Esse jogador está sem conta (convidado), então não dá para adicionar.</p>',
      guest: '<p>Entre na sua conta para adicionar amigos.</p><button type="button" class="btn btn-sm btn-primary" data-seat-act="login">Entrar</button>',
      self: '',
      friend: '<p class="ok"><i class="fa-solid fa-user-check"></i> Vocês já são amigos.</p>',
      sent: '<p><i class="fa-solid fa-paper-plane"></i> Pedido de amizade enviado.</p>',
      received: '<button type="button" class="btn btn-sm btn-primary" data-seat-act="add"><i class="fa-solid fa-user-check"></i> Aceitar pedido de amizade</button>',
      none: '<button type="button" class="btn btn-sm btn-primary" data-seat-act="add"><i class="fa-solid fa-user-plus"></i> Adicionar amigo</button>'
    }[rel] || '';
    seatMenu.dataset.name = p.name;
    seatMenu.innerHTML = `<b class="seat-menu-name">${escapeText(p.name)}</b>${body}`;
    seatMenu.classList.remove('hide');
    const a = seatMenuAnchor && seatMenuAnchor.getBoundingClientRect();
    if (a) {
      const w = seatMenu.offsetWidth, h = seatMenu.offsetHeight;
      let left = a.left + a.width / 2 - w / 2;
      left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
      let top = a.bottom + 8;
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 8);
      seatMenu.style.left = `${left}px`;
      seatMenu.style.top = `${top}px`;
    }
  }
  document.addEventListener('click', e => {
    const seat = e.target.closest('.player-seat');
    if (seat && seat.id !== 'seat-bottom' && lastGameState && lastGameState.players && typeof seatOf === 'function') {
      const idx = lastGameState.players.findIndex((p, i) => `seat-${seatOf(i)}` === seat.id);
      if (idx !== -1 && lastGameState.players[idx].id !== myPlayerId) {
        openSeatMenuFor(lastGameState.players[idx].name, seat);
        return;
      }
    }
    if (seatMenu && !seatMenu.contains(e.target)) closeSeatMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSeatMenu(); });
  socket.on('game_state', s => { if (!s || s.state === 'lobby') closeSeatMenu(); });

  // ---------------------------------------------------------------------------
  // Sorteio de quem dá as cartas: cartas viradas espalhadas na mesa, em linha;
  // cada um toca numa para tirar. Quem tirar o maior número dá as cartas.
  // ---------------------------------------------------------------------------
  let drawBox = null;
  let drawSeen = new Set();   // cartas que já apareceram viradas (para animar só as novas)
  let drawTick = null;
  let drawState = null;
  let drawRoundKey = null;
  function drawNames(s, list) {
    return list.map(i => (s.players[i] ? escapeText(s.players[i].name) : '')).join(' e ');
  }
  function renderDraw(s) {
    if (!s || s.state !== 'drawing' || !s.dealDraw) {
      if (drawBox) drawBox.classList.add('hide');
      drawSeen = new Set();
      drawState = null;
      drawRoundKey = null;
      clearInterval(drawTick);
      return;
    }
    drawState = { s, at: Date.now() };
    if (!drawBox) {
      drawBox = document.createElement('div');
      drawBox.className = 'draw-overlay hide';
      drawBox.setAttribute('role', 'dialog');
      drawBox.setAttribute('aria-label', 'Sorteio de quem dá as cartas');
      document.body.appendChild(drawBox);
      drawBox.addEventListener('click', e => {
        const btn = e.target.closest('[data-draw-pick]');
        if (!btn || btn.disabled) return;
        drawBox.querySelectorAll('[data-draw-pick]').forEach(b => { b.disabled = true; });
        btn.classList.add('picking');
        socket.emit('draw_pick', { index: Number(btn.dataset.drawPick) }, r => {
          if (r && r.error && window.trucoSocial) window.trucoSocial.toast(escapeText(r.error));
        });
      });
    }
    const d = s.dealDraw;
    const me = s.spectating ? -1 : s.players.findIndex(p => p.id === myPlayerId);
    const myTeam = me >= 0 ? s.players[me].team : 0;
    const iCanPick = !s.spectating && me >= 0 && !d.done && !d.tie && d.contenders.includes(me) && !d.spread.some(c => c.by === me);
    const pending = d.contenders.filter(i => !d.spread.some(c => c.by === i));
    const lastTie = d.history.length && d.round > 1 ? d.history[d.history.length - 1] : null;
    const roundKey = `${s.id}:${d.id}:${d.round}`;
    const entering = roundKey !== drawRoundKey; // cartas chegando na mesa: anima só uma vez
    drawRoundKey = roundKey;

    // Linha de cartas na mesa
    const spread = d.spread.map((c, i) => {
      const key = `${d.id}:${d.round}:${i}`;
      if (c.by === null) {
        return `<button type="button" class="draw-slot back" data-draw-pick="${i}" ${iCanPick ? '' : 'disabled'} aria-label="Tirar a carta ${i + 1}" style="--k:${i}"></button>`;
      }
      const fresh = !drawSeen.has(key);
      drawSeen.add(key);
      const p = s.players[c.by] || {};
      const won = d.done && c.by === d.dealerIdx && d.history.length && d.history[d.history.length - 1].round === d.round;
      const tied = d.tie && d.tie.players.includes(c.by);
      return `<div class="draw-slot taken ${fresh ? 'fresh' : ''} ${p.team === myTeam ? 'us' : 'them'} ${won ? 'winner' : d.done ? 'loser' : ''} ${tied ? 'tied' : d.tie ? 'loser' : ''}" style="--k:${i}">
          <img src="${getCardImgSrc(c.card)}" alt="${c.card.value} de ${c.card.suit}" title="${escapeText(p.name || '')}">
        </div>`;
    }).join('');

    // Placar do sorteio: cada jogador e a carta que tirou nesta rodada
    const picksNow = {};
    d.spread.forEach(c => { if (c.by !== null) picksNow[c.by] = c.card; });
    const rows = s.players.map((p, i) => {
      const inRound = d.contenders.includes(i);
      const prev = lastTie ? lastTie.draws.find(x => x.playerIdx === i) : null;
      const card = picksNow[i] || (!inRound && prev ? prev.card : null);
      const winner = d.done && i === d.dealerIdx;
      return `<li class="draw-player ${p.team === myTeam ? 'us' : 'them'} ${inRound ? '' : 'out'} ${winner ? 'winner' : ''}">
          <span class="draw-player-name">${winner ? '<i class="fa-solid fa-crown"></i> ' : ''}${escapeText(p.name)}${i === me ? ' <small>(você)</small>' : ''}</span>
          <b class="draw-player-num">${card ? card.value : (inRound && !d.done ? '<i class="fa-solid fa-hourglass-half"></i>' : '–')}</b>
        </li>`;
    }).join('');

    let status;
    let result = '';
    if (d.tie) {
      // Empate: aviso grande e as cartas empatadas ficam na mesa por uns segundos
      const mineTied = d.tie.players.includes(me);
      const tiedNames = d.tie.players.map(i => (i === me ? 'Você' : escapeText((s.players[i] || {}).name || ''))).join(' e ');
      const others = d.tie.players.filter(i => i !== me);
      result = `
        <div class="draw-tie-box">
          <b><i class="fa-solid fa-equals"></i> Empate!</b>
          <span>${tiedNames} tiraram <b>${d.tie.value}</b>.</span>
          <span class="draw-tie-next">${mineTied ? `Você e ${drawNames(s, others)} vão tirar de novo` : `${tiedNames} vão tirar de novo`}<span class="draw-dots"><i></i><i></i><i></i></span></span>
        </div>`;
      status = '';
    } else if (d.done) {
      // Resultado em destaque: quem venceu, com a carta que tirou
      const lastRound = d.history[d.history.length - 1];
      const winDraw = lastRound && lastRound.draws.find(x => x.playerIdx === d.dealerIdx);
      const isMe = d.dealerIdx === me;
      result = `
        <div class="draw-result-box ${isMe ? 'me' : ''}">
          ${winDraw ? `<img class="draw-result-card" src="${getCardImgSrc(winDraw.card)}" alt="${winDraw.card.value} de ${winDraw.card.suit}">` : ''}
          <div class="draw-result-text">
            <b>${isMe ? 'Você dá as cartas' : `${drawNames(s, [d.dealerIdx])} dá as cartas`}</b>
            <span class="draw-result-roles"><i class="fa-solid fa-play"></i> ${d.mãoIdx === me ? 'Você começa' : `${drawNames(s, [d.mãoIdx])} começa`}</span>
          </div>
        </div>`;
      status = '';
    } else if (iCanPick) {
      status = `<p class="draw-status mine"><i class="fa-solid fa-hand-pointer"></i> Sua vez: toque numa carta para tirar a sua!</p>`;
    } else {
      status = `<p class="draw-status">Esperando ${drawNames(s, pending)} tirar…</p>`;
    }
    const tieNote = lastTie && !d.done && !d.tie
      ? `<p class="draw-tie"><i class="fa-solid fa-equals"></i> Empate no ${Math.max(...lastTie.draws.map(x => x.card.value))}: ${drawNames(s, d.contenders)} tiram de novo.</p>`
      : '';

    drawBox.innerHTML = `
      <div class="draw-panel">
        <span class="draw-kicker"><i class="fa-solid fa-layer-group"></i> Sorteio</span>
        ${d.done || d.tie ? '' : `<h3>Quem dá as cartas?</h3>
        <p class="draw-sub">Cada um tira uma carta da mesa. Quem tirar o maior <b>número</b> dá as cartas
          (aqui vale só o número: 12 é a maior e 1 a menor).</p>`}
        ${tieNote}
        ${result}
        <div class="draw-spread ${iCanPick ? 'can-pick' : ''} ${entering ? 'entering' : ''} ${d.done ? 'done' : ''}">${spread}</div>
        ${status}
        ${!d.done && d.endsIn != null ? '<span class="draw-timer"><span></span></span>' : ''}
        ${d.done || d.tie ? '' : `<ul class="draw-players">${rows}</ul>`}
      </div>`;
    drawBox.classList.remove('hide');
    clearInterval(drawTick);
    if (!d.done && d.endsIn != null) {
      const total = 12000;
      const fill = () => {
        const bar = drawBox.querySelector('.draw-timer span');
        if (!bar || !drawState) return;
        const left = Math.max(0, d.endsIn - (Date.now() - drawState.at));
        bar.style.width = `${(left / total) * 100}%`;
      };
      fill();
      drawTick = setInterval(fill, 250);
    }
  }
  socket.on('game_state', s => renderDraw(s));

  // ---------------------------------------------------------------------------
  // Pedido de troca de lugar
  // ---------------------------------------------------------------------------
  function note(html, opts) { if (window.trucoSocial) window.trucoSocial.toast(html, opts); }
  socket.on('swap_request', ({ fromId, fromName }) => {
    if (window.soundManager && window.soundManager.playChatPing) window.soundManager.playChatPing();
    note(`<i class="fa-solid fa-right-left"></i> <b>${escapeText(fromName)}</b> quer trocar de lugar com você.`, {
      key: 'swap-' + fromId,
      timeout: 30000,
      actions: [
        { label: 'Aceitar', primary: true, onClick: () => socket.emit('swap_answer', { fromId, accept: true }) },
        { label: 'Recusar', onClick: () => socket.emit('swap_answer', { fromId, accept: false }) }
      ]
    });
  });
  socket.on('swap_result', ({ ok, name }) => {
    note(ok ? `<i class="fa-solid fa-check"></i> <b>${escapeText(name)}</b> aceitou: vocês trocaram de lugar.`
      : `<b>${escapeText(name)}</b> recusou a troca.`);
  });

  // ---------------------------------------------------------------------------
  // Conversa na sala de espera (a mesma conversa segue na partida)
  // ---------------------------------------------------------------------------
  // A mesma conversa aparece na sala de espera e na tela do fim da partida
  const chatBoxes = [$('lobby-chat-messages'), $('end-chat-messages')].filter(Boolean);
  const EMPTY_CHAT = '<p class="lobby-chat-empty">Ninguém falou nada ainda. Mande um "buenas"!</p>';
  let chatRoom = null;
  [['lobby-chat-form', 'lobby-chat-input'], ['end-chat-form', 'end-chat-input']].forEach(([formId, inputId]) => {
    const form = $(formId);
    const input = $(inputId);
    if (!form || !input) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      socket.emit('send_chat', text);
      input.value = '';
    });
  });
  socket.on('game_state', s => {
    if (!s || s.id === chatRoom) return;
    chatRoom = s.id;
    chatBoxes.forEach(box => { box.innerHTML = EMPTY_CHAT; });
  });
  window.addEventListener('truco:left-room', () => {
    chatRoom = null;
    chatBoxes.forEach(box => { box.innerHTML = EMPTY_CHAT; });
  });
  socket.on('receive_chat', ({ sender, senderId, msg, spectator }) => {
    const mine = senderId === socket.id;
    chatBoxes.forEach(box => {
      const empty = box.querySelector('.lobby-chat-empty');
      if (empty) empty.remove();
      const div = document.createElement('div');
      div.className = `lobby-chat-msg ${mine ? 'self' : ''}`;
      div.innerHTML = `${spectator ? '<i class="fa-solid fa-eye spec-mark" title="Assistindo"></i>' : ''}<b>${escapeText(sender)}</b> ${escapeText(msg)}`;
      box.appendChild(div);
      while (box.children.length > 60) box.firstElementChild.remove();
      box.scrollTop = box.scrollHeight;
    });
    const onChatScreen = $('screen-waiting').classList.contains('active') || $('screen-game-end').classList.contains('active');
    if (!mine && onChatScreen && window.soundManager && window.soundManager.playChatPing) {
      window.soundManager.playChatPing();
    }
  });

  // ---------------------------------------------------------------------------
  // Relógio da jogada
  // ---------------------------------------------------------------------------
  const timerBox = $('turn-timer');
  const timerText = $('turn-timer-text');
  const timerFill = $('turn-timer-fill');
  let turn = null; // { idx, kind, endsAt, total }
  const KIND_TEXT = { play: 'Sua vez', truco: 'Responda o Truco', envido: 'Responda o Envido', flor: 'Responda a Flor', sing: 'Cante sua Flor' };

  function seatEl(idx) {
    if (idx == null || typeof seatOf !== 'function') return null;
    return document.getElementById(`seat-${seatOf(idx)}`);
  }

  function clearSeatTimers() {
    document.querySelectorAll('.seat-timer').forEach(el => el.remove());
  }

  function tick() {
    if (!turn) return;
    const left = Math.max(0, turn.endsAt - Date.now());
    const secs = Math.ceil(left / 1000);
    const urgent = left <= 5000;
    if (turn.idx === mySeatIndex && !(lastGameState && lastGameState.spectating)) {
      timerBox.classList.remove('hide');
      timerBox.classList.toggle('urgent', urgent);
      timerText.innerHTML = `<span class="tt-kind">${KIND_TEXT[turn.kind] || 'Sua vez'} · </span>${secs}s`;
      timerFill.style.width = `${Math.min(100, (left / turn.total) * 100)}%`;
    } else {
      timerBox.classList.add('hide');
    }
    // Contagem pequena no lugar de quem está jogando (os outros veem também)
    const seat = seatEl(turn.idx);
    if (seat) {
      let pill = seat.querySelector('.seat-timer');
      if (!pill) {
        clearSeatTimers();
        pill = document.createElement('span');
        pill.className = 'seat-timer';
        (seat.querySelector('.avatar-card') || seat).appendChild(pill);
      }
      pill.textContent = `${secs}s`;
      pill.classList.toggle('urgent', urgent);
    }
  }

  setInterval(tick, 250);

  socket.on('game_state', s => {
    if (s && s.turn && s.state === 'playing') {
      const endsAt = Date.now() + s.turn.endsIn;
      if (!turn || turn.idx !== s.turn.playerIdx || turn.kind !== s.turn.kind || Math.abs(turn.endsAt - endsAt) > 600) {
        turn = { idx: s.turn.playerIdx, kind: s.turn.kind, endsAt, total: s.turn.total };
        clearSeatTimers();
      }
      tick();
    } else {
      turn = null;
      timerBox.classList.add('hide');
      clearSeatTimers();
    }
    renderWaitNotice(s);
  });

  // ---------------------------------------------------------------------------
  // Alguém caiu: aviso para quem ficou, com o tempo para voltar
  // ---------------------------------------------------------------------------
  let waitBox = null;
  let waitList = [];
  function renderWaitNotice(s) {
    if (!waitBox) {
      waitBox = document.createElement('div');
      waitBox.className = 'wait-notice hide';
      waitBox.setAttribute('role', 'status');
      document.body.appendChild(waitBox);
    }
    const inTable = s && (s.state === 'playing' || s.state === 'hand_end' || s.state === 'lobby');
    waitInGame = !!(s && s.state !== 'lobby');
    waitList = inTable ? s.players.map((p, idx) => ({ p, idx })).filter(({ p }) => p.disconnected && !p.isBot && p.reconnectIn != null && p.id !== socket.id)
      .map(({ p, idx }) => ({ name: p.name, idx, until: Date.now() + p.reconnectIn })) : [];
    paintWait();
  }
  let waitInGame = false;
  function paintWait() {
    if (!waitBox) return;
    const live = waitList.filter(w => w.until > Date.now() - 1500);
    // Na mesa: selo pequeno no lugar de quem caiu (não cobre as falas nem as cartas)
    document.querySelectorAll('.seat-disc').forEach(el => {
      if (!waitInGame || !live.some(w => el.dataset.idx === String(w.idx))) el.remove();
    });
    if (waitInGame) {
      waitBox.classList.add('hide');
      live.forEach(w => {
        const seat = typeof seatOf === 'function' ? document.getElementById(`seat-${seatOf(w.idx)}`) : null;
        if (!seat) return;
        let b = seat.querySelector('.seat-disc');
        if (!b) {
          b = document.createElement('span');
          b.className = 'seat-disc';
          b.dataset.idx = String(w.idx);
          b.title = 'Caiu a conexão. O jogo segue: se demorar na vez, uma carta qualquer é jogada por ele.';
          seat.appendChild(b);
        }
        const left = Math.max(0, Math.ceil((w.until - Date.now()) / 1000));
        b.innerHTML = `<i class="fa-solid fa-wifi"></i> caiu · ${left}s`;
      });
      return;
    }
    // Sala de espera: aviso normal
    if (!live.length) { waitBox.classList.add('hide'); return; }
    waitBox.classList.remove('hide');
    waitBox.innerHTML = live.map(w => {
      const left = Math.max(0, Math.ceil((w.until - Date.now()) / 1000));
      return `<div><span class="wait-spin"></span> <b>${escapeText(w.name)}</b> caiu · esperando voltar <b>${left}s</b></div>`;
    }).join('');
  }
  setInterval(paintWait, 500);

  // ---------------------------------------------------------------------------
  // Eu caí: tela de reconexão
  // ---------------------------------------------------------------------------
  const overlay = $('conn-overlay');
  const title = $('conn-title');
  const text = $('conn-text');
  const reloadBtn = $('conn-reload');
  let inRoom = false;
  let lostTimer = null;
  const IN_GAME_KEY = 'truco_in_room';
  const mark = v => { try { v ? localStorage.setItem(IN_GAME_KEY, String(Date.now())) : localStorage.removeItem(IN_GAME_KEY); } catch (e) { /* sem armazenamento */ } };
  const wasInRoom = () => { try { const t = Number(localStorage.getItem(IN_GAME_KEY)); return t && Date.now() - t < 60000; } catch (e) { return false; } };

  function show(t, msg, withReload = false) {
    title.textContent = t;
    text.textContent = msg;
    reloadBtn.classList.toggle('hide', !withReload);
    overlay.classList.remove('hide');
  }
  const hide = () => overlay.classList.add('hide');

  // Marca que estou numa sala (para mostrar "voltando" se a página recarregar)
  setInterval(() => { if (inRoom) mark(true); }, 5000);
  socket.on('game_state', s => {
    if (!s || s.spectating) return;
    if (s.state === 'game_end') { inRoom = false; mark(false); return; }
    inRoom = true;
    mark(true);
  });

  socket.on('disconnect', reason => {
    if (!inRoom || reason === 'io client disconnect') return;
    show('Conexão perdida', 'Tentando reconectar... Seu lugar na mesa fica guardado por 30 segundos.');
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => {
      if (!socket.connected) show('Ainda sem conexão', 'Verifique a internet. Assim que voltar, você entra de novo na mesa.', true);
    }, 12000);
  });

  window.addEventListener('truco:rejoining', () => {
    if (inRoom || wasInRoom()) show('Voltando para a partida...', 'Conectado! Recuperando seu lugar na mesa.');
  });

  window.addEventListener('truco:rejoin', e => {
    clearTimeout(lostTimer);
    const res = e.detail || {};
    if (res.ok) {
      hide();
      if (window.trucoSocial) window.trucoSocial.toast('<i class="fa-solid fa-plug-circle-check"></i> Você voltou para a partida!', { kind: 'success', timeout: 3000 });
      return;
    }
    if (inRoom) {
      // Já estava na tela da mesa mas o lugar não existe mais
      inRoom = false;
      mark(false);
      show('Não deu para voltar', 'Você ficou fora por mais de 30 segundos e saiu da partida.', true);
      reloadBtn.innerHTML = '<i class="fa-solid fa-house"></i> Voltar ao início';
    } else {
      mark(false);
      hide();
    }
  });

  reloadBtn.addEventListener('click', () => window.location.reload());
  // Saiu de propósito: não mostrar "voltando"
  ['leave-room-btn', 'game-leave-btn', 'end-lobby-btn'].forEach(id => {
    const b = $(id);
    if (b) b.addEventListener('click', () => mark(false), true);
  });
  socket.on('kicked', () => { inRoom = false; mark(false); });
  window.addEventListener('truco:left-room', () => { inRoom = false; mark(false); hide(); });
})();
