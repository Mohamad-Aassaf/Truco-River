// bot.js
// Inteligência dos bots do Truco Gaúcho (Fácil, Médio, Difícil), para 1v1 e duplas.
//
// Como o bot pensa:
// 1. O que ele sabe: as próprias cartas, as do parceiro (nas duplas, como se
//    fossem as "señas"), todas as cartas já jogadas e o que os adversários
//    cantaram ou mostraram (pontos do Envido/Flor, quem trucou, quem cantou).
// 2. Ele monta muitas mãos possíveis para os adversários, só com cartas que ele
//    não viu e que combinam com tudo isso (quem mostrou 31 de envido tem
//    exatamente 31; quem trucou tende a ter carta boa; quem não cantou Flor na
//    primeira vaza não tem Flor...).
// 3. Para cada mão possível ele joga o resto da mão até o fim, com os dois times
//    jogando o melhor possível (busca completa: no máximo 3 cartas por jogador),
//    e conta em quantas o time dele ganha.
// 4. Com essa chance ele escolhe a carta (a que mais ganha; empatou, guarda a
//    mais forte) e decide Truco, Envido e Flor comparando o que cada resposta
//    faz com a chance de ganhar a PARTIDA (o placar importa: perto do fim um
//    ponto vale mais).
//
// Fácil pensa pouco e erra de propósito; Médio pensa um pouco menos e às vezes
// escolhe entre opções quase iguais; Difícil pensa bastante.

const { createDeck, calculateEnvidoScore, calculateFlorScore, shuffle } = require('./gameEngine');

const DECK = createDeck();
const cardKey = c => `${c.value}-${c.suit}`;
const rand = () => Math.random();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sigmoid = x => 1 / (1 + Math.exp(-x));

const LEVEL = {
  easy: { samples: 30, inference: false, noise: 0.15, pickSlack: 0.2, randomCard: 0.25, bluff: 0.12 },
  medium: { samples: 110, inference: true, noise: 0.08, pickSlack: 0.06, randomCard: 0, bluff: 0.07 },
  hard: { samples: 260, inference: true, noise: 0, pickSlack: 0.015, randomCard: 0, bluff: 0.06 }
};
const levelOf = player => LEVEL[player.difficulty] || LEVEL.medium;
const limitOf = game => game.maxPoints || 24;

// ---------------------------------------------------------------------------
// Chance de ganhar a partida com um placar (aproximação: a diferença pesa mais
// perto do fim). Serve para comparar "aceitar" x "correr" x "aumentar".
// ---------------------------------------------------------------------------
function matchWinChance(mine, theirs, limit) {
  if (mine >= limit) return 1;
  if (theirs >= limit) return 0;
  const lead = (mine - theirs) / limit;
  const urgency = 1 + Math.max(mine, theirs) / limit;
  return 1 / (1 + Math.exp(-3.2 * lead * urgency));
}

// Distribuição do envido de uma mão qualquer (sem Flor): chance de ter MENOS que s
const ENVIDO_BELOW = (() => {
  const counts = new Array(40).fill(0);
  let n = 0;
  for (let i = 0; i < 20000; i++) {
    const hand = shuffle(createDeck()).slice(0, 3);
    if (calculateFlorScore(hand) > 0) continue;
    counts[calculateEnvidoScore(hand)]++;
    n++;
  }
  const below = new Array(41).fill(0);
  for (let s = 1; s <= 40; s++) below[s] = below[s - 1] + counts[s - 1] / n;
  return below;
})();
const envidoBelow = s => ENVIDO_BELOW[Math.max(0, Math.min(40, s))];

// ---------------------------------------------------------------------------
// Mesa: quem é parceiro, quem já foi ao mazo, ordem a partir do mão
// ---------------------------------------------------------------------------
function tableInfo(game, botIdx) {
  const h = game.hand;
  const n = game.maxPlayers;
  const team = game.players.map(p => p.team);
  const myTeam = team[botIdx];
  const partnerIdx = n === 4 ? (botIdx + 2) % 4 : -1;
  const folded = i => h.foldedPlayers.has(i);
  const opponents = [];
  for (let i = 0; i < n; i++) if (team[i] !== myTeam) opponents.push(i);
  const order = [];
  for (let k = 0; k < n; k++) order.push((h.mão + k) % n);
  return { h, n, team, myTeam, oppTeam: 1 - myTeam, partnerIdx, folded, opponents, order };
}

// ---------------------------------------------------------------------------
// Mãos possíveis dos adversários
// Para cada adversário: todas as combinações de cartas não vistas com a
// quantidade que ele ainda tem, que combinem com o que já se sabe, cada uma com
// um peso (o quanto ela combina com o jeito que ele jogou e cantou).
// ---------------------------------------------------------------------------
function combos(pool, k) {
  const out = [];
  const m = pool.length;
  if (k === 0) return [[]];
  if (k === 1) { for (let a = 0; a < m; a++) out.push([pool[a]]); return out; }
  if (k === 2) { for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) out.push([pool[a], pool[b]]); return out; }
  for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) for (let c = b + 1; c < m; c++) out.push([pool[a], pool[b], pool[c]]);
  return out;
}

