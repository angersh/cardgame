import { Card, COLORS, RANKS } from './gameLogic/Card.js';

let socket = null;
let gameState = null;
let selectedCard = null;
let selectedCardRect = null;
let selectedCardGlow = null;
let citadelMove = false;
let citadelFromFlag = null;
let gameOverText = null;
let roomId = null;

// store tweens for blinking flags so we can clean them up
const flagBlinkTweens = new Map();

// --- Start Game ---
export function startGame(multiplayer = true, existingState = null, existingRoom = null) {
  const startScreen = document.getElementById("start-screen");
  if (startScreen) startScreen.style.display = "none";

  if (existingState) {
    gameState = existingState;
    roomId = existingRoom;
  }

  initPhaser();

  if (multiplayer && socket) {
    socket.on("updateGame", handleUpdateGame);
    socket.on("gameOver", handleGameOver);
    socket.on("opponentDisconnected", ({ playerId }) => {
      alert(`Opponent ${playerId} disconnected!`);
    });
    socket.on("cardDestroyed", handleDestroyedCard);
  } else {
    initAI();
  }
}

export function setSocket(socketInstance) {
  socket = socketInstance;
}

// --- AI Placeholder ---
function initAI() {
  console.log("AI mode not used in 1v1 online.");
}

// --- Handle Server Updates ---
function handleUpdateGame(state) {
  gameState = state;
  if (window.scene) redraw(window.scene);

  // Clear selected card if it no longer exists anywhere
  if (selectedCard) {
    const existsInHand = gameState.hands?.[socket.id]?.some(
      c => c.rank === selectedCard.rank && c.color === selectedCard.color && c.owner === selectedCard.owner
    );
    const existsOnFlag = gameState.board.some(flag =>
      Object.values(flag.cards).some(cards =>
        cards.some(c => c.rank === selectedCard.rank && c.color === selectedCard.color && c.owner === selectedCard.owner)
      )
    );
    const existsInCannon = Object.values(gameState.cannon || {}).some(cannon =>
      cannon.some(c => c.rank === selectedCard.rank && c.color === selectedCard.color && c.owner === selectedCard.owner)
    );

    if (!existsInHand && !existsOnFlag && !existsInCannon) {
      selectedCard = null;
      selectedCardRect = null;
      if (selectedCardGlow) selectedCardGlow.setVisible(false);
    }
  }

  // --- Citadel activation ---
  if (gameState.citadelActive === socket.id && !citadelMove) {
    citadelMove = true;
    console.log("Citadel active! Select one of your cards from any flag to move to your hand.");
  }
}

// --- Handle destroyed card from server ---
function handleDestroyedCard(card) {
  if (!gameState) return;

  // Remove card from board
  gameState.board.forEach(flag => {
    Object.keys(flag.cards).forEach(pid => {
      flag.cards[pid] = flag.cards[pid].filter(
        c => !(c.rank === card.rank && c.color === card.color && c.owner === card.owner)
      );
    });
  });

  // Remove card from cannon
  Object.keys(gameState.cannon || {}).forEach(pid => {
    gameState.cannon[pid] = (gameState.cannon[pid] || []).filter(
      c => !(c.rank === card.rank && c.color === card.color && c.owner === card.owner)
    );
  });

  // Clear selection if destroyed
  if (selectedCard && selectedCard.rank === card.rank && selectedCard.color === card.color && selectedCard.owner === card.owner) {
    selectedCard = null;
    selectedCardRect = null;
    if (selectedCardGlow) selectedCardGlow.setVisible(false);
  }

  if (window.scene) redraw(window.scene);
}

// --- Phaser Initialization ---
export function initPhaser() {
  const parent = document.getElementById("game-canvas-container");
  if (!parent) {
    console.error("No container with id 'game-canvas-container' found!");
    return;
  }
  parent.innerHTML = "";

  window.scene = null;
  window.socket = socket;

  const config = {
    type: Phaser.AUTO,
    width: 1200,
    height: 1000,
    parent: 'game-canvas-container',
    backgroundColor: "#222",
    scene: { preload, create }
  };

  new Phaser.Game(config);
}

