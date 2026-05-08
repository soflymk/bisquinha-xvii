/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bot AI para Bisca Capixaba
 */

import { Card, GameState } from './types';

export type BotLevel = 'basic' | 'medium' | 'advanced';

// Valores que são biscas (trunfo inativo ou bisca pura)
const HIGH_VALUES = new Set(['A', '7', 'K', 'Q', 'J']);

/**
 * Retorna o conjunto de cartas válidas para o bot jogar.
 * Aplica as mesmas regras do play_card handler do servidor.
 */
export function getValidBotCards(
  hand: Card[],
  state: GameState,
  sevenTrumpPlayed: boolean
): Card[] {
  if (hand.length === 0) return [];

  const validCards: Card[] = [];

  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];

    // Regra: Ás do corte antes do 7 do corte
    if (card.suit === state.trumpSuit && card.value === 'A' && !sevenTrumpPlayed && hand.length > 1) {
      const hasTrumpSeven = hand.some((c, j) => j !== i && c.suit === state.trumpSuit && c.value === '7');
      if (!hasTrumpSeven) continue; // inválida
    }

    // Regra: 7 do corte não pode sair de fundo (último da rodada)
    if (card.suit === state.trumpSuit && card.value === '7' && state.vaza.length === 3) {
      const hasAce = hand.some((c, j) => j !== i && c.suit === state.trumpSuit && c.value === 'A');
      const isLastCard = hand.length === 1;
      if (!isLastCard && !hasAce) continue; // inválida
    }

    validCards.push(card);
  }

  // Se nenhuma carta for válida (improvável), retornar todas (failsafe)
  return validCards.length > 0 ? validCards : hand;
}

/**
 * Dada a vaza atual, retorna o índice da carta vencedora respeitando trunfo.
 */
function resolveWinner(
  vaza: { userId: string; card: Card }[],
  trumpSuit: string | null
): number {
  if (vaza.length === 0) return -1;
  let winnerIdx = 0;
  const leadSuit = vaza[0].card.suit;
  for (let i = 1; i < vaza.length; i++) {
    const wCard = vaza[winnerIdx].card;
    const nCard = vaza[i].card;
    if (trumpSuit && nCard.suit === trumpSuit) {
      if (!trumpSuit || wCard.suit !== trumpSuit) {
        winnerIdx = i;
      } else if (nCard.rank > wCard.rank) {
        winnerIdx = i;
      }
    } else if (!trumpSuit || wCard.suit !== trumpSuit) {
      if (nCard.suit === leadSuit && nCard.rank > wCard.rank) {
        winnerIdx = i;
      }
    }
  }
  return winnerIdx;
}

/**
 * Escolhe qual carta o bot vai jogar.
 */
