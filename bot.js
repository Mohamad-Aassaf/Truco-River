// bot.js
// Inteligência dos bots do Truco Gaúcho (Fácil, Médio, Difícil).
//
// O coração é estimateWinChance: o bot sorteia muitas vezes as cartas que os
// adversários podem ter (só as que ele não viu), joga o resto da mão de forma
// simples e conta quantas vezes o time dele ganha. Com essa chance ele decide:
// - qual carta jogar (a que dá mais chance de ganhar a mão);
// - quando trucar, aceitar, correr ou aumentar;
// e leva em conta o placar (não corre se correr entrega o jogo).
//
// Fácil erra de propósito, Médio pensa pouco e Difícil pensa bastante.

const { createDeck } = require('./gameEngine');

const DECK = createDeck();
const cardKey = c => `${c.value}-${c.suit}`;

const LEVEL = {
  easy: { samples: 40, noise: 0.35, bluff: 0.10 },
  medium: { samples: 120, noise: 0.10, bluff: 0.06 },
  hard: { samples: 260, noise: 0, bluff: 0.08 }
};

const levelOf = player => LEVEL[player.difficulty] || LEVEL.medium;
const rand = () => Math.random();

// ---------------------------------------------------------------------------
// Simulação do resto da mão
// ---------------------------------------------------------------------------

// Mesmas regras do motor (checkHandWinner) para decidir quem leva a mão
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
  if (r[1] === -1 && r[0] !== -1 && r[0] !== undefined) return r[0];
  if (r[2] === -1 && r[0] !== -1 && r[1] !== -1 && r[0] !== undefined) return r[0];
  if (r.length === 3 && (r[2] === 0 || r[2] === 1)) return r[2];
  return null;
}

// Como cada jogador joga na simulação (regras simples de quem sabe jogar)
function simPick(ranks, team, round, roundsWon, plays, teamOf) {
  const sorted = ranks.slice().sort((a, b) => a - b);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  const wonFirst = roundsWon[0] === team;

  if (plays.length === 0) {
    // Abrindo a rodada
    if (round === 0) return sorted[Math.floor(sorted.length / 2)];
    if (wonFirst) return lowest; // empatar já ganha a mão
    return highest;
  }

  // Quem está ganhando a rodada até agora
  let best = plays[0];
  let tie = false;
  for (let i = 1; i < plays.length; i++) {
    if (plays[i].rank > best.rank) { best = plays[i]; tie = false; }
    else if (plays[i].rank === best.rank && teamOf(plays[i].idx) !== teamOf(best.idx)) tie = true;
  }
  if (!tie && teamOf(best.idx) === team) return lowest; // parceiro já ganha

  const beats = sorted.filter(r => r > best.rank);
  if (beats.length) return beats[0];
  // Empatar serve quando já ganhamos a primeira
  if (wonFirst && sorted.includes(best.rank)) return best.rank;
  return lowest;
}

// Joga o resto da mão a partir do estado atual. firstRank: carta que quem
// está na vez vai jogar agora (ou null para ele decidir pela regra simples).
function playout(game, ranksByPlayer, firstRank) {
  const h = game.hand;
  const n = game.maxPlayers;
  const teamOf = i => game.players[i].team;
  const folded = i => h.foldedPlayers.has(i);
  const maoTeam = teamOf(h.mão);

  const roundsWon = h.roundsWon.slice();
  let round = h.currentRound;
  let plays = h.playedCards
    .filter(p => p.round === round && !folded(p.playerIdx))
    .map(p => ({ idx: p.playerIdx, rank: p.card.trucoRank }));
  let cur = h.currentPlayer;
  let first = firstRank;

  for (let guard = 0; guard < 20; guard++) {
    const hand = ranksByPlayer[cur];
    if (!folded(cur) && hand && hand.length && !plays.some(p => p.idx === cur)) {
      let rank;
      if (first !== null && first !== undefined) {
        rank = first;
        first = null;
      } else {
        rank = simPick(hand, teamOf(cur), round, roundsWon, plays, teamOf);
      }
      hand.splice(hand.indexOf(rank), 1);
      plays.push({ idx: cur, rank });
    }

    // Próximo que ainda precisa jogar nesta rodada
    let next = -1;
    for (let step = 1; step <= n; step++) {
      const i = (cur + step) % n;
      if (!folded(i) && !plays.some(p => p.idx === i) && ranksByPlayer[i] && ranksByPlayer[i].length) { next = i; break; }
    }
    if (next !== -1) { cur = next; continue; }

    // Fim da rodada
    let best = plays[0];
    let tie = false;
    for (let i = 1; i < plays.length; i++) {
      if (plays[i].rank > best.rank) { best = plays[i]; tie = false; }
      else if (plays[i].rank === best.rank && teamOf(plays[i].idx) !== teamOf(best.idx)) tie = true;
    }
    roundsWon.push(tie ? -1 : teamOf(best.idx));
    const winner = handWinner(roundsWon, maoTeam);
    if (winner !== null) return winner;
    if (roundsWon.length >= 3) return maoTeam;

    round++;
    cur = tie ? h.mão : best.idx;
    while (folded(cur)) cur = (cur + 1) % n;
    plays = [];
  }
  return maoTeam;
}

