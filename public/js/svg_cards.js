// public/js/svg_cards.js
// Definições Estáticas de SVGs de Naipes e Figuras do Baralho Espanhol

// SVGs das Cartas por Naipe (Design Premium Customizado)
const SUIT_SVGS = {
  espadas: `
    <svg class="suit-main-svg" viewBox="0 0 100 100">
      <!-- Lâmina da Espada -->
      <path d="M50,15 L62,55 L50,58 L38,55 Z" fill="#b0c4de" stroke="#2c3e50" stroke-width="2"/>
      <line x1="50" y1="15" x2="50" y2="58" stroke="#778899" stroke-width="1.5"/>
      <!-- Guarda e Haste -->
      <path d="M30,55 C30,55 50,52 70,55 L70,60 C70,60 50,57 30,60 Z" fill="#d4af37" stroke="#996515" stroke-width="1.5"/>
      <rect x="47" y="60" width="6" height="18" fill="#8b5a2b" stroke="#3e2723" stroke-width="1.5"/>
      <!-- Pomo da espada -->
      <circle cx="50" cy="80" r="5" fill="#d4af37" stroke="#996515" stroke-width="1"/>
    </svg>
  `,
  paus: `
    <svg class="suit-main-svg" viewBox="0 0 100 100">
      <!-- Tronco do Bastão -->
      <path d="M43,80 L40,30 C40,30 50,15 60,30 L57,80 Z" fill="#8b5a2b" stroke="#3e2723" stroke-width="2"/>
      <!-- Nós de Madeira e Ranhuras -->
      <circle cx="48" cy="40" r="3" fill="#5d4037"/>
      <circle cx="52" cy="60" r="4.5" fill="#5d4037"/>
      <!-- Pequena Folha verde brotando para estilizar gaúcho -->
      <path d="M58,45 C65,40 70,45 64,52 Z" fill="#27ae60" stroke="#1e8449" stroke-width="1"/>
    </svg>
  `,
  copas: `
    <svg class="suit-main-svg" viewBox="0 0 100 100">
      <!-- Cálice de Ouro -->
      <path d="M30,20 L70,20 L68,45 C68,55 58,62 50,62 C42,62 32,55 32,45 Z" fill="#d4af37" stroke="#996515" stroke-width="2"/>
      <!-- Detalhe da borda e gemas -->
      <rect x="35" y="24" width="30" height="3" fill="#c0392b"/>
      <!-- Haste do Cálice -->
      <rect x="46" y="62" width="8" height="15" fill="#b58d3d" stroke="#996515" stroke-width="1.5"/>
      <!-- Base do Cálice -->
      <path d="M35,77 L65,77 L60,82 L40,82 Z" fill="#d4af37" stroke="#996515" stroke-width="2"/>
    </svg>
  `,
  ouros: `
    <svg class="suit-main-svg" viewBox="0 0 100 100">
      <!-- Moeda de Ouro Gaudéria com Sol no centro -->
      <circle cx="50" cy="50" r="35" fill="#f1c40f" stroke="#d4af37" stroke-width="3"/>
      <!-- Linhas internas/Relevo -->
      <circle cx="50" cy="50" r="27" fill="none" stroke="#d4af37" stroke-width="1.5" stroke-dasharray="4,4"/>
      <!-- Sol no centro -->
      <circle cx="50" cy="50" r="8" fill="#f39c12"/>
      <path d="M50,30 L50,38 M50,62 L50,70 M30,50 L38,50 M62,50 L70,50 M36,36 L42,42 M58,58 L64,64 M64,36 L58,42 M42,58 L36,64" stroke="#e67e22" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
  `
};

const SUIT_MINIS = {
  espadas: '⚔️',
  paus: '🪵',
  copas: '🏆',
  ouros: '🟡'
};

const DECK_PREVIEWS = {
  traditional: [
    [
      '/Baralho_Espanhol_Organizado/Espadas/1.png',
      '/Baralho_Espanhol_Organizado/Espadas/7.png',
      '/Baralho_Espanhol_Organizado/Copas/3.png'
    ],
    [
      '/Baralho_Espanhol_Organizado/Bastos/1.png',
      '/Baralho_Espanhol_Organizado/Ouros/7.png',
      '/Baralho_Espanhol_Organizado/Espadas/3.png'
    ],
    [
      '/Baralho_Espanhol_Organizado/Ouros/12.png',
      '/Baralho_Espanhol_Organizado/Bastos/11.png',
      '/Baralho_Espanhol_Organizado/Copas/10.png'
    ]
  ],
  pixel: [
    [
      '/pixelDeck/pixelDeck/Espada/espada1.png',
      '/pixelDeck/pixelDeck/Espada/espada7.png',
      '/pixelDeck/pixelDeck/Copa/copa3.png'
    ],
    [
      '/pixelDeck/pixelDeck/Basto/basto1.png',
      '/pixelDeck/pixelDeck/Oro/oro7.png',
      '/pixelDeck/pixelDeck/Espada/espada3.png'
    ],
    [
      '/pixelDeck/pixelDeck/Oro/oro10.png',
      '/pixelDeck/pixelDeck/Basto/basto9.png',
      '/pixelDeck/pixelDeck/Copa/copa8.png'
    ]
  ]
};