export function chooseBotCard(
  hand: Card[],
  state: GameState,
  botId: string,
  botLevel: BotLevel,
  sevenTrumpPlayed: boolean,
  playedCards: Card[],
  slots: (string | null)[],
  teams: Record<string, 1 | 2>
): Card {
  const validCards = getValidBotCards(hand, state, sevenTrumpPlayed);
  const trumpSuit = state.trumpSuit;

  if (botLevel === 'basic') {
    return validCards[Math.floor(Math.random() * validCards.length)];
  }

  if (botLevel === 'medium') {
    const vaza = state.vaza;
    const isLastInVaza = vaza.length === 3;
    const botTeam = teams[botId] as 1 | 2;

    if (isLastInVaza) {
      // Tenta ganhar com menor carta possível
      const currentWinnerIdx = resolveWinner(vaza, trumpSuit);
      const currentWinner = vaza[currentWinnerIdx];
      const partnerWinning = teams[currentWinner.userId] === botTeam;

      if (partnerWinning) {
        // Parceiro ganhando: joga a menor carta não-trunfo
        const nonTrump = validCards.filter(c => c.suit !== trumpSuit);
        const pool = nonTrump.length > 0 ? nonTrump : validCards;
        return pool.reduce((a, b) => a.rank < b.rank ? a : b);
      }

      // Tenta ganhar com menor carta vencedora
      const winningCards = validCards.filter(card => {
        const testVaza = [...vaza, { userId: botId, card }];
        const winIdx = resolveWinner(testVaza, trumpSuit);
        return testVaza[winIdx].userId === botId;
      });

      if (winningCards.length > 0) {
        return winningCards.reduce((a, b) => a.rank < b.rank ? a : b);
      }

      // Não pode ganhar: joga a menor
      return validCards.reduce((a, b) => a.rank < b.rank ? a : b);
    }

    // Não é o último: joga menor carta válida
    return validCards.reduce((a, b) => a.rank < b.rank ? a : b);
  }

  // ══════════════════════════════════════════════════════════════
  //  ADVANCED
  // ══════════════════════════════════════════════════════════════
  const vaza = state.vaza;
  const botTeam = teams[botId] as 1 | 2;
  const isLastInVaza  = vaza.length === 3;
  const isThirdInVaza = vaza.length === 2;
  const vazaHasPoints = vaza.reduce((acc, v) => acc + v.card.points, 0) > 0;

  const nonTrump   = validCards.filter(c => c.suit !== trumpSuit);
  const trumpCards = validCards.filter(c => c.suit === trumpSuit);

  const playedTrumps = playedCards.filter(c => c.suit === trumpSuit);
  const manyTrumpsOut = trumpSuit ? playedTrumps.length >= 4 : false;

  // ── REGRA 2: Evitar heley — guardar o 7 do corte enquanto o Ás não saiu ──
  // O heley ocorre quando: adversário joga Ás APÓS o 7 e ganha a vaza.
  // Estratégia: não jogar o 7 enquanto o Ás do corte ainda está no jogo,
  // a não ser que seja a única opção válida ou a última carta na mão.
  const botHasTrumpSeven = validCards.some(c => c.suit === trumpSuit && c.value === '7');
  const trumpAcePlayed   = playedCards.some(c => c.suit === trumpSuit && c.value === 'A');
  const shouldAvoidTrumpSeven = (
    botHasTrumpSeven &&
    !sevenTrumpPlayed &&   // ninguém jogou o 7 ainda
    !trumpAcePlayed &&     // Ás ainda não foi jogado
    validCards.length > 1  // ainda tem outras opções
  );

  // Pool seguro: exclui o 7 do corte se deve evitá-lo
  const safeValidCards  = shouldAvoidTrumpSeven
    ? validCards.filter(c => !(c.suit === trumpSuit && c.value === '7'))
    : validCards;
  const safeNonTrump    = safeValidCards.filter(c => c.suit !== trumpSuit);
  const safeTrumpCards  = safeValidCards.filter(c => c.suit === trumpSuit);

  // ── Estado da vaza atual ──────────────────────────────────────
  const currentWinnerIdx = vaza.length > 0 ? resolveWinner(vaza, trumpSuit) : -1;
  const currentWinner    = currentWinnerIdx >= 0 ? vaza[currentWinnerIdx] : null;
  const partnerWinning   = currentWinner ? teams[currentWinner.userId] === botTeam : false;

  // Há bisca (7 ou Ás de qualquer naipe) na vaza
  const vazaHasBisca = vaza.some(v => v.card.value === 'A' || v.card.value === '7');

  // REGRA 3: devo cortar quando há bisca, EXCETO se for o último e a dupla já ganha
  const shouldCutForBisca = vazaHasBisca && !(isLastInVaza && partnerWinning);

  // ── Helper: menor carta vencedora ────────────────────────────
  const smallestWinner = (pool: Card[]) => {
    const winners = pool.filter(card => {
      const testVaza = [...vaza, { userId: botId, card }];
      const winIdx   = resolveWinner(testVaza, trumpSuit);
      return testVaza[winIdx].userId === botId;
    });
    return winners.length > 0 ? winners.reduce((a, b) => a.rank < b.rank ? a : b) : null;
  };

  // ── LIDERANDO (1ª posição) ────────────────────────────────────
  if (vaza.length === 0) {
    if (trumpCards.length > 0 && manyTrumpsOut) {
      // Muitos trunfos já saíram: lidera com o maior trunfo (evitando o 7 se necessário)
      const pool = shouldAvoidTrumpSeven
        ? trumpCards.filter(c => c.value !== '7')
        : trumpCards;
      const chosen = pool.length > 0 ? pool : trumpCards;
      return chosen.reduce((a, b) => a.rank > b.rank ? a : b);
    }
    // Lidera com a menor carta segura (não-trunfo, sem o 7 se possível)
    const pool = safeNonTrump.length > 0 ? safeNonTrump : safeValidCards;
    return pool.reduce((a, b) => a.rank < b.rank ? a : b);
  }

  // ── 4ª POSIÇÃO (ÚLTIMO) ───────────────────────────────────────
  if (isLastInVaza) {

    // REGRA: Dupla ganhando + último → NUNCA jogar trunfo, só se não tiver jeito
    if (partnerWinning) {
      // Maximiza pontos: joga a carta não-trunfo de maior valor
      const nonTrumpSorted = [...nonTrump].sort((a, b) => b.points - a.points || b.rank - a.rank);
      if (nonTrumpSorted.length > 0) return nonTrumpSorted[0];
      // Sem opção não-trunfo: joga o menor trunfo possível (último recurso)
      return safeValidCards.reduce((a, b) => a.rank < b.rank ? a : b);
    }

    // Adversário ganhando — REGRA 3: bisca na mesa → corta com trunfo
    if (shouldCutForBisca && safeTrumpCards.length > 0) {
      const cut = smallestWinner(safeTrumpCards);
      if (cut) return cut;
    }
    // Tenta ganhar com menor custo
    const winner = smallestWinner(safeValidCards);
    if (winner) return winner;
    // Não pode ganhar: descarta menor
    const pool4 = safeNonTrump.length > 0 ? safeNonTrump : safeValidCards;
    return pool4.reduce((a, b) => a.rank < b.rank ? a : b);
  }

  // ── 3ª POSIÇÃO ────────────────────────────────────────────────
  if (isThirdInVaza) {

    // REGRA 1: Dupla ganhando → aumentar pontuação
    if (partnerWinning) {
      const nonTrumpSorted = [...nonTrump].sort((a, b) => b.points - a.points || b.rank - a.rank);
      if (nonTrumpSorted.length > 0) return nonTrumpSorted[0];
      return safeValidCards.reduce((a, b) => a.rank < b.rank ? a : b);
    }

    // Adversário ganhando
    // REGRA 3: Bisca na mesa → tenta cortar com menor trunfo vencedor
    if (shouldCutForBisca && safeTrumpCards.length > 0) {
      const cut = smallestWinner(safeTrumpCards);
      if (cut) return cut;
    }

    // Tenta ganhar com menor custo (qualquer carta)
    const winner = smallestWinner(safeValidCards);
    if (winner && (vazaHasPoints || isLastInVaza)) return winner;

    // Não pode ganhar: descarta menor (sem desperdiçar o 7 do corte)
    const pool = safeNonTrump.length > 0 ? safeNonTrump : safeValidCards;
    return pool.reduce((a, b) => a.rank < b.rank ? a : b);
  }

  // ── 2ª POSIÇÃO ────────────────────────────────────────────────
  if (partnerWinning) {
    // Parceiro ganhando: descarta menor (conserva trunfo e o 7)
    const pool = safeNonTrump.length > 0 ? safeNonTrump : safeValidCards;
    return pool.reduce((a, b) => a.rank < b.rank ? a : b);
  }

  // REGRA 3: Bisca do adversário → tenta cortar
  if (shouldCutForBisca && safeTrumpCards.length > 0) {
    const cut = smallestWinner(safeTrumpCards);
    if (cut) return cut;
  }

  // Adversário ganhando: tenta ganhar se vaza tem valor
  if (vazaHasPoints) {
    const winner = smallestWinner(safeValidCards);
    if (winner) return winner;
  }

  // Descarta menor
  const pool = safeNonTrump.length > 0 ? safeNonTrump : safeValidCards;
  return pool.reduce((a, b) => a.rank < b.rank ? a : b);
}

