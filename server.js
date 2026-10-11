const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
  pingInterval: 25000,
  pingTimeout: 20000
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const MAX_PLAYERS = 8;
const ARENA_LIMIT = 24;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function makeRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id;
  do {
    id = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(id));
  return id;
}

function safeName(value) {
  const name = String(value || "Player").trim().replace(/[<>]/g, "").slice(0, 18);
  return name || "Player";
}

function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    hp: p.hp, score: p.score, color: p.color
  }));
}

function sendRoomState(room) {
  io.to(room.id).emit("roomState", {
    roomId: room.id,
    hostId: room.hostId,
    players: publicPlayers(room)
  });
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}, reply = () => {}) => {
    if (socket.data.roomId) leaveRoom(socket);
    const id = makeRoomId();
    const room = { id, hostId: socket.id, players: new Map(), createdAt: Date.now() };
    rooms.set(id, room);
    addPlayer(socket, room, name);
    reply({ ok: true, roomId: id, playerId: socket.id });
    sendRoomState(room);
  });

  socket.on("joinRoom", ({ roomId, name } = {}, reply = () => {}) => {
    const id = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(id);
    if (!room) return reply({ ok: false, error: "Không tìm thấy phòng. Hãy kiểm tra lại ID." });
    if (room.players.size >= MAX_PLAYERS) return reply({ ok: false, error: `Phòng đã đủ ${MAX_PLAYERS} người.` });
    if (socket.data.roomId) leaveRoom(socket);
    addPlayer(socket, room, name);
    reply({ ok: true, roomId: id, playerId: socket.id });
    sendRoomState(room);
    socket.to(id).emit("systemMessage", `${safeName(name)} đã tham gia phòng.`);
  });

  socket.on("move", data => {
    const room = rooms.get(socket.data.roomId);
    const p = room && room.players.get(socket.id);
    if (!p || !data) return;
    // Clamp and validate all client values before broadcasting.
    p.x = clampNum(data.x, -ARENA_LIMIT, ARENA_LIMIT, p.x);
    p.z = clampNum(data.z, -ARENA_LIMIT, ARENA_LIMIT, p.z);
    p.yaw = clampNum(data.yaw, -Math.PI * 100, Math.PI * 100, p.yaw);
    p.pitch = clampNum(data.pitch, -1.45, 1.45, p.pitch);
    p.y = 1.65;
    socket.to(room.id).emit("playerMoved", {
      id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch
    });
  });

  socket.on("shoot", ({ targetId } = {}) => {
    const room = rooms.get(socket.data.roomId);
    const shooter = room && room.players.get(socket.id);
    const target = room && room.players.get(String(targetId || ""));
    if (!shooter || !target || shooter.id === target.id || target.hp <= 0) return;
    // Prototype hit validation: the client reports the target it hit. For a public competitive
    // game, replace this with server-side ray casting and rate limits.
    target.hp = Math.max(0, target.hp - 25);
    if (target.hp === 0) {
      shooter.score += 1;
      io.to(room.id).emit("systemMessage", `${shooter.name} hạ ${target.name}!`);
      setTimeout(() => {
        const currentRoom = rooms.get(room.id);
        const currentTarget = currentRoom && currentRoom.players.get(target.id);
        if (currentTarget) {
          currentTarget.hp = 100;
          currentTarget.x = randomSpawn();
          currentTarget.z = randomSpawn();
          sendRoomState(currentRoom);
        }
      }, 2500);
    }
    io.to(room.id).emit("playerHit", { targetId: target.id, hp: target.hp, shooterId: shooter.id, score: shooter.score });
    sendRoomState(room);
  });

  socket.on("disconnect", () => leaveRoom(socket));
});

function addPlayer(socket, room, name) {
  const colors = ["#58c4f6", "#ff9f43", "#9b8cff", "#61d095", "#ff6b81", "#f4d35e", "#ee82ee", "#7bdff2"];
  const p = {
    id: socket.id, name: safeName(name), x: randomSpawn(), y: 1.65, z: randomSpawn(),
    yaw: 0, pitch: 0, hp: 100, score: 0,
    color: colors[room.players.size % colors.length]
  };
  room.players.set(socket.id, p);
  socket.join(room.id);
  socket.data.roomId = room.id;
}

function leaveRoom(socket) {
  const id = socket.data.roomId;
  if (!id) return;
  const room = rooms.get(id);
  socket.leave(id);
  socket.data.roomId = null;
  if (!room) return;
  room.players.delete(socket.id);
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value || null;
  if (room.players.size === 0) rooms.delete(id);
  else sendRoomState(room);
}

function randomSpawn() { return Math.round((Math.random() * 28 - 14) * 10) / 10; }
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`FPS multiplayer server listening on port ${PORT}`);
});
