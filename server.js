import express from "express";
import http from "http";
import { Server } from "socket.io";
import { Card, Flag, COLORS, RANKS } from "./public/gameLogic/Card.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let gameState = {
  deck: createDeck(),
  board: createBoard(),
  hands: {},
  maxHandSize: {},
  cannon: {},
  attackMode: null,
  firedCannons: {},
  chargeActive: null,
  citadelActive: null,
  citadelUsed: false,
  scores: {},
  finalWinner: null,   // <-- added
  gameOver: false      // <-- added
};


const players = [];
const AI_ID = "AI";
const CANNON_CARD_LIMIT = 2;

// --- SCORING ---
// --- FORMATION & SCORING ---
const FORMATION_RANKS = {
  'High Card': 1,
  'Pair': 2,
  'Two Pair': 3,
  'Three of a Kind': 4,
  'Straight': 5,
  'Flush': 6,
  'Full House': 7,
  'Four of a Kind': 8,
  'Straight Flush': 9
};

function compareHighCards(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function evaluateFormation(cards, requiredLength = 3) {
  if (!cards || cards.length === 0) return { name: "None", rank: 0, highCards: [] };

  const ranks = cards.map(c => c.rank).sort((a, b) => a - b);
  const colors = cards.map(c => c.color);
  const countRanks = {};
  ranks.forEach(r => countRanks[r] = (countRanks[r] || 0) + 1);
  const rankCounts = Object.entries(countRanks).sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  const isFlush = new Set(colors).size === 1 && cards.length >= 3;
  const isStraight = requiredLength >= 3 && ranks.length === requiredLength &&
                     ranks.every((r, i, a) => i === 0 || r === a[i - 1] + 1);

  let name, rankValue, highCards;

  if (isStraight && isFlush) {
    name = "Straight Flush";
    rankValue = FORMATION_RANKS[name];
    highCards = [Math.max(...ranks)];
  } else if (rankCounts[0][1] === 4) {
    name = "Four of a Kind";
    rankValue = FORMATION_RANKS[name];
    highCards = [parseInt(rankCounts[0][0]), parseInt(rankCounts[1]?.[0] || 0)];
  } else if (rankCounts[0][1] === 3 && rankCounts[1]?.[1] === 2) {
    name = "Full House";
    rankValue = FORMATION_RANKS[name];
    highCards = [parseInt(rankCounts[0][0]), parseInt(rankCounts[1][0])];
  } else if (isFlush) {
    name = "Flush";
    rankValue = FORMATION_RANKS[name];
    highCards = ranks.slice().sort((a, b) => b - a);
  } else if (isStraight) {
    name = "Straight";
    rankValue = FORMATION_RANKS[name];
    highCards = [Math.max(...ranks)];
  } else if (rankCounts[0][1] === 3) {
    name = "Three of a Kind";
    rankValue = FORMATION_RANKS[name];
    highCards = [
      parseInt(rankCounts[0][0]),
      parseInt(rankCounts[1]?.[0] || 0),
      parseInt(rankCounts[2]?.[0] || 0)
    ];
  } else if (rankCounts[0][1] === 2 && rankCounts[1]?.[1] === 2) {
    name = "Two Pair";
    rankValue = FORMATION_RANKS[name];
    highCards = [
      parseInt(rankCounts[0][0]),
      parseInt(rankCounts[1][0]),
      parseInt(rankCounts[2]?.[0] || 0)
    ];
  } else if (rankCounts[0][1] === 2) {
    name = "Pair";
    rankValue = FORMATION_RANKS[name];
    highCards = [
      parseInt(rankCounts[0][0]),
      ...ranks.filter(r => r != rankCounts[0][0]).sort((a, b) => b - a)
    ];
  } else {
    name = "High Card";
    rankValue = FORMATION_RANKS[name];
    highCards = ranks.slice().sort((a, b) => b - a);
  }

  return { name, rank: rankValue, highCards };
}

function determineFlagWinner(flag) {
  let winner = null, bestRank = 0, bestHighCards = [];

  for (let playerId in flag.cards) {
    const evalResult = evaluateFormation(flag.cards[playerId], flag.maxCards);
    if (evalResult.rank > bestRank ||
        (evalResult.rank === bestRank && compareHighCards(evalResult.highCards, bestHighCards) > 0)) {
      bestRank = evalResult.rank;
      bestHighCards = evalResult.highCards;
      winner = playerId;
    }
  }

  flag.claimedBy = winner || null;
  flag.bestFormation = winner
    ? evaluateFormation(flag.cards[winner], flag.maxCards).name
    : "";

  return winner;
}

// server.js (replace existing functions)

function calculateGameScore() {
  const scores = {};
  const playerIds = Object.keys(gameState.hands || {});
  // ensure we count AI too (defensive)
  if (!playerIds.includes(AI_ID)) playerIds.push(AI_ID);

  // init scores
  playerIds.forEach(pid => scores[pid] = 0);

  let allFlagsComplete = true;
  let anyCardPlayed = false;

  // make sure flags/cards are normalized and compute winners
  gameState.board.forEach(flag => {
    flag.cards = flag.cards || {}; // defensive
    determineFlagWinner(flag);

    if (flag.claimedBy) scores[flag.claimedBy] += 1;

    // For each expected player id, check the flag slot
    for (const pid of playerIds) {
      const count = (flag.cards[pid] || []).length;
      if (count > 0) anyCardPlayed = true;
      if (count < flag.maxCards) {
        allFlagsComplete = false;
      }
    }
  });

  // store scores
  gameState.scores = scores;

  // Only declare game over if at least one card has been played AND all flags are full
  if (anyCardPlayed && allFlagsComplete && !gameState.finalWinner) {
    const maxScore = Math.max(...Object.values(scores));
    const winners = Object.keys(scores).filter(pid => scores[pid] === maxScore);
    gameState.finalWinner = winners.length === 1 ? winners[0] : "Tie";
    gameState.gameOver = true;
    // emit only gameOver (client will show overlay). Do NOT emit updateGame after this.
    io.emit("gameOver", { finalWinner: gameState.finalWinner, scores });
  }

  return scores;
}

function updateScores() {
  // calculateGameScore updates gameState.scores and may set gameOver/finalWinner
  const scores = calculateGameScore();
  gameState.scores = scores;

  // Only send updateGame while the game is ongoing. Once gameOver is true, clients
  // will receive the gameOver event and should stop redrawing the board.
  if (!gameState.gameOver) {
    io.emit("updateGame", gameState);
  }
}



// --- GAME SETUP ---
function createDeck() {
  const deck = [];
  for (let color of COLORS) {
    for (let rank of RANKS) {
      deck.push(new Card("Formation", color, rank));
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function createBoard() {
  return [
    new Flag("Outpost", 2, 3),
    new Flag("Garrison", 3, 1),
    new Flag("Encampment", 3, 3),
    new Flag("Encampment", 3, 3),
    new Flag("Stronghold", 5, 1),
    new Flag("Encampment", 3, 3),
    new Flag("Encampment", 3, 3),
    new Flag("Citadel", 4, 1),
    new Flag("Outpost", 2, 3),
  ];
}

function dealInitialHands(playerIds) {
  playerIds.forEach(id => {
    gameState.hands[id] = [];
    gameState.maxHandSize[id] = 3;
    for (let i = 0; i < 3; i++) drawCard(id);
  });
}

function drawCard(playerId) {
  if (gameState.deck.length === 0) return;
  if (gameState.hands[playerId].length >= gameState.maxHandSize[playerId]) return;
  const card = gameState.deck.pop();
  gameState.hands[playerId].push(card);
}

// --- PLACE CARD ---
function placeCard(playerId, card, flagId) {
  // --- Citadel freeze ---
  if (gameState.citadelActive && gameState.citadelActive !== playerId) return;

  // --- Encampment freeze ---
  if (gameState.chargeActive !== null) {
    const activeFlag = gameState.board[gameState.chargeActive];
    if (activeFlag) {
      // Only the opponent may play, and only on the frozen Encampment
      if (playerId !== activeFlag.chargeOwner && flagId !== gameState.chargeActive) return;
      // Charge owner cannot place cards while freeze is active
      if (playerId === activeFlag.chargeOwner) return;
    } else {
      gameState.chargeActive = null;
    }
  }

  const hand = gameState.hands[playerId];
  if (!hand) return;

  const cardIndex = hand.findIndex(c => c.color === card.color && c.rank === card.rank);
  if (cardIndex === -1) return;

  // --- Cannon placement ---
  if (flagId === "cannon") {
    gameState.cannon[playerId] = gameState.cannon[playerId] || [];
    if (gameState.cannon[playerId].length >= 2) return;
    if (gameState.firedCannons[playerId]) return;

    gameState.cannon[playerId].push(hand.splice(cardIndex, 1)[0]);

    // Check for cannon attack readiness
    if (gameState.cannon[playerId].length === 2) {
      const [c1, c2] = gameState.cannon[playerId];
      if (c1.color === c2.color) {
        gameState.attackMode = playerId;
        gameState.firedCannons[playerId] = true;
        console.log(`Cannon ready: ${playerId} may attack!`);
        if (playerId === AI_ID) setTimeout(() => aiPerformAttack(), 500);
      }
    }

  // --- Flag placement ---
  } else {
    const flag = gameState.board[flagId];
    if (!flag) return;

    flag.cards[playerId] = flag.cards[playerId] || [];
    if (flag.cards[playerId].length >= flag.maxCards) return;

    flag.cards[playerId].push(hand.splice(cardIndex, 1)[0]);

    // --- Encampment trigger ---
    if (flag.type === "Encampment" && !flag.chargeTriggered && flag.cards[playerId].length === flag.maxCards) {
      flag.chargeTriggered = true;
      flag.chargeOwner = playerId;
      gameState.chargeActive = flagId;
      console.log(`Charge triggered on flag ${flagId} by ${playerId}`);
    }

    // --- Garrison hand size boost ---
    if (flag.type === "Garrison" && !flag.handBoostTriggered && flag.cards[playerId].length === flag.maxCards) {
      flag.handBoostTriggered = true;
      gameState.maxHandSize[playerId] += 1;
      console.log(`Garrison effect: ${playerId} hand size increased to ${gameState.maxHandSize[playerId]}`);
      while (gameState.hands[playerId].length < gameState.maxHandSize[playerId]) {
        drawCard(playerId);
      }
    }

    // --- Stronghold attack effect ---
    if (flag.type === "Stronghold" && !flag.strongholdTriggered && flag.cards[playerId].length === flag.maxCards) {
      flag.strongholdTriggered = true;
      gameState.attackMode = playerId;
      console.log(`Stronghold effect: ${playerId} may attack immediately`);
      if (playerId === AI_ID) setTimeout(() => aiPerformAttack(), 500);
    }

    // --- Citadel trigger ---
    if (flag.type === "Citadel" && !gameState.citadelUsed && flag.cards[playerId].length === flag.maxCards) {
      flag.citadelTriggered = true;
      gameState.citadelUsed = true;        // only once per game
      gameState.citadelActive = playerId;  // freeze until move is made
      console.log(`Citadel effect: ${playerId} may move one card`);
      if (playerId === AI_ID) setTimeout(() => aiMoveCardFromCitadel(flagId), 500);
    }
  }

  // Draw card after placement
  drawCard(playerId);

  // Update scores
  updateScores();

  // --- Resolve Encampment release ---
  if (gameState.chargeActive !== null) {
    const activeFlag = gameState.board[gameState.chargeActive];
    if (activeFlag) {
      const otherPlayer = Object.keys(gameState.hands).find(id => id !== activeFlag.chargeOwner);
      if (otherPlayer && (activeFlag.cards[otherPlayer] || []).length === activeFlag.maxCards) {
        console.log(`Charge on flag ${gameState.chargeActive} resolved.`);
        gameState.chargeActive = null;
      }
    }
  }
}


// --- MOVE CARD ---
function moveCard(playerId, fromFlagId, toFlagId, card) {
  const fromFlag = gameState.board[fromFlagId];
  const toFlag = gameState.board[toFlagId];
  if (!fromFlag || !toFlag) return;

  // Only allowed if this player has the Citadel privilege
  if (gameState.citadelActive !== playerId) return;
  if (fromFlagId === toFlagId) return;

  // Actually move the card
  fromFlag.cards[playerId] = (fromFlag.cards[playerId] || []).filter(
    c => !(c.color === card.color && c.rank === card.rank)
  );
  toFlag.cards[playerId] = toFlag.cards[playerId] || [];
  if (toFlag.cards[playerId].length < toFlag.maxCards) {
    toFlag.cards[playerId].push(card);
  }

  // Consume the Citadel effect after ONE move
  gameState.citadelActive = null;

  updateScores();
}


// --- AI HELPERS ---
function aiMoveCardFromCitadel(citadelFlagId) {
  const citadelFlag = gameState.board[citadelFlagId];
  if (!citadelFlag) return;

  const fromFlag = gameState.board.find(f => f !== citadelFlag && f.cards[AI_ID]?.length > 0);
  if (!fromFlag) return;

  const card = fromFlag.cards[AI_ID][0];
  moveCard(AI_ID, gameState.board.indexOf(fromFlag), citadelFlagId, card);

  // Mark Citadel move done for AI
  citadelFlag.citadelMoveDone = true;
  gameState.citadelActive = null;

  // Small delay to let the move process before next AI action
  setTimeout(aiAct, 300);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function aiAct() {
  if (!gameState || gameState.attackMode) return;
  if (gameState.citadelActive && gameState.citadelActive !== AI_ID) return;

  const hand = gameState.hands[AI_ID];
  if (!hand || hand.length === 0) return;
  const humanId = players.find(id => id !== AI_ID);

  // --- Citadel move ---
  const citadelIdx = gameState.board.findIndex(f => f.type === "Citadel");
  if (citadelIdx !== -1) {
    const citadel = gameState.board[citadelIdx];
    if (citadel.claimedBy === AI_ID && !citadel.citadelMoveDone) {
      aiMoveCardFromCitadel(citadelIdx);
      return;
    }
  }

  // --- Cannon strategy ---
  const aiCannonCards = gameState.cannon[AI_ID] || [];
  const cannonReady =
    aiCannonCards.length === 2 &&
    aiCannonCards[0].color === aiCannonCards[1].color &&
    !gameState.firedCannons[AI_ID];

  if (!cannonReady) {
    const card = hand.find(
      c =>
        aiCannonCards.length < 2 &&
        (aiCannonCards.length === 0 || aiCannonCards[0].color === c.color)
    );
    if (card && Math.random() < 0.4) {
      placeCard(AI_ID, card, "cannon");
      return;
    }
  }

  // --- Shuffle flags to remove left-to-right bias ---
  const flagIndices = gameState.board.map((_, idx) => idx);
  shuffleArray(flagIndices);

  // --- Evaluate all moves globally ---
  let allMoves = [];

  for (let card of hand) {
    for (let idx of flagIndices) {
      const flag = gameState.board[idx];

      if (gameState.chargeActive !== null && idx !== gameState.chargeActive) continue;

      const aiCards = flag.cards[AI_ID] || [];
      const humanCards = flag.cards[humanId] || [];
      if (aiCards.length >= flag.maxCards) continue;

      // --- Simulate AI placement ---
      const simulatedAI = [...aiCards, card];
      const aiEval = evaluateFormation(simulatedAI, flag.maxCards);

      // --- Simple human look-ahead ---
      let humanNextEval = { rank: 0, highCards: [] };
      if (humanCards.length < flag.maxCards) {
        for (let r = 1; r <= 13; r++) {
          const sim = [...humanCards, new Card("Formation", COLORS[0], r)];
          const evalResult = evaluateFormation(sim, flag.maxCards);
          if (
            evalResult.rank > humanNextEval.rank ||
            (evalResult.rank === humanNextEval.rank &&
              compareHighCards(evalResult.highCards, humanNextEval.highCards) > 0)
          ) {
            humanNextEval = evalResult;
          }
        }
      }

      // --- Compute move score ---
      const score = aiEval.rank - humanNextEval.rank + aiEval.highCards[0] / 100;
      allMoves.push({ card, flagIdx: idx, score });
    }
  }

  if (allMoves.length > 0) {
    allMoves.sort((a, b) => b.score - a.score);
    const bestMove = allMoves[0];
    placeCard(AI_ID, bestMove.card, bestMove.flagIdx);
  } else {
    // --- Fallback random placement ---
    const card = hand[Math.floor(Math.random() * hand.length)];
    const availableFlags = gameState.board
      .map((flag, idx) => ({ flag, idx }))
      .filter(({ flag, idx }) => {
        if (gameState.chargeActive !== null && idx !== gameState.chargeActive) return false;
        const aiCards = flag.cards[AI_ID] || [];
        return aiCards.length < flag.maxCards;
      });
    if (availableFlags.length > 0) {
      const chosen = availableFlags[Math.floor(Math.random() * availableFlags.length)];
      placeCard(AI_ID, card, chosen.idx);
    }
  }
}



let aiInterval = null;


function initAI() {
  if (players.length === 0) return;

  // Make sure the AI hand exists
  if (!gameState.hands[AI_ID]) {
    gameState.hands[AI_ID] = [];
    gameState.maxHandSize[AI_ID] = 3;
  }

  // ✅ Only create the interval once
  if (!aiInterval) {
    aiInterval = setInterval(aiAct, 3000);
  }
}


function aiPerformAttack() {
  if (gameState.attackMode !== AI_ID) return;

  const humanId = players.find(id => id !== AI_ID);
  if (!humanId) return;

  // --- Prioritize human's strongest nearly-complete formation ---
  let target = null;
  let highestRank = 0;
  gameState.board.forEach((flag, idx) => {
    const humanCards = flag.cards[humanId] || [];
    if (humanCards.length === 0) return;

    const evalResult = evaluateFormation(humanCards, flag.maxCards);
    if (evalResult.rank > highestRank) {
      highestRank = evalResult.rank;
      // destroy the card contributing most to human's formation
      target = { flagId: idx, card: humanCards[0] };
    }
  });

  if (target) {
    destroyCard(AI_ID, target.flagId, target.card);
    setTimeout(aiAct, 300); // continue AI turn
  } else {
    gameState.attackMode = null;
    updateScores();
  }
}



// --- DESTROY CARD ---
function destroyCard(attackerId, flagId, targetCard) {
  if (gameState.attackMode !== attackerId || flagId === "cannon") return;
  const flag = gameState.board[flagId];
  if (!flag) return;

  for (let playerId in flag.cards) {
    flag.cards[playerId] = flag.cards[playerId].filter(c => !(c.color === targetCard.color && c.rank === targetCard.rank));
  }

  gameState.attackMode = null;
  updateScores();
}

// --- SOCKETS ---
io.on("connection", socket => {
  // Add player
  if (!players.includes(socket.id)) players.push(socket.id);

  // --- Initialize game for first player or reset AI ---
  if (!gameState.board || gameState.board.length === 0) {
    gameState.deck = createDeck();
    gameState.board = createBoard();
    gameState.cannon = {};
    gameState.firedCannons = {};
    gameState.attackMode = null;

    // Human hands
    dealInitialHands(players.filter(id => id !== AI_ID));

    // AI hand reset
    gameState.hands[AI_ID] = [];
    gameState.maxHandSize[AI_ID] = 3;
    for (let i = 0; i < 3; i++) drawCard(AI_ID);

    // Start AI logic
    initAI();

    // Update clients
    updateScores();
    io.emit("startGame", gameState);
  } else {
    // Additional player joins mid-game or player refresh
    dealInitialHands([socket.id]);

    // Reset AI hand if missing
    if (!gameState.hands[AI_ID] || gameState.hands[AI_ID].length === 0) {
      gameState.hands[AI_ID] = [];
      gameState.maxHandSize[AI_ID] = 3;
      for (let i = 0; i < 3; i++) drawCard(AI_ID);
      initAI();
    }

    socket.emit("startGame", gameState);
  }

  // --- Socket Events ---
  socket.on("placeCard", ({ card, flagId }) => placeCard(socket.id, card, flagId));
  socket.on("destroyCard", ({ flagId, card }) => destroyCard(socket.id, flagId, card));
  socket.on("moveCard", ({ fromFlagId, toFlagId, card }) => moveCard(socket.id, fromFlagId, toFlagId, card));

  // --- Restart Game ---
// --- Restart Game ---
socket.on("restartGame", () => {
  gameState = {
    deck: createDeck(),
    board: createBoard(),
    hands: {},
    maxHandSize: {},
    cannon: {},
    attackMode: null,
    firedCannons: {},
    chargeActive: null,
    citadelActive: null,
    citadelUsed: false,
    scores: {},
    finalWinner: null,   // ✅ reset winner
    gameOver: false      // ✅ reset game over state
  };

  // Human hands
  dealInitialHands(players.filter(id => id !== AI_ID));

  // AI hand reset
  gameState.hands[AI_ID] = [];
  gameState.maxHandSize[AI_ID] = 3;
  for (let i = 0; i < 3; i++) drawCard(AI_ID);

  // Reset AI interval
  if (aiInterval) clearInterval(aiInterval);
  aiInterval = null;
  initAI();

  updateScores();
  io.emit("startGame", gameState);
});

// --- Game Over Handler ---
socket.on("gameOver", ({ finalWinner, scores }) => {
  io.emit("gameOver", { finalWinner, scores });
});

});


// --- START SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
