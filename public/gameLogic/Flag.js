export class Flag {
  constructor(type, maxCards, flagsWorth) {
    this.type = type;
    this.maxCards = maxCards;
    this.flagsWorth = flagsWorth;
    this.cards = {};   // change from [] to {}
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
