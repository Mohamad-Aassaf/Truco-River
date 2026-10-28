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
      <li class="news-item ${it.pinned ? 'pinned' : ''} ${it.date > seen ? 'unseen' : ''}" style="--i:${i}">
        <div class="news-meta">
          ${tagChip(it.tag)}
          ${it.pinned ? '<span class="news-pinned"><i class="fa-solid fa-thumbtack"></i> Fixada</span>' : ''}
          ${it.date > seen ? '<span class="news-new">Nova</span>' : ''}
          <time>${fmtDate(it.date)}</time>
        </div>
        <h3>${escapeHtml(it.title)}</h3>
        <div class="news-body">${bodyHtml(it.body)}</div>
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

  function resetForm() {
    form.reset();
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
      pinned: fPinned.checked
    };
    if (!data.title.trim() || !data.body.trim()) return setMsg('Preencha o título e o texto.');
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
