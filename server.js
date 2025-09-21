// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { Card, Flag, COLORS, RANKS } from "./public/gameLogic/Card.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const rooms = {};
const queue = [];

// --- Shuffle ---
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// --- Score Calculation ---
function getFormationScore(cards, flag) {
  if (!cards || cards.length === 0) return 0;
  let sum = cards.reduce((total, c) => total + parseInt(c.rank), 0);
  if (flag?.stronghold && flag.stronghold === cards[0]?.owner) sum *= 2;
  if (flag?.garrisonBonus) sum += flag.garrisonBonus;
  if (flag?.encampmentPenalty) sum -= flag.encampmentPenalty || 0;
  return sum;
}

// --- Evaluate Flag Winner ---
function evaluateFlag(flag) {
  // Only evaluate if flag is fully completed
  const allFull = Object.values(flag.cards).every(cards => cards.length >= flag.maxCards);
  if (!allFull) return null;

  const scores = {};
  for (const pid of Object.keys(flag.cards)) {
    const cards = flag.cards[pid];
    let sum = cards.reduce((total, c) => total + parseInt(c.rank), 0);

    // Stronghold doubles points for owner
    if (flag.stronghold === pid) sum *= 2;

    // Garrison bonus
    sum += flag.garrisonBonus || 0;

    // Encampment penalty: subtract number of opponent cards
    const opponentCards = Object.keys(flag.cards)
      .filter(p => p !== pid)
      .reduce((acc, p) => acc + (flag.cards[p]?.length || 0), 0);
    sum -= opponentCards;

    scores[pid] = sum;
  }

  const [p1, p2] = Object.keys(scores);
  if (scores[p1] > scores[p2]) return p1;
  if (scores[p2] > scores[p1]) return p2;
  return null; // tie
}

// --- Draw Card ---
function drawCard(playerId, gameState) {
  if (gameState.deck.length > 0 && gameState.hands[playerId].length < gameState.maxHandSize[playerId]) {
    gameState.hands[playerId].push(gameState.deck.pop());
  }
}

// --- Update Scores ---
function updateScores(gameState) {
  gameState.scores = {};
  Object.keys(gameState.hands).forEach(pid => gameState.scores[pid] = 0);

  gameState.board.forEach(flag => {
    updateFlagEffects(flag, gameState);

    // Only consider fully completed flags
    const isFlagComplete = Object.values(flag.cards).every(cards => cards.length >= flag.maxCards);
    if (!isFlagComplete) return;

    // Evaluate the winner/owner of this flag
    const winner = evaluateFlag(flag);
    if (winner) gameState.scores[winner]++;
  });
}


// --- Update Flag Effects ---
function updateFlagEffects(flag, gameState) {
  const players = Object.keys(flag.cards);

  // Reset temporary effects
  flag.garrisonBonus = 0;
  flag.encampmentPenalty = 0;
  flag.stronghold = null;
  flag.outpostOwner = null;

  players.forEach(pid => {
    const cards = flag.cards[pid];

    // Outpost ownership: first player to place at least 1 card
    if (cards.length >= 1 && !flag.outpostOwner) flag.outpostOwner = pid;

    // Stronghold ownership: first player to complete the flag (maxCards)
    if (cards.length >= flag.maxCards && !flag.stronghold) flag.stronghold = pid;

    // Citadel trigger handled elsewhere in placeCard

    // Garrison bonus: +2 for each color pair
    const colorCounts = {};
    cards.forEach(c => colorCounts[c.color] = (colorCounts[c.color] || 0) + 1);
    Object.values(colorCounts).forEach(count => {
      if (count >= 2) flag.garrisonBonus += 2;
    });

    // Encampment penalty: number of cards opponent placed
    players.forEach(opponent => {
      if (opponent !== pid) flag.encampmentPenalty += (flag.cards[opponent]?.length || 0);
    });
  });
}

