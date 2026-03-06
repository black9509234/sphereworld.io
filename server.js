const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── World config ──────────────────────────────────────────
const WORLD_W       = 3000;
const WORLD_H       = 3000;
const TICK_MS       = 1000 / 30;  // 30 Hz
const SPEED         = 4;
const BASE_RADIUS   = 18;

// ── XP Orb config ─────────────────────────────────────────
const MAX_ORBS      = 80;   // max orbs alive at once
const ORB_RADIUS    = 7;
const ORB_SPAWN_MS  = 1200; // spawn one orb every N ms if below max
let   orbIdCounter  = 0;

// ── Level config ──────────────────────────────────────────
// xpForLevel[n] = total XP needed to reach level n+1 from level n
function xpToNextLevel(level) {
  return Math.floor(30 * Math.pow(1.4, level - 1)); // 30, 42, 59, 82 …
}
function radiusForLevel(level) {
  return BASE_RADIUS + Math.floor((level - 1) * 1.5); // grows slowly
}

// ── State ─────────────────────────────────────────────────
const players = {};
const orbs    = {};  // id → { id, x, y, value }

function randomPos(margin = 20) {
  return {
    x: margin + Math.random() * (WORLD_W - margin * 2),
    y: margin + Math.random() * (WORLD_H - margin * 2),
  };
}

function spawnOrb() {
  if (Object.keys(orbs).length >= MAX_ORBS) return;
  const id  = ++orbIdCounter;
  const pos = randomPos(30);
  orbs[id]  = { id, x: pos.x, y: pos.y, value: 5 + Math.floor(Math.random() * 6) }; // 5–10 xp
}

// Pre-fill orbs
for (let i = 0; i < MAX_ORBS; i++) spawnOrb();

// ── Orb spawn ticker ──────────────────────────────────────
setInterval(spawnOrb, ORB_SPAWN_MS);

// ── Game loop ─────────────────────────────────────────────
setInterval(() => {
  for (const id in players) {
    const p = players[id];
    let dx = 0, dy = 0;

    if (p.keys.up)    dy -= 1;
    if (p.keys.down)  dy += 1;
    if (p.keys.left)  dx -= 1;
    if (p.keys.right) dx += 1;
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    const r = radiusForLevel(p.level);
    p.x = Math.max(r, Math.min(WORLD_W - r, p.x + dx * SPEED));
    p.y = Math.max(r, Math.min(WORLD_H - r, p.y + dy * SPEED));

    // ── XP orb pickup ──
    for (const oid in orbs) {
      const o   = orbs[oid];
      const dist = Math.hypot(p.x - o.x, p.y - o.y);
      if (dist < r + ORB_RADIUS) {
        // Pickup
        p.xp += o.value;
        delete orbs[oid];

        // Emit pickup to the collector only (for orb despawn on client)
        io.to(id).emit('orbPickup', { orbId: Number(oid), xpGained: o.value });

        // Level up loop
        let leveled = false;
        while (p.xp >= xpToNextLevel(p.level)) {
          p.xp    -= xpToNextLevel(p.level);
          p.level += 1;
          leveled  = true;
        }
        if (leveled) {
          io.emit('levelUp', { id: p.id, level: p.level, name: p.name });
        }
      }
    }
  }

  // ── Broadcast state ──
  const snapshot = Object.values(players).map(p => ({
    id:    p.id,
    x:     p.x,
    y:     p.y,
    name:  p.name,
    r:     radiusForLevel(p.level),
    level: p.level,
    xp:    p.xp,
    xpMax: xpToNextLevel(p.level),
  }));
  const orbList = Object.values(orbs);

  io.emit('state', { players: snapshot, orbs: orbList });
}, TICK_MS);

// ── Socket ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  socket.on('join', ({ name }) => {
    if (players[socket.id]) return;  // prevent duplicate join
    const trimmed = (name || 'Player').trim().slice(0, 16) || 'Player';
    const pos     = randomPos(BASE_RADIUS);
    players[socket.id] = {
      id:    socket.id,
      name:  trimmed,
      x:     pos.x,
      y:     pos.y,
      level: 1,
      xp:    0,
      keys:  { up: false, down: false, left: false, right: false },
    };
    socket.emit('welcome', {
      id:     socket.id,
      worldW: WORLD_W,
      worldH: WORLD_H,
      orbs:   Object.values(orbs),
    });
  });

  socket.on('keys', (keys) => {
    if (!players[socket.id]) return;
    players[socket.id].keys = {
      up:    !!keys.up,
      down:  !!keys.down,
      left:  !!keys.left,
      right: !!keys.right,
    };
  });

  // ── Chat ──
  socket.on('chat', (raw) => {
    const p = players[socket.id];
    if (!p) return;
    const text = String(raw).trim().slice(0, 80);
    if (!text) return;
    io.emit('chat', { id: p.id, name: p.name, text, ts: Date.now() });
  });

  socket.on('disconnect', () => {
    console.log('[-]', socket.id);
    delete players[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`◉ sphere.io → http://localhost:${PORT}`));