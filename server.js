const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');

function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
}
function saveAccounts(a) { fs.writeFileSync(DATA_FILE, JSON.stringify(a, null, 2)); }
function hashPw(pw) { return crypto.createHash('sha256').update(pw + 'sphereio_salt_2025').digest('hex'); }

const SHAPE_EVOLUTION = [
  { level: 1,  shape: 'circle',   name: '원형체',  color: '#4ecdc4' },
  { level: 5,  shape: 'triangle', name: '삼각체',  color: '#ff6b6b' },
  { level: 10, shape: 'square',   name: '사각체',  color: '#ffd93d' },
  { level: 18, shape: 'pentagon', name: '오각체',  color: '#c77dff' },
  { level: 28, shape: 'hexagon',  name: '육각체',  color: '#ff9f43' },
  { level: 40, shape: 'star',     name: '성형체',  color: '#00d4ff' },
];

const CLASS_UNLOCK = [
  { id: 'warrior', name: '전사',   shape: 'square',   color: '#ffd93d', condition: 'Lv.10 + 던전 3회 클리어', req: { level: 10, dungeonClears: 3 }, bonus: { maxHp: 50, def: 5 } },
  { id: 'mage',    name: '마법사', shape: 'pentagon', color: '#c77dff', condition: 'Lv.10 + 몬스터 50킬',    req: { level: 10, kills: 50 },          bonus: { maxMp: 50, atk: 8 } },
  { id: 'rogue',   name: '도적',   shape: 'triangle', color: '#ff6b6b', condition: 'Lv.10 + 선제공격 5회',   req: { level: 10, firstStrikes: 5 },     bonus: { atk: 5, def: 2 } },
];

const FIELD_MONSTERS_DEF = [
  { type: 'slime',  name: '슬라임',   shape: 'circle',   color: '#69db7c', hp: 40,  atk: 6,  def: 1, exp: 15, gold: 8  },
  { type: 'bat',    name: '박쥐',     shape: 'triangle', color: '#ff8787', hp: 30,  atk: 9,  def: 1, exp: 20, gold: 10 },
  { type: 'golem',  name: '골렘',     shape: 'square',   color: '#adb5bd', hp: 80,  atk: 12, def: 8, exp: 40, gold: 22 },
  { type: 'wisp',   name: '위습',     shape: 'pentagon', color: '#da77f2', hp: 50,  atk: 15, def: 2, exp: 35, gold: 18 },
];

const MAP_W = 2000, MAP_H = 1500;
const TOWN_X = 250, TOWN_Y = 750;
const DUNGEON_X = 1780, DUNGEON_Y = 750, DUNGEON_R = 70;

// 몬스터 AI 설정
const MONSTER_DETECT_RANGE = 200;  // 플레이어 감지 거리
const MONSTER_ATTACK_RANGE = 22;   // 접촉 공격 범위 (도형 반지름 수준)
const MONSTER_ATTACK_INTERVAL = 1200; // ms
const MONSTER_CHASE_SPEED = 1.5;
const MONSTER_WANDER_SPEED = 0.25; // 배회 속도 대폭 감소
const MONSTER_WANDER_RANGE = 130;

// 최대 몬스터 수
const MAX_MONSTERS = 20;
const MIN_MONSTERS = 10;

const onlinePlayers = {};
let fieldMonsters = [];
let mUid = 0;

// ── 몬스터 스폰 ──
function createMonster(x, y) {
  const def = FIELD_MONSTERS_DEF[Math.floor(Math.random() * FIELD_MONSTERS_DEF.length)];
  return {
    uid: ++mUid,
    ...JSON.parse(JSON.stringify(def)),
    maxHp: def.hp,
    x: x !== undefined ? x : 500 + Math.random() * 1200,
    y: y !== undefined ? y : 100 + Math.random() * 1300,
    alive: true,
    spawnX: x !== undefined ? x : 0,
    spawnY: y !== undefined ? y : 0,
    ai: {
      state: 'wander',      // 'wander' | 'chase'
      wanderPhase: 'idle',  // 'move' | 'idle' — 이동/대기 교번
      targetId: null,
      tx: 0, ty: 0,
      wanderTimer: 800 + Math.random() * 1200, // 첫 대기
      lastAttack: 0,
      aggroTimer: 0,
    },
  };
}