// Força de uma mão para o truco (0 a ~1): as duas melhores cartas pesam mais
function trucoStrength(cards) {
  const r = cards.map(c => c.trucoRank).sort((a, b) => b - a);
  return ((r[0] || 0) * 0.55 + (r[1] || 0) * 0.3 + (r[2] || 0) * 0.15) / 14;
}

// O que cada adversário já mostrou ou cantou nesta mão
function opponentEvidence(game, i) {
  const h = game.hand;
  const ev = { envidoExact: null, envidoMax: null, florExact: null, mustFlor: false, mustNotFlor: false, envidoCall: 0, trucoCall: 0, trucoAccept: 0 };
  const reveal = h.reveal;
  if (reveal && reveal.lines) {
    const line = reveal.lines.find(l => l.playerIdx === i);
    if (reveal.kind === 'envido') {
      if (line && line.score !== null && line.score !== undefined) ev.envidoExact = line.score;
      else if (line) {
        const win = reveal.lines.find(l => l.playerIdx === reveal.winnerIdx);
        if (win && win.score !== null) ev.envidoMax = win.score;
      }
    } else if (reveal.kind === 'flor' && line && line.score !== null && line.score !== undefined) {
      ev.florExact = line.score;
      ev.mustFlor = true;
    }
  }
  if ((h.florCallers || []).includes(i)) ev.mustFlor = true;
  // Cantou Envido e ainda não mostrou: tende a ter pontos
  if (h.envidoCallerIdx === i && ev.envidoExact === null) ev.envidoCall = h.envidoState === 'falta_envido' ? 2 : 1;
  // Trucou (o último a trucar): tende a ter carta boa. Nas duplas, o parceiro de
  // quem trucou também costuma ajudar (eles combinam as cartas)
  if (h.trucoCallerIdx === i && h.trucoState !== 'none') ev.trucoCall = 1;
  else if (game.maxPlayers === 4 && h.trucoState !== 'none' && h.trucoCallerIdx === (i + 2) % 4) ev.trucoAccept = 1;
  // O time dele aceitou um truco
  if (h.trucoPoints > 1 && h.trucoCallerTeam !== game.players[i].team) ev.trucoAccept = 1;
  return ev;
}

function buildCandidates(game, botIdx, i, pool, inference, faltaCalls) {
  const h = game.hand;
  const k = (h.hands[i] || []).length;
  const played = h.playedCards.filter(p => p.playerIdx === i).map(p => p.card);
  const ev = opponentEvidence(game, i);
  const all = combos(pool, k);
  const list = [];
  const weights = [];
  // Quem pede Falta toda hora: vale menos como sinal de pontos
  const callSharp = clamp(1 - 0.3 * (faltaCalls || 0), 0.15, 1);
  for (const combo of all) {
    const hand = played.concat(combo);
    let w = 1;
    if (hand.length === 3) {
      const flor = calculateFlorScore(hand);
      if (ev.mustFlor && !flor) continue;
      if (ev.mustNotFlor && flor) continue;
      if (ev.florExact !== null && flor !== ev.florExact) continue;
      if (ev.envidoExact !== null || ev.envidoMax !== null) {
        const env = calculateEnvidoScore(hand);
        if (ev.envidoExact !== null && env !== ev.envidoExact) continue;
        if (ev.envidoMax !== null && env > ev.envidoMax) continue;
      }
      if (inference) {
        if (ev.envidoCall) {
          // Quem canta Envido quase sempre tem ponto (blefe é raro)
          const env = calculateEnvidoScore(hand);
          const mid = ev.envidoCall === 2 ? 28 : 26.5;
          w *= 0.06 + 0.94 * sigmoid(((env - mid) / 1.3) * callSharp);
        }
        if (ev.trucoCall || ev.trucoAccept) {
          // Quem truca (ou aceita) costuma ter carta boa ainda na mão; blefe é a minoria
          const s = h.currentRound === 0 ? trucoStrength(hand) : trucoStrength(combo.concat(combo));
          const mid = ev.trucoCall ? 0.6 : 0.52;
          w *= (ev.trucoCall ? 0.12 : 0.25) + (ev.trucoCall ? 0.88 : 0.75) * sigmoid((s - mid) / 0.05);
        }
      }
    }
    list.push(combo);
    weights.push(w);
  }
  if (!list.length) {
    // Nada combina (informação contraditória): cai para qualquer combinação
    return { list: all, weights: all.map(() => 1), played };
  }
  return { list, weights, played };
}

