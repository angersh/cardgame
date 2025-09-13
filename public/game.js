import { Card, COLORS, RANKS } from '/gameLogic/Card.js';

const socket = io();
let gameState;
let selectedCard = null;
let selectedCardRect = null;   // rectangle for visual highlight
let selectedCardGlow = null;   // persistent glow rectangle

let citadelMove = false;        // Flag to indicate Citadel move mode
let citadelFromFlag = null;     // Which flag the card is coming from

let gameOverText = null;

socket.emit("joinGame");

socket.on("startGame", (state) => {
  gameState = state;
  initPhaserGame();
});


socket.on("updateGame", (state) => {
  gameState = state;

  // ✅ Skip redraw if game is over (overlay stays visible)
  if (window.scene && !gameState.gameOver) {
    redraw(window.scene);
  }

  // ✅ Deselect if selected card no longer in hand
  if (selectedCard) {
    const hand = gameState.hands[socket.id] || [];
    const stillInHand = hand.some(
      c => c.rank === selectedCard.rank && c.color === selectedCard.color
    );

    if (!stillInHand && selectedCardGlow) {
      selectedCardGlow.setVisible(false);
      selectedCard = null;
      selectedCardRect = null;
    }
  }

  // ✅ Citadel move prompt (only once when it activates)
  if (gameState.citadelActive === socket.id && !citadelMove) {
    console.log("Citadel active! Select a card to move.");
  }
});



function getCardColor(color) {
  switch (color) {
    case "Red": return 0xff4d4d;
    case "Blue": return 0x4d4dff;
    case "Green": return 0x4dff4d;
    case "Yellow": return 0xffff4d;
    case "Purple": return 0xb84dff;
    case "Orange": return 0xffa500;
    case "Pink": return 0xffc0cb;
    default: return 0xffffff;
  }
}