function spawnMonsters(count) {
  for (let i = 0; i < count; i++) {
    const x = 500 + Math.random() * 1200;
    const y = 100 + Math.random() * 1300;
    const m = createMonster(x, y);
    m.spawnX = x;
    m.spawnY = y;
    m.ai.tx = x;
    m.ai.ty = y;
    m.ai.wanderPhase = 'idle';
    m.ai.wanderTimer = 500 + Math.random() * 1500;
    fieldMonsters.push(m);
  }
}

spawnMonsters(MAX_MONSTERS);

// ── 몬스터 AI 서버 틱 ──
const AI_TICK = 50; // ms (20 fps)
let lastAiTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = now - lastAiTick;
  lastAiTick = now;

  const playerList = Object.values(onlinePlayers);

  // 살아있는 몬스터 처리
  const aliveMonsters = fieldMonsters.filter(m => m.alive);

  for (const m of aliveMonsters) {
    updateMonsterAI(m, playerList, dt, now);
  }

  // 죽은 몬스터 정리 + 리스폰
  fieldMonsters = fieldMonsters.filter(m => m.alive);
  const aliveCount = fieldMonsters.length;
  if (aliveCount < MIN_MONSTERS) {
    spawnMonsters(MAX_MONSTERS - aliveCount);
    // 새 몬스터 스폰 알림
    io.emit('monsters spawned', fieldMonsters.filter(m => m.alive).map(serializeMonster));
  }

  // 주기적으로 전체 상태 브로드캐스트 (500ms마다)
}, AI_TICK);

// 500ms마다 몬스터 위치 동기화
setInterval(() => {
  if (fieldMonsters.length === 0) return;
  io.emit('monster positions', fieldMonsters.filter(m => m.alive).map(m => ({
    uid: m.uid, x: m.x, y: m.y, hp: m.hp, state: m.ai.state
  })));
}, 100);

// 25초마다 전체 필드 상태 브로드캐스트
setInterval(() => {
  io.emit('field state', buildFieldState());
}, 25000);

function updateMonsterAI(m, players, dt, now) {
  const ai = m.ai;

  // 가장 가까운 플레이어 찾기
  let nearest = null;
  let nearestDist = Infinity;
  for (const p of players) {
    if (p.hp <= 0) continue;
    const d = Math.hypot(p.x - m.x, p.y - m.y);
    if (d < nearestDist) { nearestDist = d; nearest = p; }
  }

  // 상태 전환: 감지 범위 안에 플레이어 있으면 추격
  if (nearest && nearestDist < MONSTER_DETECT_RANGE) {
    ai.state = 'chase';
    ai.targetId = nearest.id;
    ai.aggroTimer = 3000;
  } else {
    ai.aggroTimer -= dt;
    if (ai.aggroTimer <= 0) {
      ai.state = 'wander';
      ai.targetId = null;
    }
  }

  if (ai.state === 'chase' && nearest) {
    const dx = nearest.x - m.x;
    const dy = nearest.y - m.y;
    const dist = Math.hypot(dx, dy);

    if (dist > MONSTER_ATTACK_RANGE) {
      // 플레이어에게 이동
      const spd = MONSTER_CHASE_SPEED * (dt / 16);
      m.x += (dx / dist) * spd;
      m.y += (dy / dist) * spd;
      m.x = Math.max(10, Math.min(MAP_W - 10, m.x));
      m.y = Math.max(10, Math.min(MAP_H - 10, m.y));
    } else {
      // 접촉 → 공격
      if (now - ai.lastAttack > MONSTER_ATTACK_INTERVAL) {
        ai.lastAttack = now;
        monsterAttackPlayer(m, nearest, now);
      }
    }
  } else {
    // ── 배회: move → idle(1초) → move → idle ... ──
    ai.wanderTimer -= dt;

    if (ai.wanderPhase === 'idle') {
      // 대기 중: 타이머 끝나면 새 목표 지점 설정 후 이동 시작
      if (ai.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * MONSTER_WANDER_RANGE;
        ai.tx = Math.max(50, Math.min(MAP_W - 50, m.spawnX + Math.cos(angle) * r));
        ai.ty = Math.max(50, Math.min(MAP_H - 50, m.spawnY + Math.sin(angle) * r));
        ai.wanderPhase = 'move';
        ai.wanderTimer = 0;
      }
      // 대기 중엔 이동 없음
    } else {
      // 이동 중: 목표 지점까지 천천히 이동
      const dx = ai.tx - m.x;
      const dy = ai.ty - m.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 6) {
        const spd = MONSTER_WANDER_SPEED * (dt / 16);
        m.x += (dx / dist) * spd;
        m.y += (dy / dist) * spd;
      } else {
        // 목표 도착 → idle 1초 대기
        m.x = ai.tx;
        m.y = ai.ty;
        ai.wanderPhase = 'idle';
        ai.wanderTimer = 800 + Math.random() * 600; // 0.8~1.4초 대기
      }
    }
  }
}