// Chance (0 a 1) de o time do bot ganhar a mão, jogando até o fim.
// candidateCard: carta que o bot (que está na vez) jogaria agora.
function estimateWinChance(game, botIdx, candidateCard = null, samples = 150) {
  const h = game.hand;
  const n = game.maxPlayers;
  const myTeam = game.players[botIdx].team;
  const partnerIdx = n === 4 ? (botIdx + 2) % 4 : -1;

  // Cartas que o bot já conhece: as dele, as do parceiro e as que estão na mesa
  const known = new Set();
  (h.hands[botIdx] || []).forEach(c => known.add(cardKey(c)));
  if (partnerIdx >= 0) (h.hands[partnerIdx] || []).forEach(c => known.add(cardKey(c)));
  h.playedCards.forEach(p => known.add(cardKey(p.card)));
  const unknown = DECK.filter(c => !known.has(cardKey(c))).map(c => c.trucoRank);

  let wins = 0;
  for (let s = 0; s < samples; s++) {
    // Sorteia as mãos dos adversários entre as cartas não vistas
    const pool = unknown.slice();
    const ranksByPlayer = {};
    for (let i = 0; i < n; i++) {
      const cards = h.hands[i] || [];
      if (i === botIdx || i === partnerIdx) {
        ranksByPlayer[i] = cards.map(c => c.trucoRank);
      } else {
        ranksByPlayer[i] = [];
        for (let k = 0; k < cards.length && pool.length; k++) {
          const j = Math.floor(rand() * pool.length);
          ranksByPlayer[i].push(pool[j]);
          pool[j] = pool[pool.length - 1];
          pool.pop();
        }
      }
    }
    const first = candidateCard ? candidateCard.trucoRank : null;
    if (playout(game, ranksByPlayer, first) === myTeam) wins++;
  }
  return wins / samples;
}

// ---------------------------------------------------------------------------
// Decisões
// ---------------------------------------------------------------------------

const limitOf = game => game.maxPoints || 24;

// Escolhe a carta: Difícil e Médio simulam cada opção; Fácil usa uma regra simples
function selectCardToPlay(game, idx) {
  const player = game.players[idx];
  const cards = game.hand.hands[idx];
  if (cards.length === 1) return 0;
  const lvl = levelOf(player);

  if (player.difficulty === 'easy' && rand() < lvl.noise) {
    return Math.floor(rand() * cards.length);
  }

  const scored = cards.map((c, i) => ({ i, rank: c.trucoRank, p: estimateWinChance(game, idx, c, Math.round(lvl.samples / 2)) }));
  // Em empate de chance, guarda a carta mais forte (joga a menor)
  scored.sort((a, b) => (b.p - a.p) || (a.rank - b.rank));

  // Médio às vezes não acha a melhor
  if (lvl.noise && scored.length > 1 && rand() < lvl.noise) return scored[1].i;
  return scored[0].i;
}

// Pontos que a mão passa a valer se o truco atual for aceito
function trucoStake(state) {
  return state === 'truco' ? 2 : state === 'retruco' ? 3 : 4;
}

