
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
const ROUND_MS = 120000;
const TAG_RANGE = 2.4;
const TAG_COOLDOWN_MS = 500;

// Các vật cản lấy theo bản đồ trong index.html.
// Mỗi vật cản: [tâm X, tâm Z, chiều rộng, chiều sâu].
const obstacles = [
  [-8, -7, 3, 3],
  [7, -9, 4, 2],
  [0, -15, 5, 2],
  [-15, 4, 2.5, 5],
  [13, 3, 3, 3],
  [1, 7, 4, 2],
  [-5, 15, 3, 3],
  [10, 16, 4, 2],
  [-18, -14, 3, 3],
  [19, -12, 2, 4],
  [0, 0, 2, 2]
];

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) =>
  res.json({ ok: true, rooms: rooms.size })
);

function makeRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id;
  do {
    id = Array.from({ length: 5 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(id));
  return id;
}

function safeName(value) {
  const name = String(value || "Player")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 18);
  return name || "Player";
}

function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    hp: 100,
    score: p.score,
    color: p.color,
    role: p.id === room.chaserId ? "chaser" : "runner"
  }));
}

function sendRoomState(room) {
  io.to(room.id).emit("roomState", {
    roomId: room.id,
    hostId: room.hostId,
    players: publicPlayers(room),
    chaserId: room.chaserId,
    roundActive: room.roundActive,
    roundNumber: room.roundNumber,
    endsAt: room.endsAt
  });
}

function startRound(room) {
  if (!rooms.has(room.id) || room.players.size < 2) {
    room.roundActive = false;
    room.chaserId = null;
    room.endsAt = 0;
    sendRoomState(room);
    return;
  }

  const ids = [...room.players.keys()];
  room.chaserId = ids[Math.floor(Math.random() * ids.length)];
  room.roundNumber++;
  room.roundActive = true;
  room.endsAt = Date.now() + ROUND_MS;

  const chaser = room.players.get(room.chaserId);
  io.to(room.id).emit(
    "systemMessage",
    `Ván ${room.roundNumber} bắt đầu! ${chaser.name} là NGƯỜI ĐUỔI. Thời gian: 2 phút!`
  );

  sendRoomState(room);
}

function scheduleNextRound(room) {
  if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);

  room.roundActive = false;
  room.chaserId = null;
  room.endsAt = 0;
  sendRoomState(room);

  room.nextRoundTimer = setTimeout(() => {
    if (rooms.get(room.id) === room) startRound(room);
  }, 3000);
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(min, Math.min(max, n))
    : fallback;
}