function preload() {}
function create() {
  window.scene = this;

  const cardWidth = 50;
  const cardHeight = 70;

  if (!selectedCardGlow) {
    selectedCardGlow = this.add.rectangle(0, 0, cardWidth + 8, cardHeight + 8, 0xffffff, 0)
      .setStrokeStyle(4, 0xffffff)
      .setVisible(false);
  }

  redraw(this);
}

// --- Redraw Scene ---
function redraw(scene) {
  if (!gameState) return;

  const cardWidth = 40,
        cardHeight = 60,
        padding = 5;
  const flagPadding = 40;
  const spacingX = 120;
  const centerX = scene.cameras.main.centerX;
  const centerY = scene.cameras.main.centerY;
  const totalFlags = gameState.board.length;
  const middleIndex = Math.floor(totalFlags / 2);
  const startX = centerX - middleIndex * spacingX;

  // Clear previous flag rects & tweens
  gameState.board.forEach((flag, idx) => {
    if (flag.rect) {
      if (flagBlinkTweens.has(flag.rect)) {
        const t = flagBlinkTweens.get(flag.rect);
        try { t.stop(); } catch {}
        flagBlinkTweens.delete(flag.rect);
      }
      try { flag.rect.destroy(); } catch {}
    }
    if (flag.cardRects) flag.cardRects.forEach(c => { try { c.destroy(); } catch {} });
    flag.cardRects = [];
  });

  // Draw flags
  gameState.board.forEach((flag, idx) => {
    const x = startX + idx * spacingX;
    const y = centerY;

    const rect = scene.add.rectangle(x, y, 90, 50, 0x6666ff)
      .setStrokeStyle(2, 0xffffff)
      .setInteractive();
    rect.flagIndex = idx;

    scene.add.text(x, y, flag.type, { font: "14px Arial", fill: "#fff" }).setOrigin(0.5);
    rect.on("pointerdown", () => handleFlagClick(idx));

    flag.rect = rect;

    // Handle blinking for encampment freeze
    if (
      gameState.freezeForAttack &&
      gameState.freezeForAttack.type === "encampment" &&
      gameState.freezeForAttack.flagId === idx
    ) {
      startFlagBlink(scene, rect);
    } else {
      rect.setStrokeStyle(2, 0xffffff);
    }

    drawFlagCards(scene, flag, x, y, flagPadding, cardWidth, cardHeight, padding);
  });

  drawCannon(scene);
  drawHand(scene);
  drawDeck(scene);
  drawScores(scene);

  // Glow for selected card
  if (citadelMove && selectedCard && selectedCardRect) {
    selectedCardGlow.setPosition(selectedCardRect.x, selectedCardRect.y).setVisible(true);
  } else {
    selectedCardGlow.setVisible(false);
  }
}

// --- Flag Blinking Tween ---
function startFlagBlink(scene, rect) {
  if (flagBlinkTweens.has(rect)) return;

  const blink = scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: 600,
    yoyo: true,
    repeat: -1,
    onUpdate: tween => {
      const v = Math.round(tween.getValue() * 255);
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        { r: 255, g: 255, b: 255 },
        { r: 77, g: 77, b: 255 },
        255,
        v
      );
      try { rect.setStrokeStyle(4, Phaser.Display.Color.GetColor(color.r, color.g, color.b)); } catch {}
    }
  });

  flagBlinkTweens.set(rect, blink);
}

