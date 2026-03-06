const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── World config ─────────────────────────────────────────────────────────────
const WORLD_W = 3000;
const WORLD_H = 3000;
const TICK_MS = 1000 / 30; // 30 Hz
const SPEED = 4;
const PLAYER_RADIUS = 18;

// ── State ─────────────────────────────────────────────────────────────────────
const players = {};

function randomPos() {
  return {
    x: PLAYER_RADIUS + Math.random() * (WORLD_W - PLAYER_RADIUS * 2),
    y: PLAYER_RADIUS + Math.random() * (WORLD_H - PLAYER_RADIUS * 2),
  };
}

// ── Game loop ─────────────────────────────────────────────────────────────────
setInterval(() => {
  for (const id in players) {
    const p = players[id];
    const { keys } = p;

    let dx = 0, dy = 0;
    if (keys.up)    dy -= 1;
    if (keys.down)  dy += 1;
    if (keys.left)  dx -= 1;
    if (keys.right) dx += 1;

    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    p.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_W - PLAYER_RADIUS, p.x + dx * SPEED));
    p.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_H - PLAYER_RADIUS, p.y + dy * SPEED));
  }

  // Broadcast all positions
  const snapshot = Object.values(players).map(p => ({
    id: p.id, x: p.x, y: p.y, name: p.name, r: PLAYER_RADIUS,
  }));
  io.emit('state', snapshot);
}, TICK_MS);

// ── Socket ────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  socket.on('join', ({ name }) => {
    // [BUG FIX #4] 이미 join한 플레이어가 재접속 시 중복 join으로 위치가 리셋되는 문제 방지
    if (players[socket.id]) return;
    const trimmed = (name || 'Player').trim().slice(0, 16) || 'Player';
    const pos = randomPos();
    players[socket.id] = {
      id: socket.id,
      name: trimmed,
      x: pos.x, y: pos.y,
      keys: { up: false, down: false, left: false, right: false },
    };
    socket.emit('welcome', { id: socket.id, worldW: WORLD_W, worldH: WORLD_H });
  });

  socket.on('keys', (keys) => {
    if (!players[socket.id]) return;
    // [BUG FIX #5] 클라이언트에서 임의 값을 keys로 보낼 경우 boolean으로 강제 변환
    players[socket.id].keys = {
      up:    !!keys.up,
      down:  !!keys.down,
      left:  !!keys.left,
      right: !!keys.right,
    };
  });

  socket.on('disconnect', () => {
    console.log('[-]', socket.id);
    delete players[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`◉ sphere.io → http://localhost:${PORT}`));