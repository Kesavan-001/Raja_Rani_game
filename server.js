const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

let players = [];
let currentRound = 1;
const ROLES = ["Raja", "Rani", "Minister", "Police", "Thief"];
const ROLE_SCORES = {
  Raja: 100,
  Rani: 80,
  Minister: 50,
  Police: 100,
  Thief: 100
};

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function assignRoles() {
  const availableRoles = shuffle([...ROLES]).slice(0, players.length);
  players.forEach((player, index) => {
    player.role = availableRoles[index];
    player.points = player.points || 0;
    if (!player.roundScores) player.roundScores = [];
  });
  io.emit("rolesAssigned", { players });
  io.emit("updatePlayers", players.map(p => ({ name: p.name })));
}

function endRound(guessMade = false) {
  const police = players.find(p => p.role === "Police");
  const thief = players.find(p => p.role === "Thief");
  let message = "Round ended. No guess made by Police.";

  if (guessMade && police && thief) {
    const isCorrectGuess = police.guessed === thief.name;
    message = isCorrectGuess
      ? `${police.name} caught the Thief!`
      : `${police.name} guessed wrong. Thief escapes!`;

    players.forEach(player => {
      if (player.role === "Raja") player.points += ROLE_SCORES.Raja;
      if (player.role === "Rani") player.points += ROLE_SCORES.Rani;
      if (player.role === "Minister") player.points += ROLE_SCORES.Minister;
      if (player.role === "Police" && isCorrectGuess) player.points += ROLE_SCORES.Police;
      if (player.role === "Thief" && !isCorrectGuess && guessMade) player.points += ROLE_SCORES.Thief;
      player.roundScores.push({ round: currentRound, score: player.points });
    });
  } else {
    players.forEach(player => {
      if (player.role === "Raja") player.points += ROLE_SCORES.Raja;
      if (player.role === "Rani") player.points += ROLE_SCORES.Rani;
      if (player.role === "Minister") player.points += ROLE_SCORES.Minister;
      player.roundScores.push({ round: currentRound, score: player.points });
    });
  }

  io.emit("result", { message, players, currentRound });
}

function endGame() {
  players.forEach(player => {
    player.totalScore = player.roundScores.reduce((sum, rs) => sum + rs.score, 0);
  });
  io.emit("gameOver", { players });
}

io.on("connection", (socket) => {
  socket.on("joinGame", (name) => {
    if (players.some(p => p.name === name)) {
      socket.emit("error", "Name already taken!");
      return;
    }
    const newPlayer = { id: socket.id, name, role: null, points: 0, roundScores: [] };
    players.push(newPlayer);
    io.emit("updatePlayers", players.map(p => ({ name: p.name })));
    if (players.length >= 2) assignRoles();
  });

  socket.on("guessThief", (guessedName) => {
    const police = players.find(p => p.id === socket.id && p.role === "Police");
    if (police) {
      police.guessed = guessedName;
      endRound(true);
    }
  });

  socket.on("nextRound", () => {
    currentRound++;
    assignRoles();
  });

  socket.on("exitGame", () => {
    endGame();
  });

  socket.on("restartGame", () => {
    players = [];
    currentRound = 1;
    io.emit("gameRestarted");
  });

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit("updatePlayers", players.map(p => ({ name: p.name })));
    if (players.length < 2) {
      io.emit("result", { message: "Not enough players. Game paused.", players, currentRound });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));