// --- Draw Flag Cards ---
function drawFlagCards(scene, flag, centerX, centerY, flagPadding, cardWidth, cardHeight, padding) {
  flag.cardRects = [];

  Object.entries(flag.cards).forEach(([playerId, cards]) => {
    const isHuman = playerId === socket.id;
    const direction = isHuman ? 1 : -1;
    const baseY = isHuman ? centerY + flagPadding + cardHeight / 2 : centerY - flagPadding - cardHeight / 2;

    cards.forEach((card, cIdx) => {
      const cardY = baseY + direction * cIdx * (cardHeight + padding);
      const container = scene.add.container(centerX, cardY);

      const rect = scene.add.rectangle(0, 0, cardWidth, cardHeight, getCardColor(card.color))
        .setStrokeStyle(2, 0x000000)
        .setData("card", card);

      const text = scene.add.text(0, 0, card.rank, { font: "14px Arial", fill: "#000000" })
        .setOrigin(0.5);

      container.add([rect, text]);
      container.setSize(cardWidth, cardHeight);
      container.setInteractive();

      // Selected card glow
      if (selectedCard && selectedCard.rank === card.rank && selectedCard.color === card.color && selectedCard.owner === card.owner) {
        selectedCardRect = container;
        selectedCardGlow.setPosition(container.x, container.y).setVisible(true);
      }

      // Attack highlight
      if (gameState.attackMode === socket.id && !isHuman) {
        rect.setStrokeStyle(4, 0xff0000);
        container.on("pointerdown", () => {
          if (!gameState.freezeForAttack) return;
          socket.emit("destroyCard", { 
            roomId, 
            flagId: flag.rect?.flagIndex ?? null, 
            card: { ...card, owner: playerId } 
          });
        });
      }

      // --- Citadel move ---
      if (gameState.citadelActive === socket.id && isHuman && card.owner === socket.id) {
        // Highlight the card
        rect.setStrokeStyle(3, 0xffff00);
        container.setInteractive();

        // Remove previous listeners to prevent duplicates
        container.removeAllListeners();

        container.on("pointerdown", () => {
          // Move the card to the player's hand
          selectedCard = card;
          selectedCardRect = container;
          selectedCardGlow.setPosition(container.x, container.y).setVisible(true);

          socket.emit("pickCardCitadel", { roomId, card });

          // Reset citadel selection
          gameState.citadelActive = null;
          citadelMove = false;
          selectedCard = null;
          selectedCardRect = null;
          selectedCardGlow.setVisible(false);
        });
      }

      // Track container for cleanup
      flag.cardRects.push(container);
    });
  });
}





// --- Flag Click Handler ---
function handleFlagClick(idx) {
  if (gameState.gameOver) return;
  const flag = gameState.board[idx];

  // --- Citadel Move ---
  if (citadelMove && selectedCard && citadelFromFlag !== null) {
    socket.emit("moveCard", { 
      roomId, 
      fromFlagId: citadelFromFlag, 
      toFlagId: idx, 
      card: selectedCard 
    });
    citadelMove = false;
    selectedCard = null;
    selectedCardRect = null;
    selectedCardGlow.setVisible(false);
    citadelFromFlag = null;
    return;
  }

  // --- Normal placement ---
  if (!gameState.attackMode && selectedCard) {
    socket.emit("placeCard", { roomId, card: selectedCard, flagId: idx });
  }
}

// --- Cannon Functions ---
function isCannonReady(playerId) {
  const CANNON_CARD_LIMIT = 2;
  const cards = gameState.cannon[playerId] || [];
  return cards.length === CANNON_CARD_LIMIT &&
         cards[0].color === cards[1].color &&
         !gameState.firedCannons[playerId];
}

