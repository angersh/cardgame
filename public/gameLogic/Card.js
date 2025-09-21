export const COLORS = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "Pink"];
export const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

export class Card {
  constructor(color, rank) {
    this.color = color;
    this.rank = rank;
  }
}

export class Flag {
  constructor(type, maxCards = 3, minCards = 1) {
    this.type = type;            // e.g., "Outpost", "Encampment", etc.
    this.maxCards = maxCards;    // how many cards allowed
    this.minCards = minCards;    // minimum cards required to contest
    this.cards = {};             // { playerId: [Card, Card, ...] }
    this.claimedBy = null;       // playerId if claimed
    this.bestFormation = "";     // string description of formation

    // Special triggers
    this.chargeTriggered = false;      // For Encampment
    this.chargeOwner = null;

    this.handBoostTriggered = false;   // For Garrison

    this.strongholdTriggered = false;  // For Stronghold

    this.citadelTriggered = false;     // For Citadel
  }
}