function respondTruco(game, idx) {
  const h = game.hand;
  const player = game.players[idx];
  const lvl = levelOf(player);
  const myTeam = player.team;
  const oppTeam = 1 - myTeam;
  const stake = trucoStake(h.trucoState);
  const canRaise = h.trucoState === 'truco' || h.trucoState === 'retruco';
  const raise = { action: 'truco_raise', value: h.trucoState === 'truco' ? 'retruco' : 'vale4' };
  const quero = { action: 'truco_response', value: 'quero' };
  const corre = { action: 'truco_response', value: 'nao_quero' };

  // Correr entrega o jogo? Então aceita (não há o que perder)
  if (game.score[oppTeam] + (stake - 1) >= limitOf(game)) return canRaise && rand() < 0.3 ? raise : quero;

  // Quem trucou costuma ter jogo: desconta um pouco da chance
  let p = estimateWinChance(game, idx, null, lvl.samples);
  p *= player.difficulty === 'hard' ? 0.85 : 0.9;
  if (player.difficulty === 'easy') p = p * 0.6 + rand() * 0.4;

  // Perder a aposta aceita entrega o jogo: fica mais exigente
  let acceptAt = player.difficulty === 'hard' ? 0.36 : player.difficulty === 'medium' ? 0.42 : 0.45;
  if (game.score[oppTeam] + stake >= limitOf(game)) acceptAt += 0.1;
  const raiseAt = player.difficulty === 'hard' ? 0.7 : 0.78;

  if (canRaise && (p >= raiseAt || (p < 0.25 && rand() < lvl.bluff / 2))) return raise;
  if (p >= acceptAt) return quero;
  // Blefe raro: aceita mesmo fraco
  if (stake === 2 && rand() < lvl.bluff / 2) return quero;
  return corre;
}

function wantsToTruco(game, idx) {
  const h = game.hand;
  const player = game.players[idx];
  const lvl = levelOf(player);
  const myTeam = player.team;
  if (h.trucoState === 'vale4' || h.trucoCallerTeam === myTeam) return false;

  const stake = trucoStake(h.trucoState === 'none' ? 'truco' : h.trucoState === 'truco' ? 'retruco' : 'vale4');
  // Não precisa de mais pontos do que faltam para ganhar o jogo
  const missing = limitOf(game) - game.score[myTeam];

  if (player.difficulty === 'easy') {
    const p = estimateWinChance(game, idx, null, lvl.samples);
    return p >= 0.6 ? rand() < 0.5 : rand() < 0.08;
  }

  const p = estimateWinChance(game, idx, null, lvl.samples);
  const hard = player.difficulty === 'hard';

  if (p >= (hard ? 0.72 : 0.75)) {
    // Mão muito forte logo no começo: às vezes espera para o adversário não fugir
    if (h.currentRound === 0 && p >= 0.88 && missing > 1 && rand() < (hard ? 0.45 : 0.25)) return false;
    return rand() < (hard ? 0.9 : 0.7);
  }
  if (p >= 0.55) return rand() < (hard ? 0.3 : 0.2);
  // Blefe: mais comum depois da primeira rodada, quando dá para "contar história"
  if (p < 0.3 && stake <= 2) return rand() < (h.currentRound > 0 ? lvl.bluff : lvl.bluff / 3);
  return false;
}

// O nosso time ganha empates no envido? (quem está mais perto do mão ganha)
function winsEnvidoTies(game, idx) {
  const n = game.maxPlayers;
  const team = game.players[idx].team;
  for (let k = 0; k < n; k++) {
    const i = (game.hand.mão + k) % n;
    if (game.hand.foldedPlayers.has(i) || game.players[i].hasFlor) continue;
    return game.players[i].team === team;
  }
  return false;
}

// Melhor envido do time (o bot conhece o do parceiro)
function teamEnvido(game, idx) {
  let best = game.players[idx].envidoScore;
  if (game.maxPlayers === 4) {
    const partner = game.players[(idx + 2) % 4];
    if (partner && !partner.hasFlor && !game.hand.foldedPlayers.has((idx + 2) % 4)) best = Math.max(best, partner.envidoScore);
  }
  return best;
}