function drawCannon(scene) {
  if (!gameState?.cannon) return;
  if (!window.cannonRects) window.cannonRects = {};
  const cardWidth = 40, cardHeight = 60, padding = 8;

  const yourCannonX = scene.cameras.main.width - 100;
  const yourCannonY = scene.cameras.main.height - 180;

  // Clear previous cannon cards
  Object.keys(gameState.cannon).forEach(playerId => {
    if (window.cannonRects[playerId]) window.cannonRects[playerId].forEach(r => r.destroy());
    window.cannonRects[playerId] = [];
  });

  const encampmentFreezeActive =
    gameState.freezeForAttack && gameState.freezeForAttack.type === "encampment";

  // --- Your Cannon ---
  const ready = isCannonReady(socket.id);
  const yourCannonBox = scene.add.rectangle(yourCannonX, yourCannonY, 80, 100, 0xff0000)
    .setStrokeStyle(ready ? 4 : 2, ready ? 0xffff00 : 0xffffff)
    .setInteractive()
    .on("pointerdown", () => {
      if (encampmentFreezeActive) return;
      if (!selectedCard || gameState.attackMode || ready) return;
      const cards = gameState.cannon[socket.id] || [];
      if (cards.length < 2) socket.emit("placeCard", { roomId, card: selectedCard, flagId: "cannon" });
    });

  scene.add.text(yourCannonX, yourCannonY - 70, "Your Cannon", { font: "12px Arial", fill: "#fff" }).setOrigin(0.5);

  (gameState.cannon[socket.id] || []).forEach((card, idx) => {
    const cardY = yourCannonY + idx * (cardHeight + padding);
    const rect = scene.add.rectangle(yourCannonX, cardY, cardWidth, cardHeight, getCardColor(card.color))
      .setStrokeStyle(2, 0x000000)
      .setData("card", card)
      .setInteractive();

    scene.add.text(yourCannonX, cardY, card.rank, { font: "14px Arial", fill: "#000000" }).setOrigin(0.5);

    if (!encampmentFreezeActive) {
      rect.on("pointerdown", () => {
        selectedCard = card;
        selectedCardRect = rect;
        selectedCardGlow.setPosition(rect.x, rect.y).setVisible(true);
      });
    }

    window.cannonRects[socket.id].push(rect);
  });

  // --- Opponent Cannon ---
  const opponentId = Object.keys(gameState.cannon).find(id => id !== socket.id);
  if (!opponentId) return;

  const oppCannonX = scene.cameras.main.width - 100;
  const oppCannonY = 180;
  const oppReady = isCannonReady(opponentId);

  scene.add.rectangle(oppCannonX, oppCannonY, 80, 100, 0x5555ff)
    .setStrokeStyle(oppReady ? 4 : 2, oppReady ? 0xffff00 : 0xffffff);
  scene.add.text(oppCannonX, oppCannonY - 70, "Opponent Cannon", { font: "12px Arial", fill: "#fff" }).setOrigin(0.5);

  (gameState.cannon[opponentId] || []).forEach((card, idx) => {
    const cardY = oppCannonY - idx * (cardHeight + padding);
    const rect = scene.add.rectangle(oppCannonX, cardY, cardWidth, cardHeight, getCardColor(card.color))
      .setStrokeStyle(2, 0x000000);

    scene.add.text(oppCannonX, cardY, card.rank, { font: "14px Arial", fill: "#000000" }).setOrigin(0.5);

    if (!window.cannonRects[opponentId]) window.cannonRects[opponentId] = [];
    window.cannonRects[opponentId].push(rect);
  });
}