// --- Place Card ---
// --- Place Card ---
function placeCard(playerId, card, flagId, gameState) {
  const hand = gameState.hands[playerId];
  const idx = hand.findIndex(c => c.rank === card.rank && c.color === card.color && c.owner === card.owner);
  if (idx < 0) return;

  // --- Cannon ---
  if (flagId === "cannon") {
    const cannonArr = gameState.cannon[playerId] || [];
    if (cannonArr.length >= 2) return;

    const placed = hand.splice(idx, 1)[0];
    placed.owner = playerId;
    cannonArr.push(placed);
    gameState.cannon[playerId] = cannonArr;

    const colorCounts = {};
    cannonArr.forEach(c => colorCounts[c.color] = (colorCounts[c.color] || 0) + 1);

    if (Object.values(colorCounts).some(count => count >= 2) && !gameState.attackMode) {
      gameState.attackMode = playerId;
      gameState.freezeForAttack = true;
    }
    return;
  }

  // --- Encampment Freeze ---
  if (gameState.freezeForAttack) {
    if (typeof gameState.freezeForAttack === "object" && gameState.freezeForAttack.type === "encampment") {
      const { flagId: encampId, owner } = gameState.freezeForAttack;
      if (playerId === owner || flagId !== encampId) return;
    } else return;
  }

  const flag = gameState.board[flagId];
  if (!flag) return;
  if (!flag.cards[playerId]) flag.cards[playerId] = [];
  if (flag.cards[playerId].length >= flag.maxCards) return;

  const placed = hand.splice(idx, 1)[0];
  placed.owner = playerId;
  flag.cards[playerId].push(placed);

  // --- Citadel logic: triggers immediately on completion ---
  if (flag.type === "Citadel" && !flag.citadelTriggered && flag.cards[playerId].length === flag.maxCards) {
    flag.citadelTriggered = true;
    gameState.citadelActive = playerId; // pause the game

    console.log("Citadel triggered! Player must select one card from the flag to move to their hand.");
    // Stop here: the game should wait until player picks a card
    return;
  }

  // --- Other Special Flag Abilities ---
  if (flag.type === "Encampment" && !flag.chargeTriggered && flag.cards[playerId].length === flag.maxCards) {
    flag.chargeTriggered = true;
    flag.chargeOwner = playerId;
    gameState.freezeForAttack = { type: "encampment", flagId, owner: playerId };
  }

  if (typeof gameState.freezeForAttack === "object" &&
      gameState.freezeForAttack.type === "encampment" &&
      flagId === gameState.freezeForAttack.flagId &&
      flag.cards[playerId].length === flag.maxCards &&
      playerId !== gameState.freezeForAttack.owner) {
    gameState.freezeForAttack = false;
  }

  if (flag.type === "Garrison" && !flag.handBoostTriggered && flag.cards[playerId].length === flag.maxCards) {
    flag.handBoostTriggered = true;
    gameState.maxHandSize[playerId] += 1;
  }

  if (flag.type === "Stronghold" && !flag.strongholdTriggered && flag.cards[playerId].length === flag.maxCards) {
    flag.strongholdTriggered = true;
    if (!gameState.attackMode) {
      gameState.attackMode = playerId;
      gameState.freezeForAttack = true;
    }
  }

  drawCard(playerId, gameState);
  updateScores(gameState);
}



// --- Destroy Card ---
function destroyCard(card, gameState) {
  if (!gameState) return false;
  let destroyed = false;

  gameState.board.forEach(flag => {
    Object.keys(flag.cards).forEach(pid => {
      const idx = flag.cards[pid].findIndex(
        c => c.rank === card.rank && c.color === card.color && c.owner === card.owner
      );
      if (idx >= 0) {
        flag.cards[pid].splice(idx, 1);
        destroyed = true;
      }
    });
  });

  Object.keys(gameState.cannon).forEach(pid => {
    const idx = gameState.cannon[pid].findIndex(
      c => c.rank === card.rank && c.color === card.color && c.owner === card.owner
    );
    if (idx >= 0) {
      gameState.cannon[pid].splice(idx, 1);
      destroyed = true;
    }
  });

  if (destroyed) {
    gameState.board.forEach(f => updateFlagEffects(f, gameState));
    updateScores(gameState);
    gameState.attackMode = null;
    gameState.freezeForAttack = false;
  }
  return destroyed;
}