// Kiểm tra đường thẳng giữa hai người có cắt vật cản không.
function blockedByObstacle(x1, z1, x2, z2) {
  for (const [cx, cz, w, d] of obstacles) {
    const minX = cx - w / 2 - 0.12;
    const maxX = cx + w / 2 + 0.12;
    const minZ = cz - d / 2 - 0.12;
    const maxZ = cz + d / 2 + 0.12;

    let tMin = 0;
    let tMax = 1;
    const dx = x2 - x1;
    const dz = z2 - z1;

    for (const [origin, delta, min, max] of [
      [x1, dx, minX, maxX],
      [z1, dz, minZ, maxZ]
    ]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < min || origin > max) {
          tMin = 2;
          break;
        }
      } else {
        let a = (min - origin) / delta;
        let b = (max - origin) / delta;
        if (a > b) [a, b] = [b, a];
        tMin = Math.max(tMin, a);
        tMax = Math.min(tMax, b);
      }
    }

    if (tMin <= tMax && tMax >= 0 && tMin <= 1) {
      return true;
    }
  }
  return false;
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}, reply = () => {}) => {
    if (socket.data.roomId) leaveRoom(socket);

    const id = makeRoomId();
    const room = {
      id,
      hostId: socket.id,
      players: new Map(),
      createdAt: Date.now(),
      chaserId: null,
      roundActive: false,
      roundNumber: 0,
      endsAt: 0,
      nextRoundTimer: null
    };

    rooms.set(id, room);
    addPlayer(socket, room, name);
    reply({ ok: true, roomId: id, playerId: socket.id });
    sendRoomState(room);
  });

  socket.on("joinRoom", ({ roomId, name } = {}, reply = () => {}) => {
    const id = String(roomId || "").trim().toUpperCase();
    const room = rooms.get(id);

    if (!room) {
      return reply({
        ok: false,
        error: "Không tìm thấy phòng. Hãy kiểm tra lại ID."
      });
    }

    if (room.players.size >= MAX_PLAYERS) {
      return reply({
        ok: false,
        error: `Phòng đã đủ ${MAX_PLAYERS} người.`
      });
    }

    if (socket.data.roomId) leaveRoom(socket);

    addPlayer(socket, room, name);
    reply({ ok: true, roomId: id, playerId: socket.id });
    sendRoomState(room);
    socket.to(id).emit(
      "systemMessage",
      `${safeName(name)} đã tham gia phòng.`
    );

    if (room.players.size >= 2 && !room.roundActive) {
      if (room.nextRoundTimer) {
        clearTimeout(room.nextRoundTimer);
        room.nextRoundTimer = null;
      }
      startRound(room);
    }
  });

  socket.on("move", data => {
    const room = rooms.get(socket.data.roomId);
    const p = room && room.players.get(socket.id);
    if (!p || !data) return;

    p.x = clampNum(data.x, -ARENA_LIMIT, ARENA_LIMIT, p.x);
    p.z = clampNum(data.z, -ARENA_LIMIT, ARENA_LIMIT, p.z);
    p.yaw = clampNum(data.yaw, -Math.PI * 100, Math.PI * 100, p.yaw);

    socket.to(room.id).emit("playerMoved", {
      id: p.id,
      x: p.x,
      y: 1.65,
      z: p.z,
      yaw: p.yaw
    });
  });

  socket.on("tag", ({ targetId } = {}) => {
    const room = rooms.get(socket.data.roomId);
    const actor = room && room.players.get(socket.id);
    const target = room && room.players.get(String(targetId || ""));

    if (!room || !room.roundActive || !actor || !target) return;
    if (actor.id !== room.chaserId) return;
    if (target.id === actor.id) return;

    const now = Date.now();
    if (now - actor.lastTagAt < TAG_COOLDOWN_MS) return;

    const distance = Math.hypot(
      actor.x - target.x,
      actor.z - target.z
    );

    if (distance > TAG_RANGE) return;

    if (blockedByObstacle(actor.x, actor.z, target.x, target.z)) {
      socket.emit("systemMessage", "Không thể bắt xuyên qua vật cản!");
      return;
    }

    actor.lastTagAt = now;
    actor.score++;

    // Đổi vai: người bị bắt trở thành người đuổi mới.
    room.chaserId = target.id;

    io.to(room.id).emit(
      "systemMessage",
      `${actor.name} bắt được ${target.name}! ${target.name} trở thành NGƯỜI ĐUỔI!`
    );

    sendRoomState(room);
  });

  socket.on("disconnect", () => leaveRoom(socket));
});

function addPlayer(socket, room, name) {
  const colors = [
    "#58c4f6", "#ff9f43", "#9b8cff", "#61d095",
    "#ff6b81", "#f4d35e", "#ee82ee", "#7bdff2"
  ];

  const p = {
    id: socket.id,
    name: safeName(name),
    x: randomSpawn(),
    y: 1.65,
    z: randomSpawn(),
    yaw: 0,
    score: 0,
    lastTagAt: 0,
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

  const wasChaser = room.chaserId === socket.id;
  room.players.delete(socket.id);

  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value || null;
  }

  if (room.players.size === 0) {
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    rooms.delete(id);
    return;
  }

  if (room.players.size < 2) {
    room.roundActive = false;
    room.chaserId = null;
    room.endsAt = 0;
    if (room.nextRoundTimer) {
      clearTimeout(room.nextRoundTimer);
      room.nextRoundTimer = null;
    }
    io.to(id).emit("systemMessage", "Đang chờ thêm người chơi...");
    sendRoomState(room);
    return;
  }

  if (wasChaser) {
    scheduleNextRound(room);
    io.to(id).emit(
      "systemMessage",
      "Người đuổi đã rời phòng. Ván mới sẽ bắt đầu sau 3 giây."
    );
  } else {
    sendRoomState(room);
  }
}

function randomSpawn() {
  // Bản đồ có một vật cản ở giữa; tránh xuất hiện sát tâm bản đồ.
  for (let i = 0; i < 100; i++) {
    const x = Math.round((Math.random() * 28 - 14) * 10) / 10;
    const z = Math.round((Math.random() * 28 - 14) * 10) / 10;

    if (!obstacles.some(([cx, cz, w, d]) =>
      Math.abs(x - cx) < w / 2 + 0.6 &&
      Math.abs(z - cz) < d / 2 + 0.6
    )) {
      return Math.abs(x) < 2 && Math.abs(z) < 2 ? 4 : x;
    }
  }
  return 11;
}

// Tự động kết thúc ván sau 120 giây.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.roundActive && Date.now() >= room.endsAt) {
      io.to(room.id).emit(
        "systemMessage",
        `Ván ${room.roundNumber} đã hết giờ! Ván mới bắt đầu sau 3 giây.`
      );
      scheduleNextRound(room);
    }
  }
}, 250);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Arena Online server listening on port ${PORT}`);
});
