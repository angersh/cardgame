// public/gameLogic/Card.js
export const COLORS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink'];
export const RANKS = [1,2,3,4,5,6,7,8,9,10];

export class Card {
  constructor(type, color=null, rank=null) {
    this.type = type; // 'Formation' or 'Cannon'
    this.color = color; 
    this.rank = rank;
  }
}

export class Flag {
  constructor(type, maxCards, flagsWorth) {
    this.type = type;
    this.maxCards = maxCards;
    this.flagsWorth = flagsWorth;
    this.cards = {}; // per-player mapping now
    this.claimedBy = null;
  }

  addCard(playerId, card) {
    if (!this.cards[playerId]) this.cards[playerId] = [];
    if (this.cards[playerId].length >= this.maxCards) return false;
    this.cards[playerId].push(card);
    return true;
  }

  isFull(playerId) {
    return this.cards[playerId] && this.cards[playerId].length >= this.maxCards;
  }
}
