// public/js/tournaments.js
// Campeonatos (por enquanto só para testes):
// - o admin cria pelo painel e passa o código para os jogadores;
// - o jogador digita o código em "Entrar em sala" e clica em "Participar";
// - a tela do campeonato mostra a chave (todas as séries melhor de 3),
//   o próximo confronto e o botão "Estou pronto".
// Tudo é decidido pelo servidor; aqui só mostra e manda os pedidos.
// Usa `socket`, `CLIENT_ID`, `escapeText`, `goHomeScreen` e `lastGameState` do app.js.

(() => {
  const $ = id => document.getElementById(id);
  const modal = $('modal-tour');
  const body = $('tour-body');
  const titleEl = $('tour-modal-title');
  const subEl = $('tour-modal-sub');
  const toast = (html, opts) => window.trucoSocial && window.trucoSocial.toast(html, opts);
  const esc = v => escapeText(v == null ? '' : String(v));
  const isAdmin = () => typeof isClientAdminAuthenticated !== 'undefined' && !!isClientAdminAuthenticated;

  const STATUS = {
    registration: ['Inscrições abertas', 'open'],
    checkin: ['Inscrições abertas', 'open'],
    running: ['Em andamento', 'live'],
    paused: ['Pausado', 'paused'],
    finished: ['Encerrado', 'done'],
    cancelled: ['Cancelado', 'cancelled']
  };
  const fmtDate = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtHour = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtLeft = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  let current = null;  // código aberto
  let data = null;     // último estado recebido
  let clockSkew = 0;   // servidor - navegador
  let tick = null;

  const sNow = () => Date.now() + clockSkew;
  const left = ms => Math.max(0, ms - sNow());
  const statusChip = st => { const [l, c] = STATUS[st] || [st, '']; return `<span class="tour-status ${c}">${l}</span>`; };

  // ================================================================ TELA DO CAMPEONATO
  function openTour(id) {
    current = String(id || '').toUpperCase();
    modal.classList.remove('hide');
    if (!data || data.id !== current) {
      titleEl.innerHTML = '<i class="fa-solid fa-trophy"></i> Campeonato';
      subEl.textContent = '';
      body.innerHTML = '<p class="tour-empty"><span class="wait-spin"></span> Carregando…</p>';
    }
    load();
  }

  function load() {
    if (!current) return;
    const id = current;
    socket.emit('tour:view', { id }, res => {
      if (current !== id) return;
      if (!res || res.error) {
        data = null;
        subEl.textContent = '';
        body.innerHTML = `<p class="tour-empty">${esc((res && res.error) || 'Não deu para abrir.')}</p>`;
        return;
      }
      data = res.tournament;
      clockSkew = (data.serverNow || Date.now()) - Date.now();
      render();
    });
  }

  function render() {
    const d = data;
    titleEl.innerHTML = `<i class="fa-solid fa-trophy"></i> ${esc(d.name)}`;
    subEl.innerHTML = `${statusChip(d.status)} <span>Mata-mata · todas as séries melhor de 3 · partidas até ${d.maxPoints || '?'} ${d.maxPoints === 1 ? 'ponto' : 'pontos'}</span>`;
    if (d.locked || d.restricted) {
      body.innerHTML = `<div class="tour-action"><p><i class="fa-solid fa-lock"></i> ${d.status === 'finished' || d.status === 'cancelled' ? 'Este campeonato já terminou.' : 'Este campeonato já começou.'} Só quem está jogando vê a chave.</p></div>`;
      return;
    }
    const banners = [
      d.pause ? `<div class="tour-pause"><i class="fa-solid fa-circle-pause"></i> <b>Campeonato pausado.</b> ${esc(d.pause.message)}</div>` : '',
      d.status === 'cancelled' ? `<div class="tour-pause">Campeonato cancelado.${d.cancelReason ? ' ' + esc(d.cancelReason) : ''}</div>` : '',
      d.results ? podium() : ''
    ].join('');
    const started = !!d.bracket;
    body.innerHTML = `
      ${banners}
      ${actionCard()}
      ${started ? bracketHtml() : playersHtml()}
      ${rulesLine()}`;
    startTick();
  }

  // O que o jogador precisa fazer agora (um cartão só)
  function actionCard() {
    const d = data;
    const me = d.me;
    const logged = window.trucoSocial && window.trucoSocial.isLogged && window.trucoSocial.isLogged();
    const open = ['registration', 'checkin'].includes(d.status);
    if (['finished', 'cancelled'].includes(d.status)) return '';

    if (!me) {
      if (!open) return '';
      if (!logged) return `<div class="tour-action big"><p>Entre na sua conta para participar.</p><button type="button" class="btn btn-primary btn-large" data-tour-act="login">Entrar</button></div>`;
      const full = d.registered >= d.maxPlayers;
      return `<div class="tour-action big">
        <p><b>${d.registered} de ${d.maxPlayers}</b> jogadores · começa ${fmtDate(d.startAt)}</p>
        ${full ? '<p>As vagas acabaram.</p>' : '<button type="button" class="btn btn-primary btn-large" data-tour-act="register"><i class="fa-solid fa-right-to-bracket"></i> Participar</button>'}
      </div>`;
    }
    if (open) {
      const needCheck = d.checkinRequired && !me.checkedIn;
      return `<div class="tour-action big ok">
        <p><i class="fa-solid fa-circle-check"></i> <b>Você está no campeonato!</b></p>
        <p>Começa ${fmtDate(d.startAt)}. Quando o seu confronto abrir, aparece um aviso aqui no site para você clicar em <b>Estou pronto</b>.</p>
        ${needCheck ? `<button type="button" class="btn btn-primary" data-tour-act="checkin" ${sNow() >= d.checkinOpensAt ? '' : 'disabled'}>Confirmar presença</button>` : ''}
        <button type="button" class="link-btn tour-leave" data-tour-act="unregister">Sair do campeonato</button>
      </div>`;
    }
    const m = d.me.match && d.matches[d.me.match];
    if (!m) {
      const msg = me.status === 'champion' ? '<i class="fa-solid fa-trophy"></i> Você é o campeão!'
        : ['eliminated', 'absent', 'disqualified'].includes(me.status) ? 'Você foi eliminado. Acompanhe a chave!'
          : 'Você passou! Espere o seu próximo adversário.';
      return `<div class="tour-action"><p>${msg}</p></div>`;
    }
    const mine = m.a === me.account ? 'a' : 'b';
    const other = mine === 'a' ? 'b' : 'a';
    const opp = mine === 'a' ? m.bName : m.aName;
    const series = `<span class="tour-series">Série ${m.wins[mine]} x ${m.wins[other]} · melhor de ${m.bestOf}</span>`;
    const head = `<small>${esc(d.roundNames[m.key] || m.key)}</small><b class="tour-vs">Você × ${esc(opp)}</b>${series}`;
    if (m.status === 'ready_check') {
      const iReady = m.ready[mine];
      return `<div class="tour-action next ${iReady ? 'ok' : 'urgent'}">${head}
        <p>${iReady ? 'Pronto! Esperando o adversário…' : 'Sua partida vai começar. Clique para entrar.'} <b class="tour-countdown" data-deadline="${m.readyDeadline}">${fmtLeft(left(m.readyDeadline))}</b></p>
        ${iReady ? '' : '<button type="button" class="btn btn-primary btn-large" data-tour-act="ready"><i class="fa-solid fa-play"></i> Estou pronto</button>'}
        <small class="tour-wo-note">Quem não confirmar a tempo perde o confronto.</small></div>`;
    }
    if (m.status === 'between') {
      return `<div class="tour-action next">${head}<p>Próxima partida da série em <b class="tour-countdown" data-deadline="${m.nextGameAt}">${fmtLeft(left(m.nextGameAt))}</b></p></div>`;
    }
    if (m.status === 'playing') return `<div class="tour-action next">${head}<p>Partida em andamento.</p></div>`;
    return '';
  }

  function podium() {
    const r = data.results;
    const nm = acc => esc((data.participants.find(p => p.account === acc) || {}).name || acc);
    if (!r.champion) return '<div class="tour-results"><b>Encerrado sem campeão.</b></div>';
    return `<div class="tour-results"><div class="tour-podium">
      <div class="p2"><i class="fa-solid fa-medal"></i><b>${r.runnerUp ? nm(r.runnerUp) : '—'}</b><small>Vice</small></div>
      <div class="p1"><i class="fa-solid fa-trophy"></i><b>${nm(r.champion)}</b><small>Campeão</small></div>
      <div class="p3"><i class="fa-solid fa-medal"></i><b>${r.third && r.third.length ? r.third.map(nm).join(' / ') : '—'}</b><small>3º lugar</small></div>
    </div></div>`;
  }

  // Antes de começar: quem já entrou
  function playersHtml() {
    const d = data;
    const list = d.participants || [];
    return `<section class="tb-section">
      <h3 class="tb-title">Jogadores (${list.length}/${d.maxPlayers})</h3>
      ${list.length ? `<ul class="tb-players">${list.map(p => `<li class="${d.me && d.me.account === p.account ? 'me' : ''} ${p.bot ? 'bot' : ''}"><i class="fa-solid ${p.bot ? 'fa-robot' : 'fa-user'}"></i> ${esc(p.name)}</li>`).join('')}</ul>` : '<p class="tour-empty">Ninguém entrou ainda.</p>'}
      <p class="tour-note">A chave é sorteada quando o campeonato começar.</p>
    </section>`;
  }

  // Chave: colunas por fase; cada confronto mostra a série melhor de 3
  function bracketHtml() {
    const d = data;
    const meAcc = d.me && d.me.account;
    const box = m => {
      const need = Math.ceil((m.bestOf || 3) / 2);
      const side = s => {
        const acc = m[s];
        const win = m.winner && m.winner === acc;
        const lose = m.status === 'done' && acc && !win;
        const label = acc ? esc(m[s + 'Name']) : m[s + 'Filled'] ? (m.reason === 'bye' ? '<i>passa direto</i>' : '<i>vaga vazia</i>') : '<i>a definir</i>';
        const dots = acc ? Array.from({ length: need }, (_, i) => `<span class="tm-dot ${i < m.wins[s] ? 'on' : ''}"></span>`).join('') : '';
        return `<div class="tm-side ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${acc && acc === meAcc ? 'me' : ''}">
          <span class="tm-name">${win ? '<i class="fa-solid fa-crown"></i> ' : ''}${label}</span>
          <span class="tm-dots">${dots}</span><b class="tm-score">${acc ? m.wins[s] : ''}</b></div>`;
      };
      const live = m.games.find(g => g.roomId);
      const n = m.games.length;
      const tag = m.status === 'playing' ? `<span class="tm-tag live">Ao vivo · partida ${n}</span>`
        : m.status === 'between' ? '<span class="tm-tag live">Entre partidas</span>'
          : m.status === 'ready_check' ? '<span class="tm-tag wait">Esperando os jogadores</span>'
            : m.reason === 'wo' ? '<span class="tm-tag">Venceu por W.O.</span>'
              : m.reason === 'duplo_wo' ? '<span class="tm-tag">Ninguém apareceu</span>'
                : m.reason === 'bye' ? '<span class="tm-tag">Passa direto</span>'
                  : m.status === 'done' ? '<span class="tm-tag">Finalizado</span>'
                    : '<span class="tm-tag">Melhor de 3</span>';
      return `<div class="tm ${m.status}">
        ${side('a')}${side('b')}
        <div class="tm-foot">${tag}${live ? `<button type="button" class="link-btn tm-watch" data-tour-watch="${esc(live.roomId)}"><i class="fa-solid fa-eye"></i> Assistir</button>` : ''}</div>
      </div>`;
    };
    const cols = d.bracket.rounds.map(ids => {
      const key = d.matches[ids[0]].key;
      const pairs = [];
      for (let i = 0; i < ids.length; i += 2) pairs.push(ids.slice(i, i + 2));
      return `<div class="br-col">
        <div class="br-title">${esc(d.roundNames[key] || key)}</div>
        <div class="br-body">${pairs.map(p => `<div class="br-pair ${p.length === 2 ? 'two' : 'one'}">${p.map(id => `<div class="br-slot">${box(d.matches[id])}</div>`).join('')}</div>`).join('')}</div>
      </div>`;
    }).join('');
    const champ = d.results && d.results.champion ? (d.participants.find(p => p.account === d.results.champion) || {}).name : null;
    const champCol = `<div class="br-col br-champ"><div class="br-title">Campeão</div>
      <div class="br-body"><div class="tm-champ ${champ ? 'has' : ''}"><i class="fa-solid fa-trophy"></i><b>${champ ? esc(champ) : '?'}</b></div></div></div>`;
    const third = d.matches['3P'] ? `<div class="br-third"><div class="br-title">${esc(d.roundNames['3P'])}</div>${box(d.matches['3P'])}</div>` : '';
    return `<section class="tb-section">
      <div class="bracket-wrap tb-bracket"><div class="bracket">${cols}${champCol}</div>${third}</div>
      <p class="tour-note tb-hint"><span class="tm-dot on"></span> = partida vencida. Quem ganhar 2 partidas avança.</p>
    </section>`;
  }

  function rulesLine() {
    const t = data.timers || {};
    return `<p class="tour-note tb-rules">Ao abrir o seu confronto você tem ${(t.readyMs || 180000) < 60000 ? `${Math.round((t.readyMs || 0) / 1000)} segundos` : `${Math.round((t.readyMs || 180000) / 60000)} min`} para clicar em <b>Estou pronto</b>; quem não clicar perde o confronto. Entre uma partida e outra da série há uma pausa curta.</p>`;
  }

  function startTick() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (modal.classList.contains('hide')) { clearInterval(tick); return; }
      body.querySelectorAll('[data-deadline]').forEach(el => { el.textContent = fmtLeft(left(Number(el.dataset.deadline))); });
    }, 500);
  }

  // ---------------------------------------------------------------- ações
  body.addEventListener('click', e => {
    const w = e.target.closest('[data-tour-watch]');
    if (w) {
      socket.emit('spectate:join', { roomId: w.dataset.tourWatch, name: (typeof usernameInput !== 'undefined' && usernameInput.value) || '' }, res => {
        if (res && res.error) toast(esc(res.error));
        else modal.classList.add('hide');
      });
      return;
    }
    const act = e.target.closest('[data-tour-act]');
    if (!act) return;
    const a = act.dataset.tourAct;
    if (a === 'login') { window.trucoSocial.openAuth('login'); return; }
    const ev = { register: 'tour:register', unregister: 'tour:unregister', checkin: 'tour:checkin', ready: 'tour:ready' }[a];
    if (!ev) return;
    if (a === 'unregister' && !confirm('Sair deste campeonato?')) return;
    act.disabled = true;
    const payload = { id: current, clientId: CLIENT_ID };
    if (a === 'ready') payload.matchId = data.me && data.me.match;
    socket.emit(ev, payload, res => {
      act.disabled = false;
      if (res && res.error) toast(`<i class="fa-solid fa-circle-exclamation"></i> ${esc(res.error)}`);
      else if (a === 'register') toast('<i class="fa-solid fa-check"></i> Você entrou no campeonato!');
      load();
    });
  });

  // Atualizações em tempo real
  let reloadTimer = null;
  socket.on('tour:changed', ({ id }) => {
    if (!modal.classList.contains('hide') && current === id) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 200);
    }
    if (adminBox && !$('modal-admin-panel').classList.contains('hide')) adminLoadSoon();
  });

  // Avisos do campeonato
  socket.on('tour:notify', n => {
    if (window.soundManager && window.soundManager.playChatPing) window.soundManager.playChatPing();
    const actions = [{ label: 'Ver chave', primary: n.type !== 'match_ready', onClick: () => openTour(n.tid) }];
    if (n.type === 'match_ready') {
      actions.unshift({ label: 'Estou pronto', primary: true, onClick: () => socket.emit('tour:ready', { id: n.tid, matchId: n.matchId, clientId: CLIENT_ID }, res => { if (res && res.error) toast(esc(res.error)); }) });
    }
    toast(`<i class="fa-solid fa-trophy"></i> ${esc(n.message)}`, { key: `tour-${n.tid}-${n.type}`, timeout: n.type === 'match_ready' ? 0 : 9000, kind: n.type === 'match_ready' ? 'invite' : '', actions });
    if (n.type === 'match_ready' && current === n.tid) load();
  });

  // Código do campeonato digitado em "Entrar em sala"
  socket.on('tour:open', ({ id }) => {
    const input = $('join-room-id');
    if (input) input.value = '';
    openTour(id);
  });
  socket.on('tour:need_login', () => {
    toast('<i class="fa-solid fa-trophy"></i> Para entrar no campeonato você precisa de uma conta. Entre ou crie a sua.');
    if (window.trucoSocial && window.trucoSocial.openAuth) window.trucoSocial.openAuth('login');
  });

  // Partida de campeonato acabou: volta para a chave
  socket.on('tour:back', ({ tid }) => {
    bar.classList.add('hide');
    inTourGame = null;
    if (typeof goHomeScreen === 'function') goHomeScreen();
    if (tid) openTour(tid);
  });

  // Na mesa: barra com o confronto e o placar da série; pausa em destaque
  const bar = document.createElement('div');
  bar.className = 'tour-game-bar hide';
  document.body.appendChild(bar);
  let inTourGame = null;
  socket.on('game_state', s => {
    const info = s && s.tournament;
    document.body.classList.toggle('tour-game', !!info);
    if (!info || s.state === 'lobby') { bar.classList.add('hide'); inTourGame = null; return; }
    // Entrou na mesa: fecha a tela do campeonato e o aviso de "Estou pronto"
    const key = `${info.tid}:${info.matchId || info.label}:${info.n || ''}`;
    if (inTourGame !== key) {
      inTourGame = key;
      modal.classList.add('hide');
      if (window.trucoSocial && window.trucoSocial.dismissToast) window.trucoSocial.dismissToast(`tour-${info.tid}-match_ready`);
    }
    const series = info.series ? ` · série ${info.series.a} x ${info.series.b} (melhor de ${info.bestOf})` : '';
    bar.className = `tour-game-bar ${info.paused ? 'paused' : ''}`;
    bar.innerHTML = info.paused
      ? `<i class="fa-solid fa-circle-pause"></i> <b>Campeonato pausado.</b> ${esc(info.pauseMessage || '')}`
      : `<i class="fa-solid fa-trophy"></i> ${esc(info.name)} · ${esc(info.label)}${series}`;
  });

  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => modal.classList.add('hide')));

  // ================================================================ ADMIN
  const adminBox = $('admin-tour');
  let adminEditing = null;
  let lastCreated = null;
  let adminTimer = null;
  const adminLoadSoon = () => { clearTimeout(adminTimer); adminTimer = setTimeout(adminLoad, 300); };
  const toLocalInput = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  function adminLoad() {
    if (!adminBox) return;
    socket.emit('tour:list', {}, res => {
      const items = (res && res.items) || [];
      const created = lastCreated ? `
        <div class="tadm-created">
          <p><i class="fa-solid fa-circle-check"></i> <b>Campeonato criado!</b> Passe este código para os jogadores:</p>
          <div class="tadm-created-code"><b>${esc(lastCreated)}</b><button type="button" class="btn btn-sm btn-secondary" data-tadm="copy" data-id="${esc(lastCreated)}"><i class="fa-regular fa-copy"></i> Copiar</button></div>
          <p class="tour-note">Eles digitam o código em <b>Entrar em sala</b> e clicam em <b>Participar</b> (precisa ter conta).</p>
        </div>` : '';
      adminBox.innerHTML = `
        <div class="admin-games-head"><span>Campeonatos</span><button type="button" class="btn btn-sm btn-primary" data-tadm="new"><i class="fa-solid fa-plus"></i> Criar campeonato</button></div>
        <div id="tadm-form-wrap"></div>
        ${created}
        <ul class="tadm-list">${items.map(t => {
          const open = ['registration', 'checkin'].includes(t.status);
          return `<li class="tadm-item">
            <div class="tadm-item-head"><b>${esc(t.name)}</b> ${statusChip(t.status)}</div>
            <div class="tadm-item-meta">
              <span>Código <b class="tadm-code">${esc(t.id)}</b> <button type="button" class="link-btn" data-tadm="copy" data-id="${t.id}" aria-label="Copiar código"><i class="fa-regular fa-copy"></i></button></span>
              <span><i class="fa-solid fa-users"></i> ${t.registered}/${t.maxPlayers}</span>
              ${open ? `<span><i class="fa-regular fa-clock"></i> começa ${fmtDate(t.startAt)}</span>` : ''}
            </div>
            <div class="tadm-actions">
              <button type="button" class="btn btn-sm btn-primary" data-tadm="view" data-id="${t.id}"><i class="fa-solid fa-sitemap"></i> Ver chave</button>
              ${open ? `<button type="button" class="btn btn-sm btn-success" data-tadm="start" data-id="${t.id}"><i class="fa-solid fa-play"></i> Começar agora</button>` : ''}
              ${open && t.registered < t.maxPlayers ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="add_bot" data-id="${t.id}"><i class="fa-solid fa-robot"></i> +1 bot</button>
                <button type="button" class="btn btn-sm btn-secondary" data-tadm="fill_bots" data-id="${t.id}" data-free="${t.maxPlayers - t.registered}"><i class="fa-solid fa-robot"></i> Completar com bots</button>` : ''}
              ${t.status === 'running' ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="pause" data-id="${t.id}">Pausar</button>` : ''}
              ${t.status === 'paused' ? `<button type="button" class="btn btn-sm btn-primary" data-tadm="resume" data-id="${t.id}">Retomar</button>` : ''}
              <details class="tadm-more"><summary>Mais</summary><div class="tadm-actions">
                ${open ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="edit" data-id="${t.id}">Editar</button>
                  <button type="button" class="btn btn-sm btn-secondary" data-tadm="remove_bots" data-id="${t.id}">Tirar os bots</button>` : ''}
                ${['running', 'paused'].includes(t.status) ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="finish" data-id="${t.id}">Encerrar agora</button>` : ''}
                ${!['finished', 'cancelled'].includes(t.status) ? `<button type="button" class="btn btn-sm btn-secondary" data-tadm="multi" data-id="${t.id}">Contas suspeitas</button>
                  <button type="button" class="btn btn-sm btn-secondary" data-tadm="cancel" data-id="${t.id}">Cancelar campeonato</button>` : ''}
                <button type="button" class="btn btn-sm btn-danger" data-tadm="delete" data-id="${t.id}"><i class="fa-solid fa-trash"></i> Apagar campeonato</button>
              </div></details>
            </div>
            <div class="tadm-extra" id="tadm-extra-${t.id}"></div>
          </li>`;
        }).join('') || '<li class="tour-empty">Nenhum campeonato ainda. Clique em "Criar campeonato".</li>'}</ul>`;
    });
  }

  function formHtml(t) {
    const start = t ? t.startAt : Math.ceil((Date.now() + 30 * 60000) / 300000) * 300000;
    const size = t ? t.maxPlayers : 8;
    const pts = t ? t.maxPoints : 24;
    return `<form class="tadm-form simple" id="tadm-form" autocomplete="off">
      <h4>${t ? 'Editar campeonato' : 'Novo campeonato'}</h4>
      <label>Nome do campeonato<input name="name" maxlength="60" value="${esc(t ? t.name : '')}" placeholder="Ex.: Copa do Galpão" required></label>
      <div class="tadm-field"><span>Quantos jogadores?</span>
        <div class="tadm-seg">${[4, 8, 16, 32].map(n => `<label><input type="radio" name="maxPlayers" value="${n}" ${size === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
      </div>
      <div class="tadm-field"><span>Cada partida vai até</span>
        <div class="tadm-seg">${[12, 24, 30].map(n => `<label><input type="radio" name="maxPoints" value="${n}" ${pts === n ? 'checked' : ''}><span>${n} pontos</span></label>`).join('')}</div>
      </div>
      <label>Começa em<input name="startAt" type="datetime-local" value="${toLocalInput(start)}" required>
        <small>Se todo mundo entrar antes, você pode clicar em "Começar agora".</small></label>
      <label class="tadm-check"><input type="checkbox" name="thirdPlace" ${!t || t.thirdPlace ? 'checked' : ''}> Ter disputa de 3º lugar</label>
      <p class="tour-note"><i class="fa-solid fa-circle-info"></i> Todas as séries são <b>melhor de 3</b>: quem ganhar 2 partidas avança.</p>
      <p class="form-msg" id="tadm-msg"></p>
      <div class="tadm-actions"><button type="submit" class="btn btn-primary">${t ? 'Salvar' : 'Criar campeonato'}</button><button type="button" class="link-btn" data-tadm="close-form">Cancelar</button></div>
    </form>`;
  }

  function readForm(f) {
    const g = n => f.elements[n];
    const startAt = new Date(g('startAt').value).getTime();
    return {
      name: g('name').value,
      description: '',
      maxPlayers: Number(f.querySelector('[name="maxPlayers"]:checked').value),
      maxPoints: Number(f.querySelector('[name="maxPoints"]:checked').value),
      startAt,
      endAt: startAt + 12 * 3600000,
      allowEarlyStart: true,
      isPrivate: false,
      checkinRequired: false,
      thirdPlace: g('thirdPlace').checked,
      woEndsSeries: true,
      bestOf: { default: 3, byRound: {} },
      deadlinePolicy: 'finish_running'
    };
  }

  function copyCode(code) {
    const done = () => toast(`Código <b>${esc(code)}</b> copiado.`);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => prompt('Copie o código:', code));
    else prompt('Copie o código:', code);
  }

  if (adminBox) {
    adminBox.addEventListener('click', e => {
      const b = e.target.closest('[data-tadm]');
      if (!b) return;
      const id = b.dataset.id;
      const act = b.dataset.tadm;
      const wrap = $('tadm-form-wrap');
      if (act === 'new') { adminEditing = null; lastCreated = null; wrap.innerHTML = formHtml(null); wrap.querySelector('input[name="name"]').focus(); return; }
      if (act === 'close-form') { wrap.innerHTML = ''; return; }
      if (act === 'copy') return copyCode(id);
      if (act === 'edit') {
        socket.emit('tour:view', { id }, res => { if (res && res.ok) { adminEditing = id; wrap.innerHTML = formHtml(res.tournament); wrap.scrollIntoView({ block: 'nearest' }); } });
        return;
      }
      if (act === 'view') { $('modal-admin-panel').classList.add('hide'); openTour(id); return; }
      if (act === 'multi') return showMulti(id);
      const extra = {};
      let action = act;
      if (act === 'add_bot') { action = 'add_bots'; extra.count = 1; }
      if (act === 'fill_bots') { action = 'add_bots'; extra.count = Number(b.dataset.free) || 1; }
      if (act === 'delete' && !confirm('Apagar este campeonato de vez? A chave e os resultados somem e as partidas abertas são encerradas.')) return;
      if (act === 'remove_bots' && !confirm('Tirar todos os bots deste campeonato?')) return;
      if (act === 'pause') { const m = prompt('Mensagem para os jogadores:', 'Campeonato pausado por um instante.'); if (m === null) return; extra.message = m; }
      if (act === 'cancel') { const m = prompt('Cancelar o campeonato? Escreva o motivo:'); if (m === null) return; extra.message = m; }
      if (act === 'start' && !confirm('Começar o campeonato agora com quem já entrou?')) return;
      if (act === 'finish' && !confirm('Encerrar agora? Se a final não terminou, fica sem campeão.')) return;
      socket.emit('tour:admin_action', { id, action, ...extra }, res => {
        toast(esc(res && res.error ? res.error : (res && res.message) || 'Feito.'));
        if (act === 'delete' && lastCreated === id) lastCreated = null;
        adminLoad();
      });
    });
    adminBox.addEventListener('submit', e => {
      if (e.target.id !== 'tadm-form') return;
      e.preventDefault();
      const payload = readForm(e.target);
      const ev = adminEditing ? 'tour:admin_update' : 'tour:admin_create';
      if (adminEditing) payload.id = adminEditing;
      socket.emit(ev, payload, res => {
        const msg = $('tadm-msg');
        if (res && res.error) { msg.textContent = res.error; msg.className = 'form-msg error'; return; }
        if (adminEditing) toast('Campeonato salvo.');
        else lastCreated = res.id;
        adminEditing = null;
        adminLoad();
      });
    });
  }

  function showMulti(id) {
    const box = $('tadm-extra-' + id);
    socket.emit('tour:admin_multi', { id }, res => {
      if (!res || res.error) { box.innerHTML = `<p>${esc((res && res.error) || 'Erro')}</p>`; return; }
      box.innerHTML = `
        <div class="tadm-multi">
          <p class="tour-note">Contas que jogaram da mesma rede ou do mesmo aparelho. Isso não prova fraude (pode ser a mesma casa): analise antes de decidir.</p>
          ${res.pairs.length ? `<ul>${res.pairs.map(p => `
            <li class="lvl-${p.level}"><b>${esc(p.names.join(' + '))}</b>
              <span>${p.sameDevice ? `mesmo aparelho (${p.sameDevice}x)` : ''} ${p.sameIp ? `mesma rede (${p.sameIp}x)` : ''}</span>
              <span class="tadm-actions">
                <button type="button" class="btn btn-sm btn-secondary" data-mdec="ok" data-acc="${esc(p.accounts.join(','))}">Está tudo bem</button>
                <button type="button" class="btn btn-sm btn-danger" data-mdq="${esc(p.accounts[1])}">Desclassificar ${esc(p.names[1])}</button>
              </span></li>`).join('')}</ul>` : '<p>Nada suspeito.</p>'}
        </div>`;
      box.onclick = e => {
        const dec = e.target.closest('[data-mdec]');
        const dq = e.target.closest('[data-mdq]');
        if (dec) {
          const note = prompt('Anotação (opcional):', '');
          if (note === null) return;
          socket.emit('tour:admin_decide', { id, accounts: dec.dataset.acc.split(','), decision: dec.dataset.mdec, note }, () => showMulti(id));
        } else if (dq) {
          const note = prompt('Motivo da desclassificação:');
          if (!note) return;
          socket.emit('tour:admin_disqualify', { id, account: dq.dataset.mdq, note }, res2 => { toast(esc(res2 && res2.error ? res2.error : 'Desclassificado.')); showMulti(id); });
        }
      };
    });
  }

  window.trucoTournaments = { openTour, adminLoad };
})();