function monsterAttackPlayer(m, p, now) {
  if (!onlinePlayers[p.id]) return;
  const dmg = Math.max(1, m.atk - p.def + Math.floor(Math.random() * 4));
  p.hp = Math.max(0, p.hp - dmg);

  // 소켓으로 데미지 전달
  const socket = io.sockets.sockets.get(p.id);
  if (socket) {
    socket.emit('monster attack', {
      monsterUid: m.uid,
      monsterName: m.name,
      dmg,
      playerHp: p.hp,
      playerMaxHp: p.maxHp,
    });
  }

  if (p.hp <= 0) {
    handleDeath(socket, p);
  }
  persist(p);
}

function serializeMonster(m) {
  return {
    uid: m.uid, name: m.name, shape: m.shape, color: m.color,
    x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, alive: m.alive,
    state: m.ai ? m.ai.state : 'wander',
  };
}

function expForLevel(lv) { return lv * 100 + (lv - 1) * 50; }

function getEvo(level) {
  let e = SHAPE_EVOLUTION[0];
  for (const ev of SHAPE_EVOLUTION) { if (level >= ev.level) e = ev; else break; }
  return e;
}

function buildFieldState() {
  return {
    monsters: fieldMonsters.filter(m => m.alive).map(serializeMonster),
    players: Object.values(onlinePlayers).map(p => ({
      id: p.id, nickname: p.nickname, shape: p.shape, color: p.color,
      x: p.x, y: p.y, level: p.level, hp: p.hp, maxHp: p.maxHp, className: p.className || null
    }))
  };
}