function pickWeighted(weights, total) {
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}

// Gera mãos completas para os adversários (sem repetir carta entre eles)
function sampleWorlds(game, botIdx, count, inference) {
  const T = tableInfo(game, botIdx);
  const h = T.h;
  const known = new Set();
  (h.hands[botIdx] || []).forEach(c => known.add(cardKey(c)));
  if (T.partnerIdx >= 0) (h.hands[T.partnerIdx] || []).forEach(c => known.add(cardKey(c)));
  h.playedCards.forEach(p => known.add(cardKey(p.card)));
  const pool = DECK.filter(c => !known.has(cardKey(c)));
  const memo = game.botMemo && game.botMemo.falta ? game.botMemo.falta : [0, 0];
  const opps = T.opponents.filter(i => !T.folded(i) && (h.hands[i] || []).length > 0);
  const cand = opps.map(i => ({ i, ...buildCandidates(game, botIdx, i, pool, inference, memo[T.oppTeam]) }));
  cand.forEach(c => { c.total = c.weights.reduce((a, b) => a + b, 0); });

  const worlds = [];
  for (let s = 0; s < count; s++) {
    const used = new Set();
    const hands = {};
    let weight = 1;
    let ok = true;
    for (const c of cand) {
      let chosen = null;
      for (let tries = 0; tries < 40 && !chosen; tries++) {
        const idx = pickWeighted(c.weights, c.total);
        const combo = c.list[idx];
        if (combo.every(card => !used.has(cardKey(card)))) chosen = combo;
      }
      if (!chosen) {
        // Não achou sem repetir: completa com cartas livres
        const free = pool.filter(card => !used.has(cardKey(card)));
        chosen = shuffle(free.slice()).slice(0, (h.hands[c.i] || []).length);
        weight *= 0.5;
        ok = false;
      }
      chosen.forEach(card => used.add(cardKey(card)));
      hands[c.i] = chosen;
    }
    worlds.push({ hands, weight, ok, played: Object.fromEntries(cand.map(c => [c.i, c.played])) });
  }
  return { worlds, T };
}

// ---------------------------------------------------------------------------
// Busca completa do resto da mão (as cartas de todos à vista), mesmas regras do
// motor: maior carta ganha a vaza; mesma força de times diferentes empata
// ("parda"); quem ganha a vaza começa a próxima; empate, começa o mão.
// ---------------------------------------------------------------------------
function handWinner(r, maoTeam) {
  const t0 = r.filter(w => w === 0).length;
  const t1 = r.filter(w => w === 1).length;
  if (t0 === 2) return 0;
  if (t1 === 2) return 1;
  if (r[0] === -1) {
    if (r[1] === 0 || r[1] === 1) return r[1];
    if (r[1] === -1) {
      if (r[2] === 0 || r[2] === 1) return r[2];
      if (r[2] === -1) return maoTeam;
    }
  }
  if (r[1] === -1 && r[0] !== -1) return r[0];
  if (r[2] === -1 && r[0] !== -1 && r[1] !== -1) return r[0];
  if (r.length === 3 && (r[2] === 0 || r[2] === 1)) return r[2];
  return null;
}

function makeSearcher(T, maxTeam) {
  const n = T.n;
  const team = T.team;
  const folded = [];
  for (let i = 0; i < n; i++) folded[i] = T.folded(i);
  const maoTeam = team[T.h.mão];
  const mao = T.h.mão;
  let nodes = 0;

  // st: { hands: number[][] (forças), plays: [[idx, rank]], rounds: number[], cur }
  function roundResult(plays) {
    let best = plays[0];
    let tie = false;
    for (let i = 1; i < plays.length; i++) {
      const p = plays[i];
      if (p[1] > best[1]) { best = p; tie = false; }
      else if (p[1] === best[1] && team[p[0]] !== team[best[0]]) tie = true;
    }
    return tie ? -1 : best[0];
  }

  function nextToPlay(st, from) {
    for (let step = 1; step <= n; step++) {
      const i = (from + step) % n;
      if (folded[i]) continue;
      if (st.plays.some(p => p[0] === i)) continue;
      if (!st.hands[i].length) continue;
      return i;
    }
    return -1;
  }

  function search(st) {
    nodes++;
    const p = st.cur;
    const hand = st.hands[p];
    const isMax = team[p] === maxTeam;
    const seen = [];
    for (let ci = 0; ci < hand.length; ci++) {
      const r = hand[ci];
      if (seen.includes(r)) continue; // cartas da mesma força são iguais
      seen.push(r);
      const v = playAndContinue(st, ci);
      if (isMax && v === 1) return 1;
      if (!isMax && v === 0) return 0;
    }
    return isMax ? 0 : 1;
  }

  // Joga a carta ci de quem está na vez e continua (desfaz no fim)
  function playAndContinue(st, ci) {
    const p = st.cur;
    const hand = st.hands[p];
    const r = hand[ci];
    hand.splice(ci, 1);
    st.plays.push([p, r]);
    let v;
    const nxt = nextToPlay(st, p);
    if (nxt !== -1) {
      const prevCur = st.cur;
      st.cur = nxt;
      v = search(st);
      st.cur = prevCur;
    } else {
      // Fim da vaza
      const winIdx = roundResult(st.plays);
      const roundTeam = winIdx === -1 ? -1 : team[winIdx];
      st.rounds.push(roundTeam);
      const hw = handWinner(st.rounds, maoTeam);
      if (hw !== null || st.rounds.length >= 3) {
        v = (hw === null ? maoTeam : hw) === maxTeam ? 1 : 0;
      } else {
        const savedPlays = st.plays;
        const prevCur = st.cur;
        let lead = winIdx === -1 ? mao : winIdx;
        while (folded[lead] || !st.hands[lead].length) lead = (lead + 1) % n;
        st.plays = [];
        st.cur = lead;
        v = search(st);
        st.plays = savedPlays;
        st.cur = prevCur;
      }
      st.rounds.pop();
    }
    st.plays.pop();
    hand.splice(ci, 0, r);
    return v;
  }

  return { search, playAndContinue, nodes: () => nodes };
}

