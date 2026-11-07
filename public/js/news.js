// public/js/news.js
// Painel de Novidades (todos veem) e o gerenciamento delas no Painel Admin.
// Usa `socket` do app.js.

(() => {
  const SEEN_KEY = 'truco_news_seen';
  const TAGS = {
    novidade: { label: 'Novidade', icon: 'fa-star' },
    melhoria: { label: 'Melhoria', icon: 'fa-arrow-trend-up' },
    correcao: { label: 'Correção', icon: 'fa-screwdriver-wrench' },
    evento: { label: 'Evento', icon: 'fa-calendar-day' },
    aviso: { label: 'Aviso', icon: 'fa-triangle-exclamation' }
  };

  const $ = id => document.getElementById(id);
  const modal = $('modal-news');
  const list = $('news-list');
  const dot = $('news-dot');
  let items = [];
  let firstLoad = true;

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } }
  };

  const escapeHtml = text => String(text == null ? '' : text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  // Texto da notícia: escapa tudo e transforma quebras de linha em parágrafos
  const bodyHtml = text => escapeHtml(text).split(/\n{2,}|\n/).map(l => `<p>${l}</p>`).join('');

  const fmtDate = ts => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

  // As imagens ficam no servidor do jogo (no site da Vercel, o servidor é outro endereço)
  const MEDIA_BASE = window.location.hostname.includes('vercel.app') ? 'https://truco-river.onrender.com' : '';
  const mediaUrl = id => `${MEDIA_BASE}/news-media/${encodeURIComponent(id)}`;

  function mediaHtml(images) {
    if (!images || !images.length) return '';
    return `<div class="news-media n${Math.min(images.length, 4)}">${images.map(id => `
      <button type="button" class="news-shot" data-zoom="${escapeHtml(id)}" aria-label="Ampliar imagem">
        <img loading="lazy" src="${mediaUrl(id)}" alt="">
      </button>`).join('')}</div>`;
  }

  const latest = () => items.reduce((m, it) => Math.max(m, it.date || 0), 0);
  const seenUntil = () => Number(storage.get(SEEN_KEY) || 0);

  const unseenCount = () => items.filter(it => (it.date || 0) > seenUntil()).length;

  // Contador no botão Novidades, no item de Ajustes e uma bolinha nas engrenagens
  function updateDot() {
    const count = unseenCount();
    const label = count > 9 ? '9+' : String(count);
    if (dot) {
      dot.textContent = label;
      dot.classList.toggle('hide', count === 0);
    }
    const newsBtn = $('open-news-btn');
    if (newsBtn) {
      newsBtn.classList.toggle('has-new', count > 0);
      newsBtn.title = count ? `${count} ${count === 1 ? 'novidade nova' : 'novidades novas'}` : 'Novidades';
    }
    const settingsCount = $('settings-news-count');
    if (settingsCount) {
      settingsCount.textContent = label;
      settingsCount.classList.toggle('hide', count === 0);
    }
    ['mobile-settings-toggle-btn', 'mobile-settings-toggle-btn-desktop'].forEach(id => {
      const gear = $(id);
      if (!gear) return;
      let pip = gear.querySelector('.gear-pip');
      if (!pip) {
        pip = document.createElement('span');
        pip.className = 'gear-pip';
        gear.appendChild(pip);
      }
      pip.classList.toggle('hide', count === 0);
    });
  }

  // Ao abrir o site com novidades não lidas: um aviso (depois da janela de conta)
  let welcomeShown = false;
  function showWelcomeToast() {
    const count = unseenCount();
    if (welcomeShown || !count || !window.trucoSocial) return;
    const lobby = document.getElementById('screen-lobby');
    const auth = document.getElementById('modal-auth');
    if (!lobby || !lobby.classList.contains('active')) return;
    if (auth && !auth.classList.contains('hide')) {
      // Espera a pessoa fechar a janela de conta
      const obs = new MutationObserver(() => {
        if (auth.classList.contains('hide')) { obs.disconnect(); setTimeout(showWelcomeToast, 500); }
      });
      obs.observe(auth, { attributes: true, attributeFilter: ['class'] });
      return;
    }
    welcomeShown = true;
    const newest = items.filter(it => (it.date || 0) > seenUntil()).sort((a, b) => b.date - a.date)[0];
    const text = count === 1
      ? `<b>Novidade:</b> ${escapeHtml(newest.title)}`
      : `<b>${count} novidades</b> para ler — a mais nova: ${escapeHtml(newest.title)}`;
    window.trucoSocial.toast(`<i class="fa-solid fa-bullhorn"></i> ${text}`, {
      timeout: 10000,
      kind: 'invite',
      key: 'news-welcome',
      actions: [{ label: 'Ler agora', primary: true, onClick: openNews }, { label: 'Depois' }]
    });
  }

  function tagChip(tag) {
    const t = TAGS[tag] || TAGS.novidade;
    return `<span class="news-tag tag-${escapeHtml(tag)}"><i class="fa-solid ${t.icon}"></i> ${t.label}</span>`;
  }

  function renderList() {
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<li class="news-empty"><i class="fa-solid fa-mug-hot"></i> Nenhuma novidade por enquanto.</li>';
      return;
    }
    const seen = seenUntil();
    list.innerHTML = items.map((it, i) => `
      <li class="news-item tag-${escapeHtml(it.tag)} ${it.pinned ? 'pinned' : ''} ${it.date > seen ? 'unseen' : ''}" style="--i:${i}">
        ${mediaHtml(it.images)}
        <div class="news-content">
          <div class="news-meta">
            ${tagChip(it.tag)}
            ${it.pinned ? '<span class="news-pinned"><i class="fa-solid fa-thumbtack"></i> Fixada</span>' : ''}
            ${it.date > seen ? '<span class="news-new">Nova</span>' : ''}
            <time>${fmtDate(it.date)}</time>
          </div>
          <h3>${escapeHtml(it.title)}</h3>
          ${it.body ? `<div class="news-body">${bodyHtml(it.body)}</div>` : ''}
        </div>
      </li>`).join('');
  }

  function openNews() {
    if (window.trucoSocial && window.trucoSocial.dismissToast) window.trucoSocial.dismissToast('news-welcome');
    renderList();
    modal.classList.remove('hide');
    // Marca como lidas depois de abrir (o "Nova" fica visível nesta abertura)
    storage.set(SEEN_KEY, String(latest()));
    updateDot();
  }

  $('open-news-btn').addEventListener('click', openNews);
  const settingsBtn = $('settings-news-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const settings = $('modal-mobile-settings');
      if (settings) settings.classList.add('hide');
      openNews();
    });
  }
  modal.addEventListener('mousedown', e => { if (e.target === modal) modal.classList.add('hide'); });

  // Imagem ampliada
  const lightbox = $('news-lightbox');
  list.addEventListener('click', e => {
    const shot = e.target.closest('[data-zoom]');
    if (!shot) return;
    lightbox.querySelector('img').src = mediaUrl(shot.dataset.zoom);
    lightbox.classList.remove('hide');
  });
  lightbox.addEventListener('click', () => lightbox.classList.add('hide'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !lightbox.classList.contains('hide')) { e.stopImmediatePropagation(); lightbox.classList.add('hide'); }
  }, true);
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => modal.classList.add('hide')));

  // ---------------------------------------------------------------------------
  // Admin: criar, editar, apagar
  // ---------------------------------------------------------------------------
  const form = $('news-form');
  const fId = $('news-id');
  const fTitle = $('news-title');
  const fTag = $('news-tag');
  const fBody = $('news-body');
  const fPinned = $('news-pinned');
  const fMsg = $('news-form-msg');
  const fHead = $('news-form-title');
  const fCancel = $('news-cancel-edit');
  const fSubmit = $('news-submit');
  const adminList = $('admin-news-list');
  const fFiles = $('news-files');
  const fPreview = $('news-media-preview');
  const MAX_IMAGES = 4;
  let formImages = []; // ids das imagens já enviadas para esta notícia
  let uploading = 0;

  function renderPreview() {
    fPreview.innerHTML = formImages.map(id => `
      <li><img src="${mediaUrl(id)}" alt=""><button type="button" class="icon-btn small danger" data-img-del="${escapeHtml(id)}" aria-label="Tirar imagem"><i class="fa-solid fa-xmark"></i></button></li>`).join('')
      + (uploading ? `<li class="uploading"><span class="spin"></span></li>` : '');
  }

  // Fotos são reduzidas no navegador (até 1400 px); GIF vai como está, para não perder a animação
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não deu para ler o arquivo.'));
      reader.onload = () => {
        if (file.type === 'image/gif') {
          if (file.size > 3 * 1024 * 1024) return reject(new Error('GIF grande demais (máximo 3 MB).'));
          return resolve(reader.result);
        }
        const img = new Image();
        img.onerror = () => reject(new Error('Imagem inválida.'));
        img.onload = () => {
          const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let url = c.toDataURL('image/webp', 0.86);
          if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.86);
          resolve(url);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  fFiles.addEventListener('change', async () => {
    const files = [...fFiles.files].filter(f => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
    fFiles.value = '';
    for (const file of files) {
      if (formImages.length + uploading >= MAX_IMAGES) { setMsg(`No máximo ${MAX_IMAGES} imagens por notícia.`); break; }
      uploading++;
      renderPreview();
      try {
        const dataUrl = await readImage(file);
        const res = await new Promise(r => socket.emit('news:upload', { image: dataUrl }, r));
        if (!res || res.error) throw new Error((res && res.error) || 'Erro ao enviar a imagem.');
        formImages.push(res.id);
        setMsg('');
      } catch (err) {
        setMsg(err.message);
      }
      uploading--;
      renderPreview();
    }
  });

  fPreview.addEventListener('click', e => {
    const del = e.target.closest('[data-img-del]');
    if (!del) return;
    const id = del.dataset.imgDel;
    formImages = formImages.filter(x => x !== id);
    socket.emit('news:discard', { id }); // só apaga se nenhuma notícia publicada usa
    renderPreview();
  });

  function resetForm() {
    form.reset();
    formImages = [];
    renderPreview();
    fId.value = '';
    fHead.textContent = 'Nova notícia';
    fCancel.classList.add('hide');
    fSubmit.querySelector('span').textContent = 'Publicar para todos';
    form.classList.remove('editing');
  }

  function renderAdmin() {
    if (!adminList) return;
    if (!items.length) {
      adminList.innerHTML = '<li class="news-empty">Nenhuma notícia publicada.</li>';
      return;
    }
    adminList.innerHTML = items.map(it => `
      <li class="admin-news-item ${fId.value === it.id ? 'editing' : ''}">
        <div class="admin-news-text">
          <div class="news-meta">${tagChip(it.tag)}${it.pinned ? '<span class="news-pinned"><i class="fa-solid fa-thumbtack"></i></span>' : ''}<time>${fmtDate(it.date)}</time></div>
          <b>${escapeHtml(it.title)}</b>
          ${(it.images || []).length ? `<small class="admin-news-imgs"><i class="fa-solid fa-image"></i> ${it.images.length}</small>` : ''}
        </div>
        <div class="admin-news-actions">
          <button type="button" class="icon-btn small" data-news-edit="${escapeHtml(it.id)}" title="Editar" aria-label="Editar"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="icon-btn small danger" data-news-del="${escapeHtml(it.id)}" title="Apagar" aria-label="Apagar"><i class="fa-solid fa-trash"></i></button>
        </div>
      </li>`).join('');
  }

  const setMsg = (text, ok) => {
    fMsg.textContent = text || '';
    fMsg.className = `form-msg ${ok ? 'ok' : 'error'}`;
  };

  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      id: fId.value || undefined,
      title: fTitle.value,
      tag: fTag.value,
      body: fBody.value,
      images: formImages.slice(),
      pinned: fPinned.checked
    };
    if (uploading) return setMsg('Espere a imagem terminar de enviar.');
    if (!data.title.trim() || (!data.body.trim() && !data.images.length)) return setMsg('Preencha o título e o texto.');
    fSubmit.disabled = true;
    socket.emit('news:save', data, res => {
      fSubmit.disabled = false;
      if (!res || res.error) return setMsg((res && res.error) || 'Erro ao salvar.');
      setMsg(data.id ? 'Notícia atualizada para todos.' : 'Notícia publicada para todos!', true);
      resetForm();
    });
  });

  fCancel.addEventListener('click', () => { resetForm(); setMsg(''); renderAdmin(); });

  adminList.addEventListener('click', e => {
    const edit = e.target.closest('[data-news-edit]');
    const del = e.target.closest('[data-news-del]');
    if (edit) {
      const it = items.find(x => x.id === edit.dataset.newsEdit);
      if (!it) return;
      fId.value = it.id;
      fTitle.value = it.title;
      fTag.value = it.tag;
      fBody.value = it.body;
      fPinned.checked = !!it.pinned;
      formImages = (it.images || []).slice();
      renderPreview();
      fHead.textContent = 'Editando notícia';
      fCancel.classList.remove('hide');
      fSubmit.querySelector('span').textContent = 'Salvar alterações';
      form.classList.add('editing');
      setMsg('');
      renderAdmin();
      fTitle.focus();
    } else if (del) {
      const it = items.find(x => x.id === del.dataset.newsDel);
      if (!it || !confirm(`Apagar a notícia "${it.title}" para todos?`)) return;
      socket.emit('news:delete', { id: it.id }, res => {
        if (!res || res.error) return setMsg((res && res.error) || 'Erro ao apagar.');
        if (fId.value === it.id) resetForm();
        setMsg('Notícia apagada.', true);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Lista que vem do servidor (ao conectar e sempre que o admin mudar algo)
  // ---------------------------------------------------------------------------
  socket.on('news', newItems => {
    const before = latest();
    items = Array.isArray(newItems) ? newItems : [];
    renderList();
    renderAdmin();
    updateDot();

    // Novidade publicada agora (com o site aberto): avisa
    const newest = items.slice().sort((a, b) => b.date - a.date)[0];
    // (quem acabou de publicar, com o painel admin aberto, não precisa do aviso)
    const adminOpen = !document.getElementById('modal-admin-panel').classList.contains('hide');
    if (!firstLoad && !adminOpen && newest && newest.date > before && newest.date > seenUntil() && window.trucoSocial) {
      window.trucoSocial.toast(`<i class="fa-solid fa-bullhorn"></i> <b>Novidade:</b> ${escapeHtml(newest.title)}`, {
        timeout: 8000,
        actions: [{ label: 'Ver', primary: true, onClick: openNews }]
      });
    }
    if (firstLoad) setTimeout(showWelcomeToast, 1200);
    firstLoad = false;
  });

  window.trucoNews = { renderAdmin, open: openNews };
})();

document.addEventListener('keydown', e => {
  const m = document.getElementById('modal-news');
  if (e.key === 'Escape' && m && !m.classList.contains('hide')) m.classList.add('hide');
});
