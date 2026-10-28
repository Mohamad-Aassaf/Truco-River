// public/js/reports.js
// Botão "Bug ou sugestão": o jogador manda título, descrição e um print opcional.
// No Painel Admin, a aba "Relatos" lista tudo para o admin ler e resolver.
// Usa `socket`, `usernameInput` e `isClientAdminAuthenticated` do app.js.

(() => {
  const $ = id => document.getElementById(id);
  const modal = $('modal-report');
  if (!modal) return;

  const escapeHtml = text => String(text == null ? '' : text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const toast = (html, opts) => window.trucoSocial && window.trucoSocial.toast(html, opts);

  // ---------------------------------------------------------------------------
  // Formulário do jogador
  // ---------------------------------------------------------------------------
  const form = $('report-form');
  const fTitle = $('report-title');
  const fDesc = $('report-desc');
  const fFile = $('report-file');
  const drop = $('report-drop');
  const preview = $('report-preview');
  const msg = $('report-msg');
  const submit = $('report-submit');
  const done = $('report-done');
  let kind = 'bug';
  let imageData = null;

  const PLACEHOLDERS = {
    bug: { title: 'Ex: As cartas somem depois do Truco', desc: 'O que aconteceu? O que você estava fazendo? Acontece sempre?' },
    sugestao: { title: 'Ex: Ter um modo de torneio', desc: 'Conte a sua ideia e como ela deixaria o jogo melhor.' }
  };

  function setKind(k) {
    kind = k;
    modal.querySelectorAll('[data-report-kind]').forEach(b => {
      const on = b.dataset.reportKind === k;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    fTitle.placeholder = PLACEHOLDERS[k].title;
    fDesc.placeholder = PLACEHOLDERS[k].desc;
    modal.classList.toggle('is-suggestion', k === 'sugestao');
  }

  modal.querySelectorAll('[data-report-kind]').forEach(b => b.addEventListener('click', () => setKind(b.dataset.reportKind)));

  const setMsg = (text, ok) => {
    msg.textContent = text || '';
    msg.className = `form-msg ${ok ? 'ok' : 'error'}`;
  };

  // Reduz o print no navegador (até ~1600px, JPEG) para enviar rápido
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Use uma imagem PNG, JPG, WEBP ou GIF.'));
      if (file.size > 15 * 1024 * 1024) return reject(new Error('Imagem muito grande (máximo 15 MB).'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let max = 1600;
        let quality = 0.82;
        let data = '';
        for (let i = 0; i < 6; i++) {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          data = canvas.toDataURL('image/jpeg', quality);
          if (data.length < 850 * 1024) return resolve(data);
          max = Math.round(max * 0.8);
          quality = Math.max(0.55, quality - 0.08);
        }
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não deu para abrir essa imagem.')); };
      img.src = url;
    });
  }

  async function useFile(file) {
    if (!file) return;
    setMsg('Preparando a imagem...', true);
    try {
      imageData = await compressImage(file);
      preview.src = imageData;
      drop.classList.add('has-image');
      setMsg('');
    } catch (err) {
      clearImage();
      setMsg(err.message);
    }
  }

  function clearImage() {
    imageData = null;
    preview.removeAttribute('src');
    fFile.value = '';
    drop.classList.remove('has-image');
  }

  fFile.addEventListener('change', () => useFile(fFile.files[0]));
  $('report-remove-img').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearImage(); });
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fFile.click(); } });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', e => useFile(e.dataTransfer.files[0]));
  // Colar um print (Ctrl+V) com a janela aberta
  document.addEventListener('paste', e => {
    if (modal.classList.contains('hide')) return;
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); useFile(item.getAsFile()); }
  });

  function context() {
    const screen = document.body.getAttribute('data-screen') || '';
    return {
      screen,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      device: navigator.userAgent,
      deck: document.body.getAttribute('data-deck-style') || ''
    };
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const title = fTitle.value.trim();
    const description = fDesc.value.trim();
    if (title.length < 3) return setMsg('Escreva um título (pelo menos 3 letras).');
    if (description.length < 5) return setMsg('Conte um pouco mais na descrição.');

    submit.disabled = true;
    submit.classList.add('loading');
    const timer = setTimeout(() => finish({ error: 'O servidor não respondeu. Tente de novo.' }), 20000);
    function finish(res) {
      clearTimeout(timer);
      submit.disabled = false;
      submit.classList.remove('loading');
      if (!res || res.error) return setMsg((res && res.error) || 'Erro ao enviar.');
      form.classList.add('hide');
      done.classList.remove('hide');
    }
    socket.emit('report:send', {
      kind, title, description, image: imageData, context: context(),
      name: typeof usernameInput !== 'undefined' ? usernameInput.value : ''
    }, finish);
  });

  function resetForm() {
    form.reset();
    clearImage();
    setKind('bug');
    setMsg('');
    form.classList.remove('hide');
    done.classList.add('hide');
  }

  $('report-again').addEventListener('click', resetForm);

  function openReport() {
    if (!done.classList.contains('hide')) resetForm();
    const settings = $('modal-mobile-settings');
    if (settings) settings.classList.add('hide');
    modal.classList.remove('hide');
    if (window.matchMedia('(pointer: fine)').matches) setTimeout(() => fTitle.focus(), 60);
  }

  const close = () => modal.classList.add('hide');
  $('open-report-btn').addEventListener('click', openReport);
  const settingsBtn = $('settings-report-btn');
  if (settingsBtn) settingsBtn.addEventListener('click', openReport);
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', close));
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });

  // ---------------------------------------------------------------------------
  // Painel admin: aba Relatos
  // ---------------------------------------------------------------------------
  const list = $('admin-reports-list');
  const countEl = $('admin-reports-count');
  const viewer = $('image-viewer');
  const viewerImg = $('image-viewer-img');
  let items = [];
  let filterKind = 'all';
  let filterStatus = 'aberto';
  const KIND = {
    bug: { label: 'Bug', icon: 'fa-bug' },
    sugestao: { label: 'Sugestão', icon: 'fa-lightbulb' }
  };
  const fmt = ts => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const SCREENS = { home: 'tela inicial', lobby: 'sala de espera', game: 'partida', game_end: 'fim de jogo' };

  // Navegador/aparelho resumido a partir do userAgent
  function deviceLabel(ua) {
    const u = String(ua || '');
    const os = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '';
    const br = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : '';
    return [br, os].filter(Boolean).join(' · ') || 'desconhecido';
  }

  function setCount(open) {
    if (!countEl) return;
    countEl.textContent = open > 99 ? '99+' : String(open);
    countEl.classList.toggle('hide', !open);
  }

  function render() {
    const shown = items.filter(r => (filterKind === 'all' || r.kind === filterKind)
      && (filterStatus === 'all' || r.status === filterStatus));
    if (!shown.length) {
      list.innerHTML = `<li class="news-empty"><i class="fa-solid fa-mug-hot"></i> Nenhum relato ${filterStatus === 'aberto' ? 'aberto' : 'aqui'}.</li>`;
      return;
    }
    list.innerHTML = shown.map(r => {
      const k = KIND[r.kind] || KIND.bug;
      const c = r.context || {};
      return `
        <li class="report-item kind-${r.kind} ${r.status === 'resolvido' ? 'resolved' : ''}" data-id="${escapeHtml(r.id)}">
          <div class="news-meta">
            <span class="report-chip kind-${r.kind}"><i class="fa-solid ${k.icon}"></i> ${k.label}</span>
            ${r.status === 'resolvido' ? '<span class="report-chip done"><i class="fa-solid fa-check"></i> Resolvido</span>' : ''}
            <time>${fmt(r.date)}</time>
          </div>
          <h4>${escapeHtml(r.title)}</h4>
          <p class="report-desc">${escapeHtml(r.description)}</p>
          <div class="report-info">
            <span><i class="fa-solid fa-user"></i> ${escapeHtml(r.author ? r.author.name : '?')}${r.author && r.author.account ? ' (conta)' : ''}</span>
            <span><i class="fa-solid fa-display"></i> ${escapeHtml(SCREENS[c.screen] || c.screen || '?')} · ${escapeHtml(c.viewport || '')}</span>
            <span><i class="fa-solid fa-mobile-screen"></i> ${escapeHtml(deviceLabel(c.device))}</span>
          </div>
          <div class="report-actions">
            ${r.hasImage ? '<button type="button" class="btn btn-sm btn-secondary" data-act="image"><i class="fa-solid fa-image"></i> Ver imagem</button>' : ''}
            <button type="button" class="btn btn-sm ${r.status === 'resolvido' ? 'btn-secondary' : 'btn-success'}" data-act="status">
              ${r.status === 'resolvido' ? '<i class="fa-solid fa-rotate-left"></i> Reabrir' : '<i class="fa-solid fa-check"></i> Resolvido'}
            </button>
            <button type="button" class="icon-btn small danger" data-act="delete" title="Apagar" aria-label="Apagar"><i class="fa-solid fa-trash"></i></button>
          </div>
        </li>`;
    }).join('');
  }

  function load() {
    if (typeof isClientAdminAuthenticated !== 'undefined' && !isClientAdminAuthenticated) return;
    socket.emit('reports:list', {}, res => {
      if (!res || res.error) return;
      items = res.items || [];
      setCount(res.open || 0);
      render();
    });
  }

  function bindFilter(groupId, attr, set) {
    const group = $(groupId);
    group.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      group.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      set(b.dataset[attr]);
      render();
    }));
  }
  bindFilter('reports-kind-filter', 'kind', v => { filterKind = v; });
  bindFilter('reports-status-filter', 'status', v => { filterStatus = v; });

  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const item = btn.closest('.report-item');
    const id = item.dataset.id;
    const r = items.find(x => x.id === id);
    if (!r) return;
    if (btn.dataset.act === 'image') {
      btn.disabled = true;
      socket.emit('reports:image', { id }, res => {
        btn.disabled = false;
        if (!res || res.error) return toast('Não deu para abrir a imagem.', { kind: 'warn' });
        viewerImg.src = res.image;
        viewer.classList.remove('hide');
      });
    } else if (btn.dataset.act === 'status') {
      socket.emit('reports:status', { id, status: r.status === 'resolvido' ? 'aberto' : 'resolvido' }, load);
    } else if (btn.dataset.act === 'delete') {
      if (!confirm(`Apagar o relato "${r.title}"?`)) return;
      socket.emit('reports:delete', { id }, load);
    }
  });

  const closeViewer = () => { viewer.classList.add('hide'); viewerImg.removeAttribute('src'); };
  viewer.addEventListener('click', closeViewer);

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!viewer.classList.contains('hide')) closeViewer();
    else if (!modal.classList.contains('hide')) close();
  });

  // Relato novo chegando com o admin logado
  socket.on('reports:new', ({ item, open }) => {
    if (!item) return;
    items.unshift(item);
    setCount(open);
    render();
    const k = KIND[item.kind] || KIND.bug;
    toast(`<i class="fa-solid ${k.icon}"></i> <b>Novo relato (${k.label}):</b> ${escapeHtml(item.title)}`, { timeout: 7000 });
  });

  // Abrir a aba Relatos recarrega a lista
  const tab = document.querySelector('[data-admin-tab="reports"]');
  if (tab) tab.addEventListener('click', load);

  window.trucoReports = { load };
})();