// Estado atual da mão para a busca, com as mãos de um "mundo" possível
function stateFor(game, botIdx, T, world) {
  const h = T.h;
  const hands = [];
  for (let i = 0; i < T.n; i++) {
    let cards;
    if (i === botIdx || i === T.partnerIdx) cards = h.hands[i] || [];
    else cards = world.hands[i] || [];
    hands[i] = T.folded(i) ? [] : cards.map(c => c.trucoRank);
  }
  const plays = h.playedCards
    .filter(p => p.round === h.currentRound && !T.folded(p.playerIdx))
    .map(p => [p.playerIdx, p.card.trucoRank]);
  return { hands, plays, rounds: h.roundsWon.slice(), cur: h.currentPlayer };
}

// Chance de o time do bot ganhar a mão. Com `cardIndex`, é a chance se o bot
// (que está na vez) jogar aquela carta agora.
function handChances(game, botIdx, opts = {}) {
  const player = game.players[botIdx];
  const lvl = levelOf(player);
  const samples = opts.samples || lvl.samples;
  const { worlds, T } = sampleWorlds(game, botIdx, samples, lvl.inference);
  const searcher = makeSearcher(T, T.myTeam);
  const myCards = game.hand.hands[botIdx] || [];
  const candidates = opts.candidates || null; // índices das cartas a testar
  const res = candidates ? candidates.map(() => 0) : [0];
  let total = 0;
  for (const w of worlds) {
    const st = stateFor(game, botIdx, T, w);
    if (candidates) {
      if (st.cur !== botIdx) continue;
      candidates.forEach((ci, k) => {
        const rank = myCards[ci].trucoRank;
        const pos = st.hands[botIdx].indexOf(rank);
        res[k] += w.weight * searcher.playAndContinue(st, pos);
      });
    } else {
      res[0] += w.weight * searcher.search(st);
    }
    total += w.weight;
  }
  // A busca com as cartas à vista é um pouco otimista no meio da escala (medido
  // jogando milhares de mãos): corrige de leve
  const k = T.n === 4 ? 0.12 : 0.28;
  const calib = p => clamp(p - k * p * (1 - p), 0, 1);
  return { chances: res.map(v => calib(total ? v / total : 0.5)), worlds, T };
}

// Compatível com o código antigo: chance de ganhar a mão (com a carta, se dada)
function estimateWinChance(game, botIdx, candidateCard = null, samples) {
  if (!game.hand) return 0.5;
  if (candidateCard) {
    const ci = game.hand.hands[botIdx].findIndex(c => c === candidateCard || cardKey(c) === cardKey(candidateCard));
    return handChances(game, botIdx, { candidates: [ci], samples }).chances[0];
  }
  return bestHandChance(game, botIdx, samples);
}

// Melhor chance considerando a jogada (se é a vez do bot) ou o estado atual
function bestHandChance(game, botIdx, samples) {
  const h = game.hand;
  if (h.currentPlayer === botIdx && !h.trucoResponsePending && !h.envidoResponsePending && !h.florResponsePending) {
    const cards = h.hands[botIdx] || [];
    const idxs = distinctCards(cards);
    if (!idxs.length) return 0.5;
    return Math.max(...handChances(game, botIdx, { candidates: idxs, samples }).chances);
  }
  return handChances(game, botIdx, { samples }).chances[0];
}

