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

  // Advanced
  const vaza = state.vaza;
  const botTeam = teams[botId] as 1 | 2;
  const isLastInVaza = vaza.length === 3;
  const vazaHasPoints = vaza.reduce((acc, v) => acc + v.card.points, 0) > 0;

  // Separa cartas por tipo
  const nonTrump = validCards.filter(c => c.suit !== trumpSuit);
  const trumpCards = validCards.filter(c => c.suit === trumpSuit);

  // Cartas já jogadas do trunfo
  const playedTrumps = playedCards.filter(c => c.suit === trumpSuit);
  const manyTrumpsOut = trumpSuit ? playedTrumps.length >= 4 : false;

  if (vaza.length === 0) {
    // Liderando: joga carta mais forte se tem trunfo forte, senão menor não-trunfo
    if (trumpCards.length > 0 && manyTrumpsOut) {
      return trumpCards.reduce((a, b) => a.rank > b.rank ? a : b);
    }
    const pool = nonTrump.length > 0 ? nonTrump : validCards;
    return pool.reduce((a, b) => a.rank < b.rank ? a : b);
  }

  if (isLastInVaza) {
    const currentWinnerIdx = resolveWinner(vaza, trumpSuit);
    const currentWinner = vaza[currentWinnerIdx];
    const partnerWinning = teams[currentWinner.userId] === botTeam;

    if (partnerWinning && !vazaHasPoints) {
      // Parceiro ganha e vaza sem pontos: descarta menor
      const pool = nonTrump.length > 0 ? nonTrump : validCards;
      return pool.reduce((a, b) => a.rank < b.rank ? a : b);
    }

    if (partnerWinning && vazaHasPoints) {
      // Parceiro ganha vaza com pontos: descarta menor não-trunfo
      const pool = nonTrump.length > 0 ? nonTrump : validCards;
      return pool.reduce((a, b) => a.rank < b.rank ? a : b);
    }

    // Adversário ganhando: tenta ganhar com menor custo
    const winningCards = validCards.filter(card => {
      const testVaza = [...vaza, { userId: botId, card }];
      const winIdx = resolveWinner(testVaza, trumpSuit);
      return testVaza[winIdx].userId === botId;
    });

    if (winningCards.length > 0 && (vazaHasPoints || isLastInVaza)) {
      return winningCards.reduce((a, b) => a.rank < b.rank ? a : b);
    }

    // Não pode ganhar: descarta menor
    const pool = nonTrump.length > 0 ? nonTrump : validCards;
    return pool.reduce((a, b) => a.rank < b.rank ? a : b);
  }

  // Meio da vaza
  const currentWinnerIdx = resolveWinner(vaza, trumpSuit);
  const currentWinner = vaza[currentWinnerIdx];
  const partnerWinning = teams[currentWinner.userId] === botTeam;

  if (partnerWinning) {
    // Parceiro está ganhando: joga a menor não-trunfo
    const pool = nonTrump.length > 0 ? nonTrump : validCards;
    return pool.reduce((a, b) => a.rank < b.rank ? a : b);
  }

  // Adversário ganhando: joga carta que pode ganhar se vaza tem valor
  if (vazaHasPoints) {
    const winningCards = validCards.filter(card => {
      const testVaza = [...vaza, { userId: botId, card }];
      const winIdx = resolveWinner(testVaza, trumpSuit);
      return testVaza[winIdx].userId === botId;
    });
    if (winningCards.length > 0) {
      return winningCards.reduce((a, b) => a.rank < b.rank ? a : b);
    }
  }

  // Descarta menor
  const pool = nonTrump.length > 0 ? nonTrump : validCards;
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