// Ilustrações das figuras do baralho espanhol (Sota, Cavalo, Rei)
const FIG_10_SVG = (color) => `
  <svg class="suit-main-svg" viewBox="0 0 100 100">
    <path d="M50,15 C42,15 38,22 38,32 C38,42 45,50 50,72 C55,50 62,42 62,32 C62,22 58,15 50,15 Z" fill="none" stroke="${color}" stroke-width="2.5"/>
    <circle cx="50" cy="30" r="7" fill="${color}"/>
    <line x1="32" y1="80" x2="68" y2="20" stroke="${color}" stroke-width="2.5"/>
    <polygon points="68,20 64,28 72,26" fill="${color}"/>
    <rect x="42" y="45" width="4" height="22" fill="${color}" transform="rotate(45 42 45)"/>
  </svg>
`;

const FIG_11_SVG = (color) => `
  <svg class="suit-main-svg" viewBox="0 0 100 100">
    <path d="M68,75 C68,58 58,42 58,28 C58,22 48,12 38,18 C28,24 25,35 32,40 C38,42 42,40 48,45 C54,50 52,65 45,75 Z" fill="${color}"/>
    <path d="M30,35 C35,37 45,35 48,45" fill="none" stroke="#fff" stroke-width="1.5"/>
    <path d="M22,78 C22,85 78,85 78,78" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4,4"/>
  </svg>
`;

const FIG_12_SVG = (color) => `
  <svg class="suit-main-svg" viewBox="0 0 100 100">
    <path d="M18,68 L82,68 L88,38 L72,52 L50,28 L28,52 L12,38 Z" fill="${color}" stroke="#ecdcb0" stroke-width="1.5"/>
    <rect x="22" y="68" width="56" height="6" fill="#ecdcb0" rx="3"/>
    <circle cx="50" cy="28" r="4.5" fill="#c0392b"/>
    <circle cx="12" cy="38" r="3" fill="#2980b9"/>
    <circle cx="88" cy="38" r="3" fill="#2980b9"/>
    <circle cx="28" cy="52" r="3.5" fill="#27ae60"/>
    <circle cx="72" cy="52" r="3.5" fill="#27ae60"/>
  </svg>
`;

function getCardCenterHTML(card) {
  const value = card.value;
  const suit = card.suit;

  let color = '#333';
  if (suit === 'espadas') color = '#2c3e50';
  else if (suit === 'paus') color = '#1e8449';
  else if (suit === 'copas') color = '#b03a2e';
  else if (suit === 'ouros') color = '#d4ac0d';

  if (value === 10) {
    return `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
        ${FIG_10_SVG(color)}
        <span class="card-figure-label">Sota</span>
      </div>
    `;
  }
  if (value === 11) {
    return `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
        ${FIG_11_SVG(color)}
        <span class="card-figure-label">Cavalo</span>
      </div>
    `;
  }
  if (value === 12) {
    return `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
        ${FIG_12_SVG(color)}
        <span class="card-figure-label">Rei</span>
      </div>
    `;
  }

  return SUIT_SVGS[suit];
}

function getSuitFolder(suit) {
  switch (suit) {
    case 'espadas': return 'Espadas';
    case 'paus': return 'Bastos';
    case 'copas': return 'Copas';
    case 'ouros': return 'Ouros';
    default: return '';
  }
}

function getCardImgSrc(card) {
  const deckStyle = typeof currentDeckStyle !== 'undefined' ? currentDeckStyle : 'traditional';

  if (deckStyle === 'pixel') {
    let suitFolder = '';
    let imgPrefix = '';
    switch (card.suit) {
      case 'espadas':
        suitFolder = 'Espada';
        imgPrefix = 'espada';
        break;
      case 'paus':
        suitFolder = 'Basto';
        imgPrefix = 'basto';
        break;
      case 'copas':
        suitFolder = 'Copa';
        imgPrefix = 'copa';
        break;
      case 'ouros':
        suitFolder = 'Oro';
        imgPrefix = 'oro';
        break;
    }
    let val = card.value;
    if (val === 10) val = 8;
    else if (val === 11) val = 9;
    else if (val === 12) val = 10;

    return `/pixelDeck/pixelDeck/${suitFolder}/${imgPrefix}${val}.png`;
  } else {
    const suitFolder = getSuitFolder(card.suit);
    return `/Baralho_Espanhol_Organizado/${suitFolder}/${card.value}.png`;
  }
}