// --- Draw Hand ---
function drawHand(scene) {
  if (!gameState?.hands) return;
  const cardWidth = 50, cardHeight = 70, padding = 20;
  const hand = gameState.hands[socket.id] || [];
  const yHuman = scene.cameras.main.height - 70;
  const centerX = scene.cameras.main.centerX;
  const startX = centerX - ((hand.length - 1) * (cardWidth + padding)) / 2;

  if (window.handRects) window.handRects.forEach(r => r.destroy());
  window.handRects = [];

  hand.forEach((card, idx) => {
    const x = startX + idx * (cardWidth + padding);

    const rect = scene.add.rectangle(x, yHuman, cardWidth, cardHeight, getCardColor(card.color))
      .setStrokeStyle(2, 0x000000)
      .setData("card", card)
      .setInteractive();

    scene.add.text(x, yHuman, card.rank, { font: "16px Arial", fill: "#000000" }).setOrigin(0.5);

    rect.on("pointerdown", () => {
      if (gameState.attackMode === socket.id) return;

      if (selectedCardRect === rect) {
        selectedCard = null;
        selectedCardRect = null;
        selectedCardGlow.setVisible(false);
        return;
      }

      selectedCard = card;
      selectedCardRect = rect;
      selectedCardGlow.setPosition(rect.x, rect.y).setVisible(true);
    });

    if (selectedCard && selectedCard.rank === card.rank && selectedCard.color === card.color) {
      selectedCardRect = rect;
      selectedCardGlow.setPosition(rect.x, rect.y).setVisible(true);
    }

    window.handRects.push(rect);
  });

  // AI hand display
  const aiHand = gameState.hands["AI"] || [];
  const yAI = 70;
  const startXAI = centerX - ((aiHand.length - 1) * (cardWidth + padding)) / 2;
  aiHand.forEach((_, idx) => {
    const x = startXAI + idx * (cardWidth + padding);
    scene.add.rectangle(x, yAI, cardWidth, cardHeight, 0x999999).setStrokeStyle(2, 0x000000);
  });
}

// --- Deck & Scores ---
function drawDeck(scene) {
  if (!gameState?.deck) return;
  const deckX = 50, deckY = 350;
  const cardWidth = 40, cardHeight = 60;

  scene.add.rectangle(deckX, deckY, cardWidth, cardHeight, 0x444444).setStrokeStyle(2, 0xffffff);
  scene.add.text(deckX, deckY, gameState.deck.length, { font: "16px Arial", fill: "#fff" }).setOrigin(0.5);
}

function drawScores(scene) {
  if (!gameState?.scores) return;
  let i = 0;
  for (let playerId in gameState.scores) {
    const score = gameState.scores[playerId];
    scene.add.text(50, 50 + i * 20, `${playerId}: ${score} flags`, { font: "16px Arial", fill: "#fff" });
    i++;
  }
}

// --- Game Over ---
function handleGameOver({ finalWinner, scores }) {
  const scene = window.scene;
  if (!scene) return;
  gameState.gameOver = true;

  const centerX = scene.cameras.main.centerX;
  const centerY = scene.cameras.main.centerY;

  if (gameOverText) gameOverText.destroy();
  if (scene.gameOverBox) scene.gameOverBox.destroy();

  const box = scene.add.rectangle(centerX, centerY, 420, 300, 0x000000, 0.85).setStrokeStyle(4, 0xffff00).setOrigin(0.5);
  scene.gameOverBox = box;

  const title = finalWinner === "Tie" ? "Tie Game!" : `${finalWinner} Wins!`;
  scene.add.text(centerX, centerY - 100, title, { font: "40px Arial", fill: "#ffff00" }).setOrigin(0.5);

  let offsetY = -40;
  Object.entries(scores).forEach(([pid, score]) => {
    scene.add.text(centerX, centerY + offsetY, `${pid}: ${score} flags`, { font: "24px Arial", fill: "#ffffff" }).setOrigin(0.5);
    offsetY += 40;
  });

  const button = scene.add.rectangle(centerX, centerY + 100, 180, 50, 0x4444ff)
    .setStrokeStyle(3, 0xffffff)
    .setInteractive()
    .on("pointerdown", () => socket?.emit("restartMatch", { roomId }));

  scene.add.text(centerX, centerY + 100, "Play Again", { font: "20px Arial", fill: "#fff" }).setOrigin(0.5);
}

// --- Utility ---
function getCardColor(color) {
  const colors = {
    Red: 0xff4d4d,
    Blue: 0x4d4dff,
    Green: 0x4dff4d,
    Yellow: 0xffff4d,
    Purple: 0xb84dff,
    Orange: 0xffa500,
    Pink: 0xffc0cb
  };
  return colors[color] || 0xffffff;
}
