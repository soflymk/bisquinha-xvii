/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Engine para Bisca Capixaba (4 jogadores, 2 duplas)
 */

import { Card, CardValue, GameState, RoomStatus, Suit } from './types';
import { v4 as uuidv4 } from 'uuid';

export const SUITS: Suit[] = ['Copas', 'Ouros', 'Espadas', 'Paus'];
export const VALUES: CardValue[] = ['A', '7', 'K', 'J', 'Q', '6', '5', '4', '3', '2'];

// Pontuação e Rank da Bisca Capixaba
const CARD_POINTS: Record<CardValue, number> = {
  'A': 11,
  '7': 10,
  'K': 4,
  'J': 3,
  'Q': 2,
  '6': 0,
  '5': 0,
  '4': 0,
  '3': 0,
  '2': 0
};

const CARD_RANK: Record<CardValue, number> = {
  'A': 10,
  '7': 9,
  'K': 8,
  'J': 7,
  'Q': 6,
  '6': 5,
  '5': 4,
  '4': 3,
  '3': 2,
  '2': 1
};

export class BiscaEngine {
  static createDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
      for (const value of VALUES) {
        deck.push({
          id: uuidv4(),
          suit,
          value,
          points: CARD_POINTS[value],
          rank: CARD_RANK[value]
        });
      }
    }
    return deck;
  }

  static shuffle(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  static initGame(userIds: string[], positions: Record<string, number>, teamMap: Record<string, 1 | 2>): GameState {
    let deck = this.shuffle(this.createDeck());
    
    const players: GameState['players'] = {};
    for (const id of userIds) {
      players[id] = {
        hand: [],
        vazaPoints: 0,
        team: teamMap[id],
        position: positions[id]
      };
    }

    return {
      deck,
      players,
      currentTurn: userIds[0],
      cutterId: null,
      cuttingCards: [],
      lastDealtUserId: null,
      lastVazaWinner: null,
      trumpCard: null,
      trumpSuit: null,
      isCopas: false,
      vaza: [],
      score: { team1: 0, team2: 0 },
      gameScore: { team1: 0, team2: 0 },
      status: 'IN_GAME' as RoomStatus,
      lastWinner: null,
      visibleCorte: null,
      corteSwapDone: false,
      heleyOccurred: false,
      roundCount: 0
    };
  }

  static resolveVaza(vaza: { userId: string, card: Card }[], trumpSuit: Suit): string {
    if (vaza.length === 0) return '';

    let winnerIdx = 0;
    const leadSuit = vaza[0].card.suit;

    for (let i = 1; i < vaza.length; i++) {
      const currentWinnerCard = vaza[winnerIdx].card;
      const nextCard = vaza[i].card;

      if (nextCard.suit === trumpSuit) {
        if (currentWinnerCard.suit !== trumpSuit) {
          winnerIdx = i;
        } else if (nextCard.rank > currentWinnerCard.rank) {
          winnerIdx = i;
        }
      } else if (currentWinnerCard.suit !== trumpSuit) {
        if (nextCard.suit === leadSuit && nextCard.rank > currentWinnerCard.rank) {
          winnerIdx = i;
        }
      }
    }

    return vaza[winnerIdx].userId;
  }

  static calculateHandPoints(vazas: Card[]): number {
    return vazas.reduce((acc, card) => acc + card.points, 0);
  }

  static getSuitInversion(suit: Suit): Suit {
    const map: Record<Suit, Suit> = {
      'Copas': 'Ouros',
      'Ouros': 'Copas',
      'Espadas': 'Paus',
      'Paus': 'Espadas'
    };
    return map[suit];
  }
}