// Uma carta de cada força (as de mesma força são iguais no truco)
function distinctCards(cards) {
  const seen = new Set();
  const out = [];
  cards.forEach((c, i) => { if (!seen.has(c.trucoRank)) { seen.add(c.trucoRank); out.push(i); } });
  return out;
}

// ---------------------------------------------------------------------------
// Escolher a carta
// ---------------------------------------------------------------------------
function selectCardToPlay(game, idx) {
  const player = game.players[idx];
  const cards = game.hand.hands[idx];
  if (cards.length === 1) return 0;
  const lvl = levelOf(player);
  if (lvl.randomCard && rand() < lvl.randomCard) return Math.floor(rand() * cards.length);

  const idxs = distinctCards(cards);
  if (idxs.length === 1) return idxs[0];
  const { chances } = handChances(game, idx, { candidates: idxs });
  const scored = idxs.map((ci, k) => ({ ci, rank: cards[ci].trucoRank, p: chances[k] }));
  const best = Math.max(...scored.map(s => s.p));
  // Entre as que dão (quase) a mesma chance, joga a mais fraca e guarda as fortes
  const good = scored.filter(s => s.p >= best - lvl.pickSlack).sort((a, b) => a.rank - b.rank);
  if (player.difficulty === 'medium' && good.length > 1 && rand() < 0.15) return good[1].ci;
  return good[0].ci;
}

// ---------------------------------------------------------------------------
// Truco
// ---------------------------------------------------------------------------
const STAKE_IF_ACCEPTED = { none: 2, truco: 3, retruco: 4 }; // pedir a partir deste estado
const VALUE_ACCEPTED = { truco: 2, retruco: 3, vale4: 4 };

function noisy(p, lvl) {
  return lvl.noise ? clamp(p + (rand() * 2 - 1) * lvl.noise, 0, 1) : p;
}

// Chance de o outro time correr de um truco nosso: quanto melhor a nossa mão,
// mais provável que a dele seja fraca
const foldChance = p => clamp(1.4 * p - 0.55, 0.05, 0.65);

function respondTruco(game, idx) {
  const h = game.hand;
  const player = game.players[idx];
  const lvl = levelOf(player);
  const my = player.team;
  const opp = 1 - my;
  const L = limitOf(game);
  const s = game.score;
  const W = (a, b) => matchWinChance(a, b, L);
  const stake = VALUE_ACCEPTED[h.trucoState] || 2;
  const refuseGives = stake - 1;
  const canRaise = h.trucoState === 'truco' || h.trucoState === 'retruco';
  const raiseTo = h.trucoState === 'truco' ? 'retruco' : 'vale4';

  // Quem trucou sabe da própria mão: o bot desconta um pouco a mais (medido nos testes)
  const p = noisy(clamp(handChances(game, idx).chances[0] - 0.05, 0, 1), lvl);
  const uRefuse = W(s[my], s[opp] + refuseGives);
  const uAccept = p * W(s[my] + stake, s[opp]) + (1 - p) * W(s[my], s[opp] + stake);
  let uRaise = -1;
  if (canRaise) {
    const f = foldChance(p) * 0.8; // quem já trucou corre menos
    const s2 = stake + 1;
    uRaise = f * W(s[my] + stake, s[opp]) + (1 - f) * (p * W(s[my] + s2, s[opp]) + (1 - p) * W(s[my], s[opp] + s2));
  }
  const best = Math.max(uRefuse, uAccept, uRaise);
  if (canRaise && uRaise === best && p > 0.55) return { action: 'truco_raise', value: raiseTo };
  if (uAccept >= uRefuse - 0.004) return { action: 'truco_response', value: 'quero' };
  // Às vezes aceita um truco fraco para não ser previsível
  if (stake === 2 && p > 0.2 && rand() < lvl.bluff / 2) return { action: 'truco_response', value: 'quero' };
  return { action: 'truco_response', value: 'nao_quero' };
}

function wantsToTruco(game, idx) {
  const h = game.hand;
  const player = game.players[idx];
  const lvl = levelOf(player);
  const my = player.team;
  const opp = 1 - my;
  if (h.trucoState === 'vale4' || h.trucoCallerTeam === my) return false;
  const L = limitOf(game);
  const s = game.score;
  const W = (a, b) => matchWinChance(a, b, L);
  const cur = h.trucoPoints;
  const stake = STAKE_IF_ACCEPTED[h.trucoState];
  // Já ganha o jogo com o que vale agora: pedir mais não adianta
  const p = noisy(bestHandChance(game, idx), lvl);
  const f = foldChance(p);
  const uWait = p * W(s[my] + cur, s[opp]) + (1 - p) * W(s[my], s[opp] + cur);
  const uCall = f * W(s[my] + cur, s[opp]) + (1 - f) * (p * W(s[my] + stake, s[opp]) + (1 - p) * W(s[my], s[opp] + stake));

  // Na primeira vaza quem tem mão boa costuma esperar: trucar cedo faz o outro
  // correr (e entrega o jogo). Mais tarde, com mais informação, truca mais.
  // Na primeira vaza o bot segura a mão boa na maioria das vezes (truca mais tarde,
  // ou deixa o outro trucar para aumentar): pedido dos jogadores, trucar sempre
  // logo de cara deixa o bot previsível
  if (h.currentRound === 0) {
    if (uCall > uWait + 0.008) return rand() < (p >= 0.88 ? 0.2 : 0.3);
    return p < 0.3 && rand() < lvl.bluff / 4;
  }
  if (uCall > uWait + 0.003) return true;
  // Blefe: mais comum quando dá para "contar história" (vazas já jogadas)
  return p < 0.35 && rand() < lvl.bluff;
}

