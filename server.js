const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Redirect root URL to pixelsquad-loading.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pixelsquad-loading.html"));
});

const rooms = {};

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

function assignRoles(roomId) {
  const room = rooms[roomId];
  const maxPlayers = ROLES.length; // Limit to 5 roles
  if (room.players.length > maxPlayers) {
    console.warn(`Room ${roomId} has more players (${room.players.length}) than roles (${maxPlayers}). Limiting to ${maxPlayers}.`);
    room.players = room.players.slice(0, maxPlayers);
  }
  const availableRoles = shuffle([...ROLES]).slice(0, room.players.length);
  room.players.forEach((player, index) => {
    player.role = availableRoles[index] || "Spectator"; // Default to Spectator if roles run out
    player.points = player.points || 0;
    if (!player.roundScores) player.roundScores = [];
  });
  io.to(roomId).emit("rolesAssigned", { players: room.players });
  io.to(roomId).emit("updatePlayers", room.players.map(p => ({ name: p.name })));
}

function endRound(roomId, guessMade = false) {
  const room = rooms[roomId];
  const police = room.players.find(p => p.role === "Police");
  const thief = room.players.find(p => p.role === "Thief");
  let message = "Round ended. No guess made by Police.";

  if (guessMade && police && thief) {
    const isCorrectGuess = police.guessed === thief.name;
    message = isCorrectGuess
      ? `${police.name} caught the Thief!`
      : `${police.name} guessed wrong. Thief escapes!`;

    room.players.forEach(player => {
      if (player.role === "Raja") player.points += ROLE_SCORES.Raja;
      if (player.role === "Rani") player.points += ROLE_SCORES.Rani;
      if (player.role === "Minister") player.points += ROLE_SCORES.Minister;
      if (player.role === "Police" && isCorrectGuess) player.points += ROLE_SCORES.Police;
      if (player.role === "Thief" && !isCorrectGuess) player.points += ROLE_SCORES.Thief;
      player.roundScores.push({ round: room.currentRound, score: player.points });
    });
    // Reset guessed for the next round
    if (police) police.guessed = null;
  } else {
    room.players.forEach(player => {
      if (player.role === "Raja") player.points += ROLE_SCORES.Raja;
      if (player.role === "Rani") player.points += ROLE_SCORES.Rani;
      if (player.role === "Minister") player.points += ROLE_SCORES.Minister;
      player.roundScores.push({ round: room.currentRound, score: player.points });
    });
  }

  io.to(roomId).emit("result", { message, players: room.players, currentRound: room.currentRound });
}

function endGame(roomId) {
  const room = rooms[roomId];
  room.players.forEach(player => {
    player.totalScore = player.roundScores.reduce((sum, rs) => sum + (rs.score || 0), 0);
  });
  io.to(roomId).emit("gameOver", { players: room.players });
}

io.on("connection", (socket) => {
  socket.on("createRoom", (name) => {
    let roomId;
    do {
      roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms[roomId]);
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], currentRound: 1 };
      const newPlayer = { id: socket.id, name, role: null, points: 0, roundScores: [] };
      rooms[roomId].players.push(newPlayer);
      socket.join(roomId);
      console.log(`Room created: ${roomId} by ${name}`);
      socket.emit("roomCreated", roomId);
      io.to(roomId).emit("updatePlayers", rooms[roomId].players.map(p => ({ name: p.name })));
    }
  });

  socket.on("joinRoom", ({ name, roomId: requestedRoomId }) => {
    let targetRoomId = requestedRoomId;
    
    if (!targetRoomId || !rooms[targetRoomId]) {
      targetRoomId = Object.keys(rooms).find(id => rooms[id].players.length < 5);
      if (!targetRoomId) {
        targetRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[targetRoomId] = { players: [], currentRound: 1 };
      }
    }
    
    if (rooms[targetRoomId].players.some(p => p.name === name)) {
      socket.emit("error", "Name already taken in this room!");
      return;
    }
    
    const newPlayer = { id: socket.id, name, role: null, points: 0, roundScores: [] };
    rooms[targetRoomId].players.push(newPlayer);
    socket.join(targetRoomId);
    console.log(`${name} joined room: ${targetRoomId}`);
    socket.emit("joinedRoom", { roomId: targetRoomId });
    io.to(targetRoomId).emit("updatePlayers", rooms[targetRoomId].players.map(p => ({ name: p.name })));
    if (rooms[targetRoomId].players.length >= 2) assignRoles(targetRoomId);
  });

  socket.on("guessThief", ({ roomId, name }) => {
    const room = rooms[roomId];
    const police = room.players.find(p => p.id === socket.id && p.role === "Police");
    if (police && !police.guessed) {
      police.guessed = name;
      endRound(roomId, true);
    } else {
      socket.emit("error", "You have already made a guess or are not the Police!");
    }
  });

  socket.on("nextRound", (roomId) => {
    rooms[roomId].currentRound++;
    assignRoles(roomId);
  });

  socket.on("exitGame", (roomId) => {
    endGame(roomId);
  });

  socket.on("restartGame", (roomId) => {
    rooms[roomId] = { players: [], currentRound: 1 };
    io.to(roomId).emit("gameRestarted");
  });

  socket.on("requestRoleSync", ({ roomId, name }) => {
    const room = rooms[roomId];
    if (room) {
      const player = room.players.find(p => p.name === name);
      if (player) {
        socket.emit("roleSync", { name: player.name, role: player.role, points: player.points });
      }
    }
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomId).emit("updatePlayers", room.players.map(p => ({ name: p.name })));
        if (room.players.length < 2) {
          io.to(roomId).emit("result", { message: "Not enough players. Game paused.", players: room.players, currentRound: room.currentRound });
        }
        if (room.players.length === 0) delete rooms[roomId];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));