// --- Process Card Action ---
function processCardAction(playerId, card, flagInfo, gameState, actionType) {
    // Citadel freeze check
    if (gameState.citadelActive && gameState.citadelActive !== playerId && actionType === "place") {
        return; // Other players cannot act
    }

    switch (actionType) {
        case "place": placeCard(playerId, card, flagInfo, gameState); break;
        case "destroy": destroyCard(card, gameState); break;
        case "move": {
            const fromFlag = gameState.board[flagInfo.from];
            const toFlag = gameState.board[flagInfo.to];
            if (!fromFlag || !toFlag) return;
            const idx = fromFlag.cards[playerId].findIndex(
                c => c.rank === card.rank && c.color === card.color && c.owner === card.owner
            );
            if (idx >= 0) toFlag.cards[playerId].push(fromFlag.cards[playerId].splice(idx, 1)[0]);
            break;
        }
    }

    gameState.board.forEach(f => updateFlagEffects(f, gameState));
    updateScores(gameState);

    Object.keys(gameState.hands).forEach(pid => {
        while (gameState.hands[pid].length < gameState.maxHandSize[pid] && gameState.deck.length > 0) {
            drawCard(pid, gameState);
        }
    });
}


// --- Create New Game ---
function createNewGame(playerIds) {
  let deck = [];
  COLORS.forEach(color => RANKS.forEach(rank => deck.push(new Card(color, rank))));
  deck = shuffle(deck);

  const hands = {};
  playerIds.forEach(id => hands[id] = []);
  for (let i = 0; i < 5; i++) playerIds.forEach(id => hands[id].push(deck.pop()));

  const board = [
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
  playerIds.forEach(id => board.forEach(flag => flag.cards[id] = []));

  const cannon = {};
  const firedCannons = {};
  const scores = {};
  playerIds.forEach(id => { cannon[id] = []; firedCannons[id] = false; scores[id] = 0; });

  return {
    deck, hands, board, cannon, firedCannons, scores,
    citadelActive: null, citadelUsed: false,
    attackMode: null, chargeActive: null,
    maxHandSize: Object.fromEntries(playerIds.map(id => [id, 5])),
    freezeForAttack: false, gameOver: false
  };
}

// --- Socket.io ---
io.on("connection", socket => {
  console.log("Player connected:", socket.id);

  socket.on("joinQueue", () => {
    queue.push(socket.id);
    if (queue.length >= 2) {
      const [p1, p2] = queue.splice(0, 2);
      const roomId = `${p1}-${p2}`;
      const gameState = createNewGame([p1, p2]);
      rooms[roomId] = { players: [p1, p2], gameState };
      [p1, p2].forEach(pid => io.sockets.sockets.get(pid)?.join(roomId));
      io.to(roomId).emit("startGame", { state: gameState, room: roomId });
    }
  });

  const updateGameState = roomId => {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit("updateGame", room.gameState);
    io.to(roomId).emit("updateHands", room.gameState.hands);
  };

  const checkAndEmitGameOver = roomId => {
    const room = rooms[roomId];
    if (!room) return;
    const result = checkGameOver(room.gameState);
    if (result.gameOver) io.to(roomId).emit("gameOver", result);
  };

  socket.on("placeCard", ({ roomId, card, flagId }) => {
    const room = rooms[roomId]; if (!room) return;
    processCardAction(socket.id, card, flagId, room.gameState, "place");
    updateGameState(roomId);
    checkAndEmitGameOver(roomId);
  });

  socket.on("destroyCard", ({ roomId, flagId, card }) => {
    const room = rooms[roomId]; if (!room) return;
    processCardAction(socket.id, card, { from: flagId }, room.gameState, "destroy");
    io.to(roomId).emit("cardDestroyed", card);
    updateGameState(roomId);
    checkAndEmitGameOver(roomId);
  });

  socket.on("moveCard", ({ roomId, fromFlagId, toFlagId, card }) => {
    const room = rooms[roomId]; if (!room) return;
    processCardAction(socket.id, card, { from: fromFlagId, to: toFlagId }, room.gameState, "move");
    room.gameState.citadelActive = null;
    updateGameState(roomId);
    checkAndEmitGameOver(roomId);
  });

  socket.on("pickCardCitadel", ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room || room.gameState.citadelActive !== socket.id) return;

    pickCardDuringCitadel(socket.id, card, room.gameState);
    updateGameState(roomId);
    checkAndEmitGameOver(roomId);
  });

  socket.on("restartMatch", ({ roomId }) => {
    const room = rooms[roomId]; if (!room) return;
    const gameState = createNewGame(room.players);
    rooms[roomId].gameState = gameState;
    io.to(roomId).emit("startGame", { state: gameState, room: roomId });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    const idx = queue.indexOf(socket.id); if (idx >= 0) queue.splice(idx, 1);
    for (let roomId in rooms) {
      if (rooms[roomId].players.includes(socket.id)) {
        io.to(roomId).emit("opponentDisconnected", { playerId: socket.id });
        delete rooms[roomId];
      }
    }
  });
});