io.on('connection', (socket) => {

  socket.on('register', ({ nickname, password }) => {
    if (!nickname || nickname.length < 2 || nickname.length > 12) { socket.emit('auth error', '닉네임은 2~12자여야 합니다.'); return; }
    if (!password || password.length < 4) { socket.emit('auth error', '비밀번호는 4자 이상이어야 합니다.'); return; }
    const accounts = loadAccounts();
    if (accounts[nickname]) { socket.emit('auth error', '이미 존재하는 닉네임입니다.'); return; }
    const acc = {
      nickname, passwordHash: hashPw(password),
      level: 1, exp: 0, gold: 0, kills: 0, dungeonClears: 0, firstStrikes: 0,
      maxHp: 100, maxMp: 100, atk: 8, def: 4,
      shape: 'circle', color: '#4ecdc4', className: null,
      x: TOWN_X, y: TOWN_Y, createdAt: Date.now()
    };
    accounts[nickname] = acc;
    saveAccounts(accounts);
    doLogin(socket, acc);
  });

  socket.on('login', ({ nickname, password }) => {
    const accounts = loadAccounts();
    const acc = accounts[nickname];
    if (!acc) { socket.emit('auth error', '존재하지 않는 닉네임입니다.'); return; }
    if (acc.passwordHash !== hashPw(password)) { socket.emit('auth error', '비밀번호가 틀렸습니다.'); return; }
    if (Object.values(onlinePlayers).find(p => p.nickname === nickname)) { socket.emit('auth error', '이미 접속 중인 계정입니다.'); return; }
    doLogin(socket, acc);
  });

  function doLogin(socket, acc) {
    const evo = getEvo(acc.level);
    const p = {
      ...acc, id: socket.id,
      hp: acc.maxHp, mp: acc.maxMp,
      shape: acc.className ? acc.shape : evo.shape,
      color: acc.className ? acc.color : evo.color,
    };
    onlinePlayers[socket.id] = p;
    socket.emit('login success', sanitize(p));
    socket.emit('field state', buildFieldState());
    io.emit('player joined', { id: p.id, nickname: p.nickname, shape: p.shape, color: p.color, x: p.x, y: p.y, level: p.level, hp: p.hp, maxHp: p.maxHp, className: p.className });
    io.emit('system message', `${p.nickname} (Lv.${p.level})이 접속했습니다.`);
  }

  socket.on('move', ({ x, y }) => {
    const p = onlinePlayers[socket.id];
    if (!p) return;
    p.x = Math.max(10, Math.min(MAP_W - 10, x));
    p.y = Math.max(10, Math.min(MAP_H - 10, y));
    socket.broadcast.emit('player moved', { id: socket.id, x: p.x, y: p.y });
  });

  // 플레이어 → 몬스터 공격 (클라이언트가 근접 시 자동 트리거)
  socket.on('attack monster', ({ uid, action }) => {
    const p = onlinePlayers[socket.id];
    if (!p || p.hp <= 0) return;
    const m = fieldMonsters.find(m => m.uid === uid && m.alive);
    if (!m) return;
    const dist = Math.hypot(p.x - m.x, p.y - m.y);
    if (dist > 130) { socket.emit('system message', '[경고] 너무 멀어요! 가까이 가세요.'); return; }

    let dmg, skillName = '';
    if (action === 'skill') {
      if (p.mp < 30) { socket.emit('system message', '[오류] MP가 부족합니다.'); return; }
      p.mp -= 30;
      dmg = Math.max(1, Math.floor(p.atk * 2.2 - m.def + Math.random() * 8));
      skillName = p.className === '마법사' ? '마법진 폭발' : p.className === '도적' ? '급소 공격' : '강력한 일격';
    } else {
      dmg = Math.max(1, p.atk - m.def + Math.floor(Math.random() * 5));
    }

    m.hp -= dmg;

    io.emit('combat result', {
      attackerId: socket.id, attackerNickname: p.nickname,
      monsterUid: uid, dmg,
      counterDmg: 0, // 몬스터 반격은 AI 틱에서 별도 처리
      monsterHp: Math.max(0, m.hp), monsterMaxHp: m.maxHp,
      playerHp: p.hp, playerMaxHp: p.maxHp,
      playerMp: p.mp, playerMaxMp: p.maxMp,
      action, skillName,
    });

    if (m.hp <= 0) {
      m.alive = false;
      p.kills++;
      p.exp += m.exp;
      p.gold += m.gold;
      io.emit('monster killed', { uid, killerNickname: p.nickname, exp: m.exp, gold: m.gold });
      checkLevelUp(socket, p);
      checkClassUnlock(socket, p);
    }
    persist(p);
  });

  socket.on('heal', () => {
    const p = onlinePlayers[socket.id];
    if (!p) return;
    if (p.mp < 20) { socket.emit('system message', '[오류] MP 부족 (20 필요)'); return; }
    const amt = Math.floor(p.maxHp * 0.25);
    p.hp = Math.min(p.maxHp, p.hp + amt);
    p.mp -= 20;
    socket.emit('healed', { hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, amt });
    persist(p);
  });

  socket.on('choose class', (classId) => {
    const p = onlinePlayers[socket.id];
    if (!p || p.className) return;
    const cls = CLASS_UNLOCK.find(c => c.id === classId);
    if (!cls) return;
    const r = cls.req;
    if (p.level < r.level) { socket.emit('system message', '레벨이 부족합니다.'); return; }
    if (r.dungeonClears && p.dungeonClears < r.dungeonClears) { socket.emit('system message', '던전 클리어 횟수가 부족합니다.'); return; }
    if (r.kills && p.kills < r.kills) { socket.emit('system message', '처치 수가 부족합니다.'); return; }
    if (r.firstStrikes && p.firstStrikes < r.firstStrikes) { socket.emit('system message', '선제공격 횟수가 부족합니다.'); return; }
    p.className = cls.name;
    p.color = cls.color;
    p.shape = cls.shape;
    if (cls.bonus.maxHp) { p.maxHp += cls.bonus.maxHp; p.hp += cls.bonus.maxHp; }
    if (cls.bonus.maxMp) { p.maxMp += cls.bonus.maxMp; }
    if (cls.bonus.atk) p.atk += cls.bonus.atk;
    if (cls.bonus.def) p.def += cls.bonus.def;
    socket.emit('class chosen', sanitize(p));
    io.emit('system message', `[각성] ${p.nickname}이(가) ${cls.name} 직업을 얻었습니다.`);
    io.emit('player shape update', { id: socket.id, shape: p.shape, color: p.color });
    persist(p);
  });

  socket.on('chat message', ({ message }) => {
    const p = onlinePlayers[socket.id];
    if (!p || !message.trim()) return;
    io.emit('chat message', {
      nickname: p.nickname, message: message.trim().slice(0, 100),
      color: p.color, id: socket.id,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('disconnect', () => {
    const p = onlinePlayers[socket.id];
    if (p) {
      persist(p);
      io.emit('player left', socket.id);
      io.emit('system message', `${p.nickname}이(가) 접속을 끊었습니다.`);
      delete onlinePlayers[socket.id];
    }
  });

  function checkLevelUp(socket, p) {
    while (p.exp >= expForLevel(p.level)) {
      p.exp -= expForLevel(p.level);
      p.level++;
      p.maxHp += 15; p.hp = p.maxHp;
      p.atk += 2; p.def += 1;
      const evo = getEvo(p.level);
      let evolved = false;
      if (!p.className) {
        const prev = p.shape;
        p.shape = evo.shape; p.color = evo.color;
        evolved = p.shape !== prev;
      }
      socket.emit('level up', { level: p.level, exp: p.exp, maxHp: p.maxHp, hp: p.hp, atk: p.atk, def: p.def, shape: p.shape, color: p.color, evolved, evolvedName: evo.name });
      io.emit('system message', `[레벨업] ${p.nickname} → Lv.${p.level}${evolved ? ` / ${evo.name}으로 진화` : ''}`);
      io.emit('player shape update', { id: socket.id, shape: p.shape, color: p.color, level: p.level });
    }
  }

  function checkClassUnlock(socket, p) {
    if (p.className) return;
    const unlockable = CLASS_UNLOCK.filter(c => {
      const r = c.req;
      return p.level >= r.level
        && (!r.dungeonClears || p.dungeonClears >= r.dungeonClears)
        && (!r.kills || p.kills >= r.kills)
        && (!r.firstStrikes || p.firstStrikes >= r.firstStrikes);
    });
    if (unlockable.length > 0) socket.emit('class unlock available', unlockable.map(c => ({ id: c.id, name: c.name, condition: c.condition, shape: c.shape, color: c.color })));
  }
});

function handleDeath(socket, p) {
  if (!socket) return;
  io.emit('system message', `[전사] ${p.nickname}이(가) 쓰러졌습니다.`);
  p.gold = Math.floor(p.gold * 0.9);
  setTimeout(() => {
    if (!onlinePlayers[socket.id]) return;
    p.hp = Math.floor(p.maxHp * 0.3);
    p.x = TOWN_X + (Math.random() - 0.5) * 80;
    p.y = TOWN_Y + (Math.random() - 0.5) * 80;
    socket.emit('revive', { hp: p.hp, x: p.x, y: p.y, gold: p.gold });
    io.emit('system message', `${p.nickname}이(가) 마을에서 부활했습니다.`);
  }, 4000);
}

function sanitize(p) {
  return { nickname: p.nickname, level: p.level, exp: p.exp, gold: p.gold, kills: p.kills, dungeonClears: p.dungeonClears, firstStrikes: p.firstStrikes, hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, atk: p.atk, def: p.def, shape: p.shape, color: p.color, className: p.className, x: p.x, y: p.y };
}

function persist(p) {
  const accounts = loadAccounts();
  if (!accounts[p.nickname]) return;
  Object.assign(accounts[p.nickname], { level: p.level, exp: p.exp, gold: p.gold, kills: p.kills, dungeonClears: p.dungeonClears, firstStrikes: p.firstStrikes, maxHp: p.maxHp, maxMp: p.maxMp, atk: p.atk, def: p.def, shape: p.shape, color: p.color, className: p.className, x: p.x, y: p.y });
  saveAccounts(accounts);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`sphere.io running: http://localhost:${PORT}`));