function respondEnvido(game, idx) {
  const h = game.hand;
  const player = game.players[idx];
  const myTeam = player.team;
  const oppTeam = 1 - myTeam;
  const call = h.envidoHistory[h.envidoHistory.length - 1];
  const score = teamEnvido(game, idx) + (winsEnvidoTies(game, idx) ? 1 : 0);
  const quero = { action: 'envido_response', value: 'quero' };
  const corre = { action: 'envido_response', value: 'nao_quero' };

  // Correr entrega o jogo: aceita
  const refusePoints = h.envidoPointsBeforeLastRaise || 1;
  if (game.score[oppTeam] + refusePoints >= limitOf(game)) return quero;
  // Quem tem Flor não pode aumentar o Envido: só aceita ou corre
  const mayRaise = !player.hasFlor;

  if (player.difficulty === 'easy') {
    return score >= 26 || rand() < 0.25 ? quero : corre;
  }

  const hard = player.difficulty === 'hard';
  const history = h.envidoHistory;
  if (call === 'envido') {
    if (mayRaise && score >= (hard ? 31 : 32)) {
      if (history.filter(c => c === 'envido').length < 2 && rand() < 0.3) return { action: 'envido_raise', value: 'envido' };
      return { action: 'envido_raise', value: rand() < 0.6 ? 'real_envido' : 'falta_envido' };
    }
    return score >= (hard ? 27 : 26) ? quero : corre;
  }
  if (call === 'real_envido') {
    if (mayRaise && score >= 32 && rand() < (hard ? 0.5 : 0.3)) return { action: 'envido_raise', value: 'falta_envido' };
    return score >= (hard ? 28 : 28) ? quero : corre;
  }
  // Falta envido: perder pode custar o jogo, então só com muito ponto
  const behind = game.score[oppTeam] - game.score[myTeam];
  return score >= (behind >= 8 ? 28 : 30) ? quero : corre;
}

function wantsEnvido(game, idx) {
  const player = game.players[idx];
  const score = teamEnvido(game, idx);
  const lvl = levelOf(player);
  const ties = winsEnvidoTies(game, idx);

  if (player.difficulty === 'easy') {
    if (score >= 28 || rand() < 0.12) return rand() < 0.5 ? 'envido' : 'real_envido';
    return null;
  }

  const hard = player.difficulty === 'hard';
  if (score >= 31) return rand() < 0.5 ? 'real_envido' : 'envido';
  if (score >= (ties ? 27 : 28)) return rand() < (hard ? 0.85 : 0.7) ? 'envido' : null;
  if (score >= 25 && ties && hard) return rand() < 0.35 ? 'envido' : null;
  // Envido de mentira com pouco ponto (o outro costuma correr)
  if (score <= 21 && rand() < lvl.bluff / 2) return 'envido';
  return null;
}

function respondFlor(game, idx) {
  const h = game.hand;
  const player = game.players[idx];
  const call = h.florHistory[h.florHistory.length - 1];
  const score = player.florScore;

  if (player.difficulty === 'easy') {
    return { action: 'flor_response', value: rand() < 0.7 ? 'quero' : 'nao_quero' };
  }
  const hard = player.difficulty === 'hard';
  if (call === 'flor') {
    if (score >= 32 && rand() < 0.4) return { action: 'flor_raise', value: 'contra_flor_resto' };
    if (score >= (hard ? 28 : 29)) return { action: 'flor_raise', value: 'contra_flor' };
    return { action: 'flor_response', value: 'quero' };
  }
  if (call === 'contra_flor') {
    return { action: 'flor_response', value: score >= (hard ? 29 : 30) ? 'quero' : 'nao_quero' };
  }
  return { action: 'flor_response', value: score >= (hard ? 31 : 32) ? 'quero' : 'nao_quero' };
}

// Toma a decisão do bot (uma ação por vez)
function handleBotAction(game, playerIdx) {
  if (!game.hand || game.state !== 'playing') return null;
  const h = game.hand;
  const player = game.players[playerIdx];
  const handCards = h.hands[playerIdx] || [];

  // Pode cantar Envido/Flor agora? (1ª rodada, antes de jogar a própria carta)
  const canSingNow = h.currentRound === 0 && !game.hasPlayerPlayedCard(playerIdx) && h.canCallEnvido;

  // 1. Responder Envido (vem antes do Truco)
  if (h.envidoResponsePending && h.envidoPendingTeam === player.team) {
    if (canSingNow && player.hasFlor && h.florState === 'none') return { action: 'call_flor' };
    return respondEnvido(game, playerIdx);
  }

  // 2. Responder Flor
  if (h.florResponsePending && h.florPendingTeam === player.team) {
    if (!player.hasFlor) return { action: 'flor_response', value: 'nao_quero' };
    return respondFlor(game, playerIdx);
  }

  // 3. Responder Truco — "o envido está primeiro": canta Envido/Flor antes de responder
  // (só contra um Truco simples; cantar cancela o Truco)
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

  // 4. Cantar Flor ou Envido
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
  estimateWinChance
};