function initPhaserGame() {
  const config = {
    type: Phaser.AUTO,
    width: 1200,
    height: 1000,
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

function redraw(scene) {
  const selectedInfo = selectedCard ? { rank: selectedCard.rank, color: selectedCard.color } : null;

  // Clear previous objects except glow
  scene.children.list
    .filter(obj => obj !== selectedCardGlow && obj !== gameOverText)
    .forEach(obj => obj.destroy());

  drawBoard(scene);
  drawCannon(scene);
  drawHand(scene);
  drawDeck(scene);
  drawScores(scene);

  // Restore glow for selected card
  if (selectedInfo) {
    const hand = gameState.hands[socket.id] || [];
    const card = hand.find(c => c.rank === selectedInfo.rank && c.color === selectedInfo.color);
    if (card) {
      selectedCard = card;
      const cardRect = scene.children.getChildren().find(obj => obj.getData && obj.getData('card') === card);
      if (cardRect) {
        selectedCardRect = cardRect;
        selectedCardGlow.setPosition(cardRect.x, cardRect.y).setVisible(true);
      }
    }
  }
}

function drawBoard(scene) {
  if (!gameState || !gameState.board) return;
  const cardWidth = 40, cardHeight = 60, padding = 5;
  const flagPadding = 40;
  const totalFlags = gameState.board.length;
  const spacingX = 120;
  const centerX = scene.cameras.main.centerX;
  const centerY = scene.cameras.main.centerY;
  const middleIndex = Math.floor(totalFlags / 2);
  const startX = centerX - middleIndex * spacingX;

  const cannonReady = isCannonReady(socket.id);

  gameState.board.forEach((flag, idx) => {
    const x = startX + idx * spacingX;
    const y = centerY;

    const rect = scene.add.rectangle(x, y, 90, 50, 0x6666ff)
      .setStrokeStyle(2, 0xffffff)
      .setInteractive();

    scene.add.text(x, y, flag.type, { font: "14px Arial", fill: "#fff" }).setOrigin(0.5);

    if (flag.claimedBy) {
      const winnerColor = flag.claimedBy === socket.id ? 0xffff00 : 0xff0000;
      rect.setStrokeStyle(4, winnerColor);
      const bestFormation = flag.bestFormation || "";
      scene.add.text(x, y + 30, bestFormation, { font: "12px Arial", fill: "#fff" }).setOrigin(0.5);
    }

    rect.on("pointerdown", () => {
      if (gameState.gameOver) return; // 🔴 prevent interaction after game ends

      if (citadelMove && selectedCard && citadelFromFlag !== null) {
        socket.emit("moveCard", { fromFlagId: citadelFromFlag, toFlagId: idx, card: selectedCard });
        citadelMove = false;
        selectedCard = null;
        selectedCardRect = null;
        selectedCardGlow.setVisible(false);
        citadelFromFlag = null;
      } else if (!gameState.attackMode && selectedCard) {
        socket.emit("placeCard", { card: selectedCard, flagId: idx });
      } else if (gameState.attackMode === socket.id) {
        const opponentId = Object.keys(flag.cards).find(id => id !== socket.id);
        if (!opponentId) return;
        const opponentCards = flag.cards[opponentId] || [];
        if (opponentCards.length > 0) {
          socket.emit("destroyCard", { flagId: idx, card: opponentCards[0] });
        }
      }
    });

    Object.entries(flag.cards).forEach(([playerId, cards]) => {
      if (!Array.isArray(cards)) return;
      const isHuman = playerId === socket.id;
      const direction = isHuman ? 1 : -1;
      const baseY = isHuman ? y + flagPadding + cardHeight / 2 : y - flagPadding - cardHeight / 2;

      cards.forEach((card, cIdx) => {
        const cardY = baseY + direction * cIdx * (cardHeight + padding);
        const color = getCardColor(card.color);

        const cardRect = scene.add.rectangle(x, cardY, cardWidth, cardHeight, color)
          .setStrokeStyle(2, 0x000000)
          .setData("card", card)
          .setInteractive();

        scene.add.text(x, cardY, card.rank, { font: "14px Arial", fill: "#000" }).setOrigin(0.5);

        // Citadel effect: select a card to move
        if (gameState.citadelActive === socket.id && playerId === socket.id) {
          cardRect.setStrokeStyle(3, 0xffff00);
          cardRect.on("pointerdown", () => {
            if (gameState.gameOver) return; // 🔴 added safeguard
            selectedCard = card;
            citadelMove = true;
            citadelFromFlag = idx;
            selectedCardGlow.setPosition(cardRect.x, cardRect.y).setVisible(true);
          });
        }

        if (gameState.attackMode === socket.id && !isHuman) {
          cardRect.setStrokeStyle(4, 0xff0000);
          cardRect.on("pointerdown", () => {
            if (gameState.gameOver) return; // 🔴 added safeguard
            socket.emit("destroyCard", { flagId: idx, card });
          });
        }
      });
    });
  });
}


function drawCannon(scene) {
  if (!gameState || !gameState.cannon) return;
  const cardWidth = 40, cardHeight = 60, padding = 8;
  const CANNON_CARD_LIMIT = 2;

  const humanCannonX = scene.cameras.main.width - 100;
  const humanCannonY = scene.cameras.main.height - 180;
  const humanCannonReady = isCannonReady(socket.id);

  scene.add.rectangle(humanCannonX, humanCannonY, 80, 100, 0xff0000)
    .setStrokeStyle(humanCannonReady ? 4 : 2, humanCannonReady ? 0xffff00 : 0xffffff)
    .setInteractive()
    .on("pointerdown", () => {
      if (!selectedCard || gameState.attackMode || humanCannonReady) return;
      const playerCards = gameState.cannon[socket.id] || [];
      if (playerCards.length < CANNON_CARD_LIMIT) {
        socket.emit("placeCard", { card: selectedCard, flagId: "cannon" });
      }
    });

  scene.add.text(humanCannonX, humanCannonY - 70, "Your Cannon", { font: "12px Arial", fill: "#fff" }).setOrigin(0.5);

  (gameState.cannon[socket.id] || []).forEach((card, idx) => {
    const cardY = humanCannonY + idx * (cardHeight + padding);
    scene.add.rectangle(humanCannonX, cardY, cardWidth, cardHeight, getCardColor(card.color))
      .setStrokeStyle(2, 0x000000);
    scene.add.text(humanCannonX, cardY, card.rank, { font: "14px Arial", fill: "#000" }).setOrigin(0.5);
  });

  const aiCannonX = scene.cameras.main.width - 100;
  const aiCannonY = 180;
  const aiCannonCards = gameState.cannon["AI"] || [];
  const aiCannonReady = isCannonReady("AI");

  scene.add.rectangle(aiCannonX, aiCannonY, 80, 100, 0x5555ff)
    .setStrokeStyle(aiCannonReady ? 4 : 2, aiCannonReady ? 0xffff00 : 0xffffff);
  scene.add.text(aiCannonX, aiCannonY - 70, "AI Cannon", { font: "12px Arial", fill: "#fff" }).setOrigin(0.5);

  aiCannonCards.forEach((card, idx) => {
    const cardY = aiCannonY - idx * (cardHeight + padding);
    scene.add.rectangle(aiCannonX, cardY, cardWidth, cardHeight, getCardColor(card.color))
      .setStrokeStyle(2, 0x000000);
    scene.add.text(aiCannonX, cardY, card.rank, { font: "14px Arial", fill: "#000" }).setOrigin(0.5);
  });
}

function isCannonReady(playerId) {
  const CANNON_CARD_LIMIT = 2;
  const cards = gameState.cannon[playerId] || [];
  return cards.length === CANNON_CARD_LIMIT &&
         cards[0].color === cards[1].color &&
         !gameState.firedCannons[playerId];
}

function drawHand(scene) {
  if (!gameState || !gameState.hands) return;
  const cardWidth = 50, cardHeight = 70, padding = 20;
  const hand = gameState.hands[socket.id] || [];
  const yHuman = scene.cameras.main.height - 70;
  const strongholdX = scene.cameras.main.centerX;
  const startXHuman = strongholdX - ((hand.length - 1) * (cardWidth + padding)) / 2;
  const cannonReady = isCannonReady(socket.id);

  hand.forEach((card, idx) => {
    const x = startXHuman + idx * (cardWidth + padding);

    const rect = scene.add.rectangle(x, yHuman, cardWidth, cardHeight, getCardColor(card.color))
      .setStrokeStyle(2, 0x000000)
      .setInteractive()
      .setData("card", card);

    scene.add.text(x, yHuman, card.rank, { font: "16px Arial", fill: "#000" }).setOrigin(0.5);

    rect.on("pointerdown", () => {
      if (cannonReady || gameState.attackMode) return;
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
  });

  if (selectedCard && selectedCardRect) {
    selectedCardGlow.setPosition(selectedCardRect.x, selectedCardRect.y).setVisible(true);
  }

  const aiHand = gameState.hands["AI"] || [];
  const yAI = 70;
  const startXAI = strongholdX - ((aiHand.length - 1) * (cardWidth + padding)) / 2;
  aiHand.forEach((_, idx) => {
    const x = startXAI + idx * (cardWidth + padding);
    scene.add.rectangle(x, yAI, cardWidth, cardHeight, 0x999999).setStrokeStyle(2, 0x000000);
  });
}

function drawDeck(scene) {
  if (!gameState || !gameState.deck) return;
  const deckX = 50, deckY = 350;
  const cardWidth = 40, cardHeight = 60;
  const deckSize = gameState.deck.length;

  scene.add.rectangle(deckX, deckY, cardWidth, cardHeight, 0x444444)
    .setStrokeStyle(2, 0xffffff);
  scene.add.text(deckX, deckY, deckSize, { font: "16px Arial", fill: "#fff" }).setOrigin(0.5);
}

function drawScores(scene) {
  const padding = 20;
  let i = 0;
  if (!gameState.scores) return;
  for (let playerId in gameState.scores) {
    const score = gameState.scores[playerId];
    scene.add.text(50, 50 + i * 20, `${playerId}: ${score} flags`, { font: "16px Arial", fill: "#fff" });
    i++;
  }
}

socket.on("gameOver", ({ finalWinner, scores }) => {
    const scene = window.scene;
    if (!scene) return;

    const centerX = scene.cameras.main.centerX;
    const centerY = scene.cameras.main.centerY;

    // Destroy old UI if it exists
    if (gameOverText) gameOverText.destroy();
    if (scene.gameOverBox) scene.gameOverBox.destroy();

    // --- Background box ---
    const boxWidth = 420;
    const boxHeight = 300;
    const box = scene.add.rectangle(centerX, centerY, boxWidth, boxHeight, 0x000000, 0.85)
        .setStrokeStyle(4, 0xffff00)
        .setOrigin(0.5);
    scene.gameOverBox = box;

    // --- Title ---
    const title = finalWinner === "Tie" ? "Tie Game!" : `${finalWinner} Wins!`;
    scene.add.text(centerX, centerY - 100, title, { font: "40px Arial", fill: "#ffff00" }).setOrigin(0.5);

    // --- Score details ---
    let offsetY = -40;
    Object.entries(scores).forEach(([pid, score]) => {
        scene.add.text(centerX, centerY + offsetY, `${pid}: ${score} flags`, { font: "24px Arial", fill: "#ffffff" }).setOrigin(0.5);
        offsetY += 40;
    });

    // --- Play Again button ---
    const buttonWidth = 180;
    const buttonHeight = 50;

    const button = scene.add.rectangle(centerX, centerY + 100, buttonWidth, buttonHeight, 0x4444ff)
        .setStrokeStyle(3, 0xffffff)
        .setInteractive()
        .on("pointerdown", () => {
            socket.emit("restartGame");
        });

    scene.add.text(centerX, centerY + 100, "Play Again", { font: "20px Arial", fill: "#fff" }).setOrigin(0.5);

    // Freeze interaction with board after game over
    gameState.gameOver = true;
});