/**
 * Escolhe qual carta do corte selecionar (5 opções).
 * Retorna { cardId } para selecionar carta ou { isBater: true } para bater em copas.
 */
export function chooseBotCorte(
  cuttingCards: Card[],
  botLevel: BotLevel
): { cardId: string } | { isBater: boolean } {
  if (botLevel === 'basic') {
    const idx = Math.floor(Math.random() * cuttingCards.length);
    return { cardId: cuttingCards[idx].id };
  }

  // Medium e Advanced: evitar A e 7 (biscas), preferir cartas do meio
  const nonBisca = cuttingCards.filter(c => c.value !== 'A' && c.value !== '7');

  if (botLevel === 'medium') {
    const pool = nonBisca.length > 0 ? nonBisca : cuttingCards;
    // Prefere cartas do meio (rank médio)
    const sorted = [...pool].sort((a, b) => Math.abs(a.rank - 5) - Math.abs(b.rank - 5));
    return { cardId: sorted[0].id };
  }

  // Advanced: igualmente evita A/7; pode ser mais ousado se muitos trunfos já saíram
  // (mas no corte não temos info de playedCards facilmente, então usa mesma heurística)
  const pool = nonBisca.length > 0 ? nonBisca : cuttingCards;
  const sorted = [...pool].sort((a, b) => Math.abs(a.rank - 5) - Math.abs(b.rank - 5));
  return { cardId: sorted[0].id };
}

/**
 * Decide se o bot troca o 2 pelo corte.
 */
export function shouldBotSwap2(
  _hand: Card[],
  corteCard: Card,
  botLevel: BotLevel
): boolean {
  if (botLevel === 'basic') return true;
  if (botLevel === 'medium') return corteCard.points > 2;
  // Advanced: troca se a carta do corte é de alto valor estratégico
  return HIGH_VALUES.has(corteCard.value);
}

/**
 * Decide se o bot bate em copas.
 */
export function shouldBotBaterCopas(
  hand: Card[],
  trumpSuit: string,
  gameScore: { team1: number; team2: number },
  botTeam: 1 | 2,
  botLevel: BotLevel
): boolean {
  if (botLevel === 'basic') return false;
  if (botLevel === 'medium') return false;

  // Advanced: bate se time perdendo, placar apertado, tem A + 7 do trunfo
  const myScore = botTeam === 1 ? gameScore.team1 : gameScore.team2;
  const oppScore = botTeam === 1 ? gameScore.team2 : gameScore.team1;
  const isLosing = myScore < oppScore;
  const isClose = myScore >= 2 && oppScore >= 2;
  const hasAce = hand.some(c => c.suit === trumpSuit && c.value === 'A');
  const hasSeven = hand.some(c => c.suit === trumpSuit && c.value === '7');

  return isLosing && isClose && hasAce && hasSeven;
}