// ---------------------------------------------------------------------------
// Envido
// ---------------------------------------------------------------------------
// Pontos do envido de cada jogador em cada mundo possível + quem ganha
function envidoWorlds(game, idx, worlds, T) {
  const out = [];
  for (const w of worlds) {
    const scores = {};
    for (const i of T.order) {
      if (T.folded(i)) continue;
      const p = game.players[i];
      if (T.team[i] === T.myTeam) {
        scores[i] = p.envidoScore; // com Flor escondida também entra (duas maiores da Flor)
      } else {
        const orig = (w.played[i] || []).concat(w.hands[i] || []);
        if (orig.length === 3) scores[i] = calculateEnvidoScore(orig);
      }
    }
    let winner = -1;
    for (const i of T.order) {
      if (scores[i] === undefined) continue;
      if (winner === -1 || scores[i] > scores[winner]) winner = i;
    }
    let oppBest = -1;
    T.opponents.forEach(i => { if (scores[i] !== undefined) oppBest = Math.max(oppBest, scores[i]); });
    out.push({ weight: w.weight, weWin: winner !== -1 && T.team[winner] === T.myTeam, oppBest });
  }
  return out;
}

// Valor (chance de ganhar a partida) de cada jeito de cantar/responder o Envido.
// Quando o bot canta, o outro lado aceita com uma chance que cresce com os
// pontos dele (gente teimosa aceita até com pouco).
const acceptChance = (score, at) => 0.12 + 0.88 * sigmoid((score - at) / 1.5);
function envidoUtility(game, idx, ew, { acceptStake, refuseToUs, refuseToThem, oppAcceptAt }) {
  const my = game.players[idx].team;
  const opp = 1 - my;
  const L = limitOf(game);
  const s = game.score;
  const W = (a, b) => matchWinChance(a, b, L);
  let u = 0;
  let tot = 0;
  let winAcc = 0;
  let accW = 0;
  for (const e of ew) {
    const duel = e.weWin ? W(s[my] + acceptStake, s[opp]) : W(s[my], s[opp] + acceptStake);
    let v = duel;
    if (oppAcceptAt !== undefined) {
      const a = acceptChance(e.oppBest, oppAcceptAt);
      v = a * duel + (1 - a) * W(s[my] + refuseToUs, s[opp]);
      winAcc += e.weight * a * (e.weWin ? 1 : 0);
      accW += e.weight * a;
    }
    u += e.weight * v;
    tot += e.weight;
  }
  return {
    u: tot ? u / tot : 0.5,
    refuse: W(s[my], s[opp] + (refuseToThem || 0)),
    winIfAccepted: accW ? winAcc / accW : null
  };
}

function faltaStake(game) {
  return game.faltaPoints ? game.faltaPoints() : Math.max(1, limitOf(game) - Math.max(game.score[0], game.score[1]));
}

function wantsEnvido(game, idx) {
  const player = game.players[idx];
  const lvl = levelOf(player);
  const { worlds, T } = sampleWorlds(game, idx, Math.round(lvl.samples * 0.8), lvl.inference);
  const ew = envidoWorlds(game, idx, worlds, T);
  const my = player.team;
  const L = limitOf(game);
  const s = game.score;
  const none = matchWinChance(s[my], s[1 - my], L);
  const options = [
    { call: 'envido', ...envidoUtility(game, idx, ew, { acceptStake: 2, refuseToUs: 1, oppAcceptAt: 25 }) },
    { call: 'real_envido', ...envidoUtility(game, idx, ew, { acceptStake: 3, refuseToUs: 1, oppAcceptAt: 27 }) },
    { call: 'falta_envido', ...envidoUtility(game, idx, ew, { acceptStake: faltaStake(game), refuseToUs: 1, oppAcceptAt: 29 }) }
  ];
  options.forEach(o => { o.u = noisy(o.u, lvl); });
  // Só canta "de verdade" se ganharia a disputa quando aceitarem (senão é blefe)
  const real = options.filter(o => o.winIfAccepted !== null && o.winIfAccepted >= 0.55);
  const best = real.length ? real.reduce((a, b) => (b.u > a.u ? b : a)) : null;
  if (best && best.u > none + 0.002) return best.call;
  // Envido de mentira, de vez em quando, com pouco ponto
  if (player.envidoScore <= 22 && rand() < lvl.bluff / 2) return 'envido';
  return null;
}

