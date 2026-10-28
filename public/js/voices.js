// public/js/voices.js
// Painel "Vozes dos cantos": escolher o áudio e o tom de cada canto.
// As gravações ainda não existem; quando forem listadas no VOICE_LIBRARY
// (sound.js), aparecem aqui sozinhas.

(() => {
  const modal = document.getElementById('modal-voices');
  if (!modal || !window.TRUCO_VOICES) return;

  const { chants, library } = window.TRUCO_VOICES;
  const grid = document.getElementById('voices-grid');
  const enabledInput = document.getElementById('voices-enabled');
  const note = document.getElementById('voices-note');
  const PITCHES = [
    { value: 0.85, label: 'Grave' },
    { value: 1, label: 'Normal' },
    { value: 1.15, label: 'Aguda' }
  ];

  let draft = null;

  const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function render() {
    const totalVoices = chants.reduce((n, c) => n + (library[c.key] || []).length, 0);
    note.classList.toggle('hide', totalVoices > 0);
    enabledInput.checked = draft.enabled;
    modal.classList.toggle('voices-off', !draft.enabled);

    grid.innerHTML = chants.map((c, i) => {
      const options = library[c.key] || [];
      const pref = draft.chants[c.key] || {};
      const pitch = Number(pref.pitch) || 1;
      const select = options.length
        ? options.map(o => `<option value="${escapeHtml(o.id)}" ${pref.voice === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')
        : '<option value="">Em breve</option>';
      return `
        <div class="voice-chant" style="--i:${i}">
          <div class="voice-chant-head">
            <span class="voice-chant-name">¡${escapeHtml(c.label)}!</span>
            <button type="button" class="icon-btn small voice-preview" data-key="${c.key}" ${options.length ? '' : 'disabled'}
              title="${options.length ? 'Ouvir' : 'Ainda sem áudio'}" aria-label="Ouvir ${escapeHtml(c.label)}">
              <i class="fa-solid fa-play"></i>
            </button>
          </div>
          <select class="voice-pick" data-key="${c.key}" ${options.length ? '' : 'disabled'} aria-label="Voz do ${escapeHtml(c.label)}">${select}</select>
          <div class="voice-pitch" role="group" aria-label="Tom">
            ${PITCHES.map(p => `<button type="button" class="voice-pitch-btn ${Math.abs(p.value - pitch) < 0.01 ? 'active' : ''}"
              data-key="${c.key}" data-pitch="${p.value}">${p.label}</button>`).join('')}
          </div>
        </div>`;
    }).join('');
  }

  function open() {
    const prefs = window.soundManager.voicePrefs;
    draft = JSON.parse(JSON.stringify(prefs));
    render();
    const settings = document.getElementById('modal-mobile-settings');
    if (settings) settings.classList.add('hide');
    modal.classList.remove('hide');
  }

  function close() { modal.classList.add('hide'); }

  const setChant = (key, field, value) => {
    draft.chants[key] = Object.assign({}, draft.chants[key], { [field]: value });
  };

  grid.addEventListener('click', e => {
    const pitchBtn = e.target.closest('.voice-pitch-btn');
    const preview = e.target.closest('.voice-preview');
    if (pitchBtn) {
      setChant(pitchBtn.dataset.key, 'pitch', Number(pitchBtn.dataset.pitch));
      render();
    } else if (preview) {
      const key = preview.dataset.key;
      const options = library[key] || [];
      const pref = draft.chants[key] || {};
      const chosen = options.find(o => o.id === pref.voice) || options[0];
      if (chosen) window.soundManager.playVoiceFile({ path: chosen.path, pitch: Number(pref.pitch) || 1 });
    }
  });

  grid.addEventListener('change', e => {
    const pick = e.target.closest('.voice-pick');
    if (pick) setChant(pick.dataset.key, 'voice', pick.value);
  });

  enabledInput.addEventListener('change', () => {
    draft.enabled = enabledInput.checked;
    modal.classList.toggle('voices-off', !draft.enabled);
  });

  document.getElementById('voices-save').addEventListener('click', () => {
    window.soundManager.saveVoicePrefs(draft);
    close();
    if (window.trucoSocial) window.trucoSocial.toast('Vozes salvas.', { kind: 'success', timeout: 2500 });
  });

  document.getElementById('open-voices-btn').addEventListener('click', open);
  modal.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', close));
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hide')) close(); });
})();