function pickCardDuringCitadel(playerId, cardInfo, gameState) {
    if (gameState.citadelActive !== playerId) return false;

    for (const flag of gameState.board) {
        for (const pid of Object.keys(flag.cards)) {
            if (pid !== playerId) continue;
            const idx = flag.cards[pid].findIndex(
                c => c.rank === cardInfo.rank && c.color === cardInfo.color && c.owner === playerId
            );
            if (idx >= 0) {
                const [picked] = flag.cards[pid].splice(idx, 1);
                gameState.hands[playerId].push(picked);

                gameState.citadelActive = null;
                gameState.citadelUsed = true; // prevent retrigger
                updateScores(gameState);
                return true;
            }
        }
    }
    return false;
}




// --- Check Game Over ---
// --- Check if a flag is complete (any player filled it) ---
function isFlagComplete(flag) {
  return Object.values(flag.cards).some(cards => cards.length >= flag.maxCards);
}

// --- Check Game Over ---
function checkGameOver(gameState) {
  // Game ends only if every flag is fully completed (all players filled maxCards)
  const allFlagsComplete = gameState.board.every(flag =>
    Object.values(flag.cards).every(cards => cards.length >= flag.maxCards)
  );

  if (!allFlagsComplete) {
    return { gameOver: false, finalWinner: null, scores: gameState.scores };
  }

  // Determine scores based on fully completed flags
  const scores = {};
  Object.keys(gameState.hands).forEach(pid => scores[pid] = 0);

  gameState.board.forEach(flag => {
    // Only count fully completed flags
    const isFlagComplete = Object.values(flag.cards).every(cards => cards.length >= flag.maxCards);
    if (!isFlagComplete) return;

    const winner = evaluateFlag(flag);
    if (winner) scores[winner]++;
  });

  // Determine final winner
  let maxScore = -1;
  let winners = [];
  for (const pid in scores) {
    if (scores[pid] > maxScore) {
      maxScore = scores[pid];
      winners = [pid];
    } else if (scores[pid] === maxScore) {
      winners.push(pid);
    }
  }

  const finalWinner = winners.length === 1 ? winners[0] : "Tie";
  return { gameOver: true, finalWinner, scores };
}



// --- Start Server ---
const PORT = 3000;
httpServer.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