function respondEnvido(game, idx) {
  const h = game.hand;
  const player = game.players[idx];
  const lvl = levelOf(player);
  const my = player.team;
  const opp = 1 - my;
  const L = limitOf(game);
  const s = game.score;
  const call = h.envidoHistory[h.envidoHistory.length - 1];
  const atStake = h.envidoPointsAtStake;
  const refusePts = h.envidoPointsBeforeLastRaise || 1;
  const mayRaise = !player.hasFlor;

  // Correr entrega o jogo: aceita
  if (s[opp] + refusePts >= L) return { action: 'envido_response', value: 'quero' };

  const { worlds, T } = sampleWorlds(game, idx, lvl.samples, lvl.inference);
  const ew = envidoWorlds(game, idx, worlds, T);
  const acceptStake = call === 'falta_envido' ? faltaStake(game) : atStake;
  const quero = envidoUtility(game, idx, ew, { acceptStake, refuseToThem: refusePts });
  const options = [
    { d: { action: 'envido_response', value: 'quero' }, u: quero.u },
    { d: { action: 'envido_response', value: 'nao_quero' }, u: quero.refuse }
  ];
  if (mayRaise && call !== 'falta_envido') {
    const envCount = h.envidoHistory.filter(c => c === 'envido').length;
    // Aumentar só quando ganharia a disputa na maioria das vezes
    const raises = [];
    if (call === 'envido' && envCount < 2) raises.push(['envido', envidoUtility(game, idx, ew, { acceptStake: atStake + 2, refuseToUs: atStake, oppAcceptAt: 27 })]);
    if (call === 'envido') raises.push(['real_envido', envidoUtility(game, idx, ew, { acceptStake: atStake + 3, refuseToUs: atStake, oppAcceptAt: 28 })]);
    raises.push(['falta_envido', envidoUtility(game, idx, ew, { acceptStake: faltaStake(game), refuseToUs: atStake, oppAcceptAt: 30 })]);
    raises.forEach(([value, r]) => {
      if (r.winIfAccepted !== null && r.winIfAccepted >= 0.62) options.push({ d: { action: 'envido_raise', value }, u: r.u });
    });
  }
  options.forEach(o => { o.u = noisy(o.u, lvl); });
  const best = options.reduce((a, b) => (b.u > a.u ? b : a));
  return best.d;
}

// Mantido para os testes e o servidor: o bot aceita o Falta Envido?
function respondFaltaEnvido(game, idx) {
  const d = respondEnvido(game, idx);
  return d.value === 'quero' || d.action === 'envido_raise';
}

// Lembra quem pede Falta Envido (quem pede sempre está blefando muitas vezes)
function noteFaltaCall(game, team) {
  const memo = game.botMemo || (game.botMemo = { falta: [0, 0] });
  memo.falta[team] = (memo.falta[team] || 0) + 1;
}

// ---------------------------------------------------------------------------
// Flor
// ---------------------------------------------------------------------------
function florWinChance(game, idx, worlds, T) {
  let win = 0;
  let tot = 0;
  for (const w of worlds) {
    const scores = {};
    for (const i of T.order) {
      if (T.folded(i)) continue;
      const p = game.players[i];
      if (T.team[i] === T.myTeam) { if (p.hasFlor) scores[i] = p.florScore; }
      else {
        const orig = (w.played[i] || []).concat(w.hands[i] || []);
        const f = orig.length === 3 ? calculateFlorScore(orig) : 0;
        if (f > 0 && (game.hand.florCallers || []).includes(i)) scores[i] = f;
      }
    }
    let winner = -1;
    for (const i of T.order) {
      if (scores[i] === undefined) continue;
      if (winner === -1 || scores[i] > scores[winner]) winner = i;
    }
    if (winner === -1) continue;
    win += w.weight * (T.team[winner] === T.myTeam ? 1 : 0);
    tot += w.weight;
  }
  return tot ? win / tot : 0.5;
}

