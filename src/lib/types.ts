/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Suit = 'Ouros' | 'Copas' | 'Espadas' | 'Paus';
export type CardValue = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | 'Q' | 'J' | 'K';

export interface Card {
  id: string;
  suit: Suit;
  value: CardValue;
  points: number;
  rank: number;
}

export type PlayerRole = 'ADMIN' | 'USER';

export interface User {
  id: string;
  username: string;
  nickname: string;
  role: PlayerRole;
  isActive: boolean;
  createdAt: number;
}

export interface RoomConfig {
  scoreGoal: number;
  timePerMove?: number; // em segundos
}

export type RoomStatus = 'WAITING' | 'SHUFFLING' | 'CUTTING' | 'DEALING' | 'IN_GAME' | 'FINISHED';

export interface RoomSlot {
  userId: string | null;
  nickname: string | null;
  team: 1 | 2;
  position: 0 | 1 | 2 | 3; // Ordem na mesa
}

export interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  timestamp: number;
  channel: 'players' | 'spectators';
}

export interface GameState {
  deck: Card[];
  players: {
    [userId: string]: {
      hand: Card[];
      vazaPoints: number;
      team: 1 | 2;
      position: number;
    }
  };
  currentTurn: string; // userId
  cutterId: string | null;
  cuttingCards: Card[];
  lastDealtUserId: string | null;
  lastVazaWinner: string | null;
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  isCopas: boolean;
  vaza: {
    userId: string;
    card: Card;
  }[];
  score: {
    team1: number;
    team2: number;
  };
  gameScore: {
    team1: number;
    team2: number;
  };
  status: RoomStatus;
  lastWinner: string | null;
  visibleCorte: Card | null;
  corteSwapDone: boolean;
  heleyOccurred: boolean;
  roundCount: number;
}
