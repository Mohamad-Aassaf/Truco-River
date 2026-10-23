// public/js/rules.js
// Janela de regras: abas e calculadora de Envido/Flor.

(() => {
  const modal = document.getElementById('modal-rules');
  if (!modal) return;

  const tabs = modal.querySelectorAll('[data-rules-tab]');
  const panels = modal.querySelectorAll('[data-rules-panel]');
  const content = document.getElementById('rules-content');

  function showTab(name) {
    tabs.forEach(t => {
      const on = t.dataset.rulesTab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
    panels.forEach(p => p.classList.toggle('active', p.dataset.rulesPanel === name));
    content.scrollTop = 0;
  }

  tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.rulesTab)));

  // Índice de cada item para a entrada em cascata (CSS usa --i)
  modal.querySelectorAll('.rank-list, .rules-steps, .rules-facts, .parda-grid, .bet-ladder, .glossary, .envido-examples')
    .forEach(group => [...group.children].forEach((el, i) => el.style.setProperty('--i', i)));

  document.getElementById('open-rules-btn').addEventListener('click', () => {
    modal.classList.remove('hide');
  });

  // --- Calculadora de Envido -------------------------------------------------
  const SUITS = [
    { key: 'Espadas', label: 'Espadas', icon: '♠' },
    { key: 'Bastos', label: 'Paus', icon: '♣' },
    { key: 'Copas', label: 'Copas', icon: '♥' },
    { key: 'Ouros', label: 'Ouros', icon: '♦' }
  ];
  const VALUES = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
  const hand = [
    { value: 7, suit: 'Espadas' },
    { value: 5, suit: 'Espadas' },
    { value: 12, suit: 'Copas' }
  ];

  const handEl = document.getElementById('calc-hand');
  const resultEl = document.getElementById('calc-result');
  const envidoValue = v => (v >= 10 ? 0 : v);
  const suitLabel = key => SUITS.find(s => s.key === key).label;

  function computeHand() {
    const [a, b, c] = hand;
    if (a.suit === b.suit && b.suit === c.suit) {
      const total = 20 + envidoValue(a.value) + envidoValue(b.value) + envidoValue(c.value);
      return { kind: 'flor', total, text: `Flor de ${suitLabel(a.suit)}: 20 + ${envidoValue(a.value)} + ${envidoValue(b.value)} + ${envidoValue(c.value)}` };
    }
    let best = null;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        if (hand[i].suit !== hand[j].suit) continue;
        const total = 20 + envidoValue(hand[i].value) + envidoValue(hand[j].value);
        if (!best || total > best.total) {
          best = { kind: 'envido', total, text: `Duas de ${suitLabel(hand[i].suit)}: 20 + ${envidoValue(hand[i].value)} + ${envidoValue(hand[j].value)}` };
        }
      }
    }
    if (best) return best;
    const high = Math.max(...hand.map(h => envidoValue(h.value)));
    return { kind: 'envido', total: high, text: 'Naipes diferentes: vale a carta mais alta' };
  }

  function isDuplicate(i) {
    return hand.some((h, j) => j !== i && h.value === hand[i].value && h.suit === hand[i].suit);
  }

  function renderCalc() {
    handEl.innerHTML = hand.map((card, i) => `
      <div class="calc-card ${isDuplicate(i) ? 'dup' : ''}">
        <button type="button" class="calc-card-img" data-i="${i}" title="Trocar o número">
          <img src="/Baralho_Espanhol_Organizado/${card.suit}/${card.value}.png" alt="${card.value} de ${suitLabel(card.suit)}">
          <span class="calc-plus"><i class="fa-solid fa-rotate"></i></span>
        </button>
        <div class="calc-suits">
          ${SUITS.map(s => `<button type="button" class="calc-suit ${s.key === card.suit ? 'active' : ''} suit-${s.key}"
            data-i="${i}" data-suit="${s.key}" title="${s.label}" aria-label="${s.label}">${s.icon}</button>`).join('')}
        </div>
      </div>`).join('');

    if (hand.some((_, i) => isDuplicate(i))) {
      resultEl.innerHTML = '<span class="calc-warn">Essa carta já está na mão: só existe uma de cada no baralho.</span>';
      return;
    }
    const r = computeHand();
    resultEl.innerHTML = `
      <span class="calc-kind ${r.kind}">${r.kind === 'flor' ? '<i class="fa-solid fa-spa"></i> Flor!' : 'Envido'}</span>
      <span class="calc-total">${r.total}</span>
      <span class="calc-text">${r.text}</span>`;
  }

  handEl.addEventListener('click', e => {
    const suitBtn = e.target.closest('.calc-suit');
    const imgBtn = e.target.closest('.calc-card-img');
    if (suitBtn) {
      hand[+suitBtn.dataset.i].suit = suitBtn.dataset.suit;
    } else if (imgBtn) {
      const card = hand[+imgBtn.dataset.i];
      card.value = VALUES[(VALUES.indexOf(card.value) + 1) % VALUES.length];
    } else {
      return;
    }
    renderCalc();
    resultEl.classList.remove('pop');
    void resultEl.offsetWidth;
    resultEl.classList.add('pop');
  });

  renderCalc();
})();