function respondFlor(game, idx) {
  const h = game.hand;
  const player = game.players[idx];
  const lvl = levelOf(player);
  const my = player.team;
  const opp = 1 - my;
  const L = limitOf(game);
  const s = game.score;
  const W = (a, b) => matchWinChance(a, b, L);
  const call = h.florHistory[h.florHistory.length - 1];

  const { worlds, T } = sampleWorlds(game, idx, lvl.samples, lvl.inference);
  let pF = florWinChance(game, idx, worlds, T);
  // Quem aumentou para Contra-Flor costuma ter Flor alta
  if (call !== 'flor') pF *= 0.85;
  pF = noisy(pF, lvl);
  const resto = 6 + faltaStake(game);
  const duel = stake => pF * W(s[my] + stake, s[opp]) + (1 - pF) * W(s[my], s[opp] + stake);

  if (call === 'flor') {
    // Por cima de uma Flor não existe "Quero": aumenta ou achica (perde 3)
    const uAchique = W(s[my], s[opp] + 3);
    const r = 0.3; // chance de quem cantou achicar a nossa Contra-Flor (ganhamos 3)
    const uContra = r * W(s[my] + 3, s[opp]) + (1 - r) * duel(6);
    const uResto = r * W(s[my] + 3, s[opp]) + (1 - r) * duel(resto);
    if (uResto > uContra && uResto > uAchique && pF > 0.7) return { action: 'flor_raise', value: 'contra_flor_resto' };
    if (uContra >= uAchique) return { action: 'flor_raise', value: 'contra_flor' };
    return { action: 'flor_response', value: 'nao_quero' };
  }
  if (call === 'contra_flor') {
    const uAchique = W(s[my], s[opp] + 3);
    const uQuero = duel(6);
    const uResto = 0.25 * W(s[my] + 6, s[opp]) + 0.75 * duel(resto);
    if (uResto > uQuero && uResto > uAchique && pF > 0.72) return { action: 'flor_raise', value: 'contra_flor_resto' };
    return { action: 'flor_response', value: uQuero >= uAchique ? 'quero' : 'nao_quero' };
  }
  // Contra-Flor e o Resto
  const prev = h.florHistory.includes('contra_flor') ? 6 : 3;
  return { action: 'flor_response', value: duel(resto) >= W(s[my], s[opp] + prev) ? 'quero' : 'nao_quero' };
}

// ---------------------------------------------------------------------------
// Decisão do bot (uma ação por vez)
// ---------------------------------------------------------------------------
function handleBotAction(game, playerIdx) {
  if (!game.hand || game.state !== 'playing') return null;
  const h = game.hand;
  const player = game.players[playerIdx];
  const handCards = h.hands[playerIdx] || [];

  // Pode cantar Envido/Flor agora? (1ª vaza, antes de jogar a própria carta)
  const canSingNow = h.currentRound === 0 && !game.hasPlayerPlayedCard(playerIdx) && h.canCallEnvido;

  // 1. Responder Envido (a Flor vem antes)
  if (h.envidoResponsePending && h.envidoPendingTeam === player.team) {
    if (canSingNow && player.hasFlor && h.florState === 'none') return { action: 'call_flor' };
    return respondEnvido(game, playerIdx);
  }

  // 2. Responder Flor
  if (h.florResponsePending && h.florPendingTeam === player.team) {
    if (!player.hasFlor) return { action: 'flor_response', value: 'nao_quero' };
    return respondFlor(game, playerIdx);
  }

  // 3. Responder Truco — "o envido está primeiro": pode cantar Envido/Flor antes
  if (h.trucoResponsePending && h.trucoPendingTeam === player.team) {
    const canSingOverTruco = canSingNow && h.trucoState === 'truco' && h.envidoState === 'none';
    if (canSingOverTruco && player.hasFlor && h.florState === 'none') return { action: 'call_flor' };
    if (canSingOverTruco && !player.hasFlor) {
      const call = wantsEnvido(game, playerIdx);
      if (call) return { action: 'call_envido', value: call };
    }
    return respondTruco(game, playerIdx);
  }

  // Enquanto houver aposta esperando resposta, o bot não inicia outra
  if (h.envidoResponsePending || h.florResponsePending || h.trucoResponsePending) return null;
  if (h.currentPlayer !== playerIdx || handCards.length === 0) return null;

  // 4. Cantar Flor (obrigatório) ou Envido (só o pé, nas duplas)
  if (canSingNow) {
    if (player.hasFlor && h.florState === 'none' && h.envidoState === 'none') return { action: 'call_flor' };
    if (!player.hasFlor && h.envidoState === 'none' && game.isPe(playerIdx)) {
      const call = wantsEnvido(game, playerIdx);
      if (call) return { action: 'call_envido', value: call };
    }
  }

  // 5. Trucar
  if (wantsToTruco(game, playerIdx)) return { action: 'call_truco' };

  // 6. Jogar carta
  return { action: 'play_card', value: selectCardToPlay(game, playerIdx) };
}

module.exports = {
  handleBotAction,
  estimateWinChance,
  respondFaltaEnvido,
  noteFaltaCall,
  matchWinChance,
  envidoBelow,
  // para os testes de situações
  _internal: { handChances, selectCardToPlay, sampleWorlds, makeSearcher, stateFor, handWinner }
};
