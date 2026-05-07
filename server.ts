import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import { BiscaEngine } from './src/lib/engine';
import { Card, GameState, RoomStatus, User, Suit, ChatMessage } from './src/lib/types';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// DATABASE_URL deve ser definida como variável de ambiente no Render
// Formato Neon: postgresql://user:pass@host/db?sslmode=require
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

console.log('Connecting to PostgreSQL (Neon)...');
const pool = new Pool({ connectionString: DATABASE_URL });

// ── Inicialização do banco (schema + admin) ──────────────────────────────────

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'USER',
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      score_goal  INTEGER NOT NULL DEFAULT 5,
      time_limit  INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'WAITING',
      created_at  BIGINT NOT NULL
    );
  `);

  console.log('Cleaning up orphaned rooms...');
  await pool.query("DELETE FROM rooms WHERE status != 'FINISHED'");

  // Admin padrão — senha via ADMIN_PASSWORD env var (padrão: admin123)
  const adminId = 'admin-uuid';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const { rows: adminRows } = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
  if (adminRows.length === 0) {
    console.log('Creating default admin user...');
    const hash = bcrypt.hashSync(adminPassword, 10);
    await pool.query(
      'INSERT INTO users (id, username, password_hash, nickname, role, is_active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [adminId, 'admin', hash, 'Administrador', 'ADMIN', 1, Date.now()]
    );
    console.log('Admin user created.');
  } else {
    await pool.query("UPDATE users SET role = 'ADMIN', is_active = 1 WHERE username = 'admin'");
    console.log('Admin user already exists.');
  }
};

// ── Express / Socket.IO setup ────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true, credentials: true } });

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'bisca-secret-key-dev-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: IS_PRODUCTION ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

const userSockets: Record<string, string> = {};

// ── Estado em memória ────────────────────────────────────────────────────────

const activeGames: Record<string, {
  gameState: GameState;
  config: { scoreGoal: number; timeLimit: number; allowSpectators: boolean; spectatorsSeeHands: boolean };
  slots: (string | null)[];
  ownerId: string;
  nicknames: Record<string, string>;
  teams: Record<string, 1 | 2>;
  reconnectionTimers: Record<string, NodeJS.Timeout>;
  swapRequests: Record<string, { from: string, to: string, expires: number }>;
  lastCutterIdx: number;
  chat: ChatMessage[];
  sevenTrumpPlayed: boolean;
  spectators: { userId: string; nickname: string }[];
  kickVote: { targetId: string; targetNickname: string; initiatorId: string; votes: string[]; timer: NodeJS.Timeout } | null;
  lastRoundShareDone: boolean;
}> = {};

// ── Helper: limpar sala vazia ────────────────────────────────────────────────

const cleanupRoom = async (roomId: string, io: Server) => {
  const game = activeGames[roomId];
  if (!game) return;

  if (game.slots.every(s => s === null)) {
    console.log(`Closing empty room: ${roomId}`);
    delete activeGames[roomId];
    try { await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]); } catch {}
    io.emit('rooms_updated');
  } else {
    if (!game.slots.includes(game.ownerId)) {
      const nextOwner = game.slots.find(s => s !== null);
      if (nextOwner) game.ownerId = nextOwner;
    }
    io.to(roomId).emit('room_update', {
      slots: game.slots, nicknames: game.nicknames,
      teams: game.teams, ownerId: game.ownerId, spectators: game.spectators
    });
  }
};

// ── API Routes ───────────────────────────────────────────────────────────────

// Auth
app.post('/api/login', async (req: any, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (!user.is_active) return res.status(403).json({ error: 'Conta inativa. Entre em contato com o administrador.' });

    if (bcrypt.compareSync(password, user.password_hash)) {
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      res.json({ message: 'Login realizado com sucesso', user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } });
    } else {
      res.status(401).json({ error: 'Senha incorreta' });
    }
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/me', async (req: any, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Não logado' });
  try {
    const { rows } = await pool.query('SELECT id, username, nickname, role, is_active FROM users WHERE id = $1', [req.session.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/logout', (req: any, res) => {
  req.session.destroy((err: any) => {
    if (err) return res.status(500).json({ error: 'Erro ao fazer logout' });
    res.json({ message: 'Logout realizado' });
  });
});

// Admin
app.get('/api/admin/users', async (req: any, res) => {
  if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' });
  try {
    const { rows } = await pool.query('SELECT id, username, nickname, role, is_active, created_at FROM users ORDER BY created_at ASC');
    res.json(rows || []);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
});

app.post('/api/admin/users/toggle', async (req: any, res) => {
  if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' });
  const { userId, active } = req.body;
  try {
    await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [active ? 1 : 0, userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

app.post('/api/admin/users/create', async (req: any, res) => {
  if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' });
  const { username, nickname, password } = req.body;
  if (!username || !nickname || !password) return res.status(400).json({ error: 'Campos obrigatórios ausentes' });

  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (rows[0]) return res.status(400).json({ error: 'Usuário já existe' });

    const id = uuidv4();
    const hash = bcrypt.hashSync(password, 10);
    await pool.query(
      'INSERT INTO users (id, username, password_hash, nickname, role, is_active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, username, hash, nickname, 'USER', 1, Date.now()]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.post('/api/admin/users/promote', async (req: any, res) => {
  if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' });
  const { userId, role } = req.body;
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao atualizar nível' });
  }
});

app.post('/api/admin/users/reset-password', async (req: any, res) => {
  if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' });
  const { userId, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Senha curta demais' });
  try {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(newPassword, 10), userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

app.post('/api/admin/users/delete', async (req: any, res) => {
  if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' });
  const { userId } = req.body;
  if (userId === 'admin-uuid') return res.status(400).json({ error: 'Não é possível excluir o administrador padrão.' });
  if (userId === req.session.userId) return res.status(400).json({ error: 'Você não pode se excluir.' });
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao excluir usuário' });
  }
});

app.post('/api/me/change-password', async (req: any, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Não logado' });
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Nova senha curta demais' });
  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!bcrypt.compareSync(currentPassword, rows[0].password_hash)) return res.status(400).json({ error: 'Senha atual incorreta' });
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(newPassword, 10), req.session.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
});

app.post('/api/me/update-nickname', async (req: any, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Não logado' });
  const { nickname } = req.body;
  if (!nickname || nickname.length < 2) return res.status(400).json({ error: 'Apelido inválido' });
  try {
    await pool.query('UPDATE users SET nickname = $1 WHERE id = $2', [nickname, req.session.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao atualizar apelido' });
  }
});

// Admin Rooms
app.get('/api/admin/rooms/active', async (req: any, res) => {
  if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' });
  try {
    const { rows } = await pool.query('SELECT * FROM rooms');
    const rooms = rows.map(r => ({
      ...r,
      playerCount: (activeGames[r.id] && activeGames[r.id].slots.filter(s => s !== null).length) || 0,
      active: !!activeGames[r.id]
    }));
    res.json(rooms);
  } catch (e) {
    res.status(500).json([]);
  }
});

app.post('/api/admin/rooms/close', async (req: any, res) => {
  if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' });
  const { roomId } = req.body;
  const game = activeGames[roomId];
  if (game) {
    io.to(roomId).emit('game_aborted', { reason: 'Esta sala foi encerrada por um administrador do Quartel General.' });
    delete activeGames[roomId];
  }
  try {
    await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
    io.emit('rooms_updated');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao fechar sala' });
  }
});

// Rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM rooms WHERE status != 'FINISHED'");
    const roomsWithCount = rows.map(r => ({
      ...r,
      playerCount: (activeGames[r.id] && activeGames[r.id].slots.filter(s => s !== null).length) || 0,
      spectatorCount: (activeGames[r.id] && activeGames[r.id].spectators.length) || 0,
      allowSpectators: activeGames[r.id]?.config?.allowSpectators ?? true
    }));
    res.json(roomsWithCount);
  } catch (e) {
    res.status(500).json([]);
  }
});

app.post('/api/rooms/create', async (req: any, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Não logado' });
  const { name, scoreGoal, timeLimit, allowSpectators, spectatorsSeeHands } = req.body;
  const roomId = uuidv4();
  try {
    await pool.query(
      'INSERT INTO rooms (id, name, owner_id, score_goal, time_limit, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [roomId, name, req.session.userId, scoreGoal, timeLimit, Date.now()]
    );
    activeGames[roomId] = {
      gameState: null as any,
      config: {
        scoreGoal: parseInt(scoreGoal),
        timeLimit: parseInt(timeLimit) || 0,
        allowSpectators: allowSpectators !== false,
        spectatorsSeeHands: !!spectatorsSeeHands
      },
      slots: [null, null, null, null],
      ownerId: req.session.userId,
      nicknames: {},
      teams: {},
      reconnectionTimers: {},
      swapRequests: {},
      lastCutterIdx: -1,
      chat: [],
      sevenTrumpPlayed: false,
      spectators: [],
      kickVote: null,
      lastRoundShareDone: false
    };
    res.json({ roomId });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao criar sala' });
  }
});

// ── Socket Handlers ──────────────────────────────────────────────────────────

io.on('connection', (socket: any) => {
  const session = socket.request.session;
  if (!session || !session.userId) return;

  const userId = session.userId;

  socket.on('join_room', async (roomId: string) => {
    if (!activeGames[roomId]) { socket.emit('error', 'Sala não encontrada'); return; }

    const game = activeGames[roomId];
    socket.join(roomId);
    userSockets[userId] = socket.id;

    const slotIdx = game.slots.indexOf(userId);
    const alreadySpectator = game.spectators.some(s => s.userId === userId);

    if (slotIdx !== -1) {
      if (game.reconnectionTimers[userId]) {
        clearTimeout(game.reconnectionTimers[userId]);
        delete game.reconnectionTimers[userId];
        io.to(roomId).emit('player_reconnected');
        io.to(roomId).emit('system_message', `${game.nicknames[userId]} reconectou.`);
      }
    } else if (!alreadySpectator) {
      const emptySlot = game.slots.indexOf(null);
      try {
        const { rows } = await pool.query('SELECT nickname FROM users WHERE id = $1', [userId]);
        if (!rows[0]) return;
        game.nicknames[userId] = rows[0].nickname;
        if (emptySlot !== -1) {
          game.slots[emptySlot] = userId;
          game.teams[userId] = (emptySlot % 2 === 0) ? 1 : 2;
          io.to(roomId).emit('room_update', {
            slots: game.slots, nicknames: game.nicknames,
            teams: game.teams, ownerId: game.ownerId, spectators: game.spectators
          });
        } else if (game.config.allowSpectators) {
          game.spectators.push({ userId, nickname: rows[0].nickname });
          io.to(roomId).emit('queue_updated', { spectators: game.spectators });
          io.to(roomId).emit('system_message', `${rows[0].nickname} entrou na fila (#${game.spectators.length}).`);
        } else {
          socket.emit('error', 'Esta sala não permite espectadores.');
          socket.leave(roomId);
          return;
        }
      } catch (e) { return; }
    }

    const isUserSpectator = game.spectators.some(s => s.userId === userId);
    const userChannel = isUserSpectator ? 'spectators' : 'players';
    const filteredChat = game.chat.filter(m => m.channel === userChannel);

    socket.emit('init_sync', {
      gameState: game.gameState, config: game.config,
      slots: game.slots, nicknames: game.nicknames, teams: game.teams,
      ownerId: game.ownerId, chat: filteredChat, spectators: game.spectators, userId
    });
  });

  socket.on('start_game', async (roomId: string) => {
    const game = activeGames[roomId];
    if (!game) return;
    if (game.ownerId !== userId) return socket.emit('error', 'Apenas o chefe da sala pode iniciar a partida.');
    if (game.slots.filter(s => s !== null).length !== 4) return socket.emit('error', 'Necessário 4 jogadores para iniciar.');

    const userIds = game.slots as string[];
    const posMap: Record<string, number> = {};
    const teamMap: Record<string, 1 | 2> = {};
    userIds.forEach((id, idx) => { posMap[id] = idx; teamMap[id] = (idx % 2 === 0) ? 1 : 2; });

    game.gameState = BiscaEngine.initGame(userIds, posMap, teamMap);
    game.gameState.status = 'SHUFFLING';
    game.gameState.lastVazaWinner = null;
    game.sevenTrumpPlayed = false;

    io.to(roomId).emit('game_update', game.gameState);
    try { await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['IN_GAME', roomId]); } catch {}

    setTimeout(() => {
      if (!activeGames[roomId] || !activeGames[roomId].gameState) return;
      const g = activeGames[roomId];

      g.lastCutterIdx = (g.lastCutterIdx + 1) % 4;
      if (g.lastCutterIdx === -1) g.lastCutterIdx = 3;

      const cutterId = g.slots[g.lastCutterIdx]!;
      g.gameState.cutterId = cutterId;
      g.gameState.status = 'CUTTING';

      const cuttingCards = [];
      const tempDeck = [...g.gameState.deck];
      for (let i = 0; i < 5; i++) cuttingCards.push(tempDeck.pop()!);
      g.gameState.cuttingCards = cuttingCards;
      g.gameState.deck = tempDeck;

      io.to(roomId).emit('game_update', g.gameState);
      io.to(roomId).emit('system_message', `${g.nicknames[cutterId]} está cortando o baralho.`);
    }, 2000);
  });

  socket.on('select_corte', async ({ roomId, cardId, isBater }: { roomId: string, cardId?: string, isBater?: boolean }) => {
    const game = activeGames[roomId];
    if (!game || !game.gameState || game.gameState.status !== 'CUTTING') return;
    if (game.gameState.cutterId !== userId) return;

    const state = game.gameState;

    if (isBater) {
      state.isCopas = true;
      state.trumpSuit = 'Copas';
      state.cuttingCards = [];
      io.to(roomId).emit('system_message', `${game.nicknames[userId]} BATEU EM COPAS!`);
    } else {
      const card = state.cuttingCards.find(c => c.id === cardId);
      if (!card) return;
      state.trumpSuit = card.suit;
      const isBisca = card.value === 'A' || card.value === '7';
      if (isBisca) {
        state.trumpSuit = BiscaEngine.getSuitInversion(card.suit);
        state.visibleCorte = null;
      } else {
        state.visibleCorte = card;
      }
      io.to(roomId).emit('game_update', state);
    }

    setTimeout(() => {
      if (!activeGames[roomId] || !activeGames[roomId].gameState) return;
      const g = activeGames[roomId];
      const s = g.gameState;

      if (!s.isCopas) {
        const isBiscaMode = !s.visibleCorte;
        s.deck.push(...s.cuttingCards.filter(c => isBiscaMode || c.id !== cardId));
        s.cuttingCards = [];
        s.deck = BiscaEngine.shuffle(s.deck);
        if (s.visibleCorte) {
          const idx = s.deck.findIndex(c => c.id === s.visibleCorte!.id);
          if (idx !== -1) s.deck.splice(idx, 1);
          s.deck.unshift(s.visibleCorte);
        }
      } else {
        s.deck.push(...s.cuttingCards);
        s.cuttingCards = [];
        s.deck = BiscaEngine.shuffle(s.deck);
      }

      s.status = 'SHUFFLING';
      io.to(roomId).emit('game_update', s);

      setTimeout(() => {
        if (!activeGames[roomId] || !activeGames[roomId].gameState) return;
        const g2 = activeGames[roomId];
        const s2 = g2.gameState;
        s2.status = 'DEALING';
        io.to(roomId).emit('game_update', s2);

        const cutterIdx = g2.slots.indexOf(s2.cutterId!);
        const startIdx = (cutterIdx + 1) % 4;

        let dealStep = 0;
        const dealInterval = setInterval(() => {
          if (!activeGames[roomId] || !activeGames[roomId].gameState) { clearInterval(dealInterval); return; }
          const currState = activeGames[roomId].gameState;
          const targetIdx = (startIdx + dealStep) % 4;
          const targetUserId = g2.slots[targetIdx]!;

          const card = currState.deck.pop()!;
          currState.players[targetUserId].hand.push(card);
          currState.lastDealtUserId = targetUserId;
          io.to(roomId).emit('game_update', currState);

          dealStep++;
          if (dealStep === 12) {
            clearInterval(dealInterval);
            currState.status = 'IN_GAME';
            currState.lastDealtUserId = null;
            currState.currentTurn = g2.slots[startIdx]!;
            io.to(roomId).emit('game_update', currState);
            io.to(roomId).emit('system_message', `Cartas dadas! Começa ${g2.nicknames[currState.currentTurn]}.`);
            if (currState.visibleCorte && !currState.isCopas && !currState.corteSwapDone) {
              const corteSuit = currState.visibleCorte.suit;
              for (const pid of g2.slots) {
                if (!pid) continue;
                const twoCard = currState.players[pid].hand.find(c => c.value === '2' && c.suit === corteSuit);
                if (twoCard) {
                  const sid = userSockets[pid];
                  if (sid) io.to(sid).emit('trump_two_available', { corteCard: currState.visibleCorte, twoCard });
                  break;
                }
              }
            }
          }
        }, 600);
      }, 400);
    }, isBater ? 0 : 800);
  });

  const triggerNextHand = (roomId: string) => {
    const game = activeGames[roomId];
    if (!game || !game.gameState) return;

    const state = game.gameState;
    state.deck = BiscaEngine.shuffle(BiscaEngine.createDeck());
    state.vaza = [];
    state.isCopas = false;
    state.visibleCorte = null;
    state.roundCount = 0;
    state.corteSwapDone = false;
    state.heleyOccurred = false;
    state.status = 'SHUFFLING';
    game.sevenTrumpPlayed = false;
    game.lastRoundShareDone = false;

    for (const pid in state.players) {
      state.players[pid].hand = [];
      state.players[pid].vazaPoints = 0;
    }

    io.to(roomId).emit('game_update', state);

    setTimeout(() => {
      if (!activeGames[roomId]) return;
      game.lastCutterIdx = (game.lastCutterIdx + 1) % 4;
      const cutterId = game.slots[game.lastCutterIdx]!;
      game.gameState.cutterId = cutterId;
      game.gameState.status = 'CUTTING';

      const cuttingCards = [];
      for (let i = 0; i < 5; i++) cuttingCards.push(game.gameState.deck.pop()!);
      game.gameState.cuttingCards = cuttingCards;

      io.to(roomId).emit('game_update', game.gameState);
      io.to(roomId).emit('system_message', `${game.nicknames[cutterId]} está cortando o baralho.`);
    }, 2000);
  };

  const doQueueSwap = async (roomId: string, losingTeam: 1 | 2) => {
    const game = activeGames[roomId];
    if (!game) return;

    const losingSlots = game.slots
      .map((uid, idx) => ({ uid, idx }))
      .filter(s => s.uid && game.teams[s.uid!] === losingTeam) as { uid: string; idx: number }[];

    const specs = game.spectators;

    const finalize = async () => {
      game.gameState = null as any;
      try { await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['WAITING', roomId]); } catch {}
      io.to(roomId).emit('game_reset');
      io.to(roomId).emit('room_update', {
        slots: game.slots, nicknames: game.nicknames,
        teams: game.teams, ownerId: game.ownerId, spectators: game.spectators
      });
      io.to(roomId).emit('queue_updated', { spectators: game.spectators });
    };

    if (specs.length === 0) {
      setTimeout(finalize, 5000);
      return;
    }

    if (specs.length === 1) {
      setTimeout(() => {
        io.to(roomId).emit('spectator_choose_replacement', {
          spectatorId: specs[0].userId, spectatorNickname: specs[0].nickname,
          losingTeam,
          candidates: losingSlots.map(s => ({ userId: s.uid, nickname: game.nicknames[s.uid] }))
        });
      }, 4000);
      return;
    }

    // 2+ espectadores: dupla inteira sai
    setTimeout(async () => {
      const incoming = specs.splice(0, 2);
      for (let i = 0; i < losingSlots.length; i++) {
        const lp = losingSlots[i];
        const inc = incoming[i];
        if (!inc) break;
        const removedNick = game.nicknames[lp.uid];
        game.slots[lp.idx] = inc.userId;
        game.teams[inc.userId] = (lp.idx % 2 === 0) ? 1 : 2;
        game.nicknames[inc.userId] = inc.nickname;
        specs.push({ userId: lp.uid, nickname: removedNick });
        delete game.teams[lp.uid];
      }
      const outNames = losingSlots.map(s => game.nicknames[s.uid] || '').join(' e ');
      const inNames = incoming.map(i => i.nickname).join(' e ');
      await finalize();
      io.to(roomId).emit('system_message', `${outNames} saíram. ${inNames} entram no jogo!`);
    }, 4000);
  };

  socket.on('spectator_remove_player', async ({ roomId, removeUserId }: { roomId: string; removeUserId: string }) => {
    const game = activeGames[roomId];
    if (!game) return;
    if (game.spectators.length === 0 || game.spectators[0].userId !== userId) return;

    const removeIdx = game.slots.indexOf(removeUserId);
    if (removeIdx === -1) return;

    const spec = game.spectators.splice(0, 1)[0];
    const removedNick = game.nicknames[removeUserId];

    game.slots[removeIdx] = spec.userId;
    game.teams[spec.userId] = (removeIdx % 2 === 0) ? 1 : 2;
    game.nicknames[spec.userId] = spec.nickname;
    game.spectators.push({ userId: removeUserId, nickname: removedNick });
    delete game.teams[removeUserId];

    game.gameState = null as any;
    try { await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['WAITING', roomId]); } catch {}
    io.to(roomId).emit('game_reset');
    io.to(roomId).emit('room_update', {
      slots: game.slots, nicknames: game.nicknames,
      teams: game.teams, ownerId: game.ownerId, spectators: game.spectators
    });
    io.to(roomId).emit('queue_updated', { spectators: game.spectators });
    io.to(roomId).emit('system_message', `${spec.nickname} entrou no lugar de ${removedNick}.`);
  });

  socket.on('initiate_kick', ({ roomId, targetId }: { roomId: string; targetId: string }) => {
    const game = activeGames[roomId];
    if (!game) return;
    if (!game.slots.includes(userId)) return;
    if (game.kickVote) { socket.emit('error', 'Já há uma votação em andamento.'); return; }

    const targetInSlot = game.slots.includes(targetId);
    const targetIsSpec = game.spectators.some(s => s.userId === targetId);
    if (!targetInSlot && !targetIsSpec) return;

    const targetNickname = game.nicknames[targetId] || '?';
    const initiatorNickname = game.nicknames[userId] || '?';

    const timer = setTimeout(() => {
      if (activeGames[roomId]?.kickVote?.targetId === targetId) {
        activeGames[roomId].kickVote = null;
        io.to(roomId).emit('kick_vote_result', { passed: false, targetNickname, reason: 'tempo' });
      }
    }, 30000);

    game.kickVote = { targetId, targetNickname, initiatorId: userId, votes: [userId], timer };
    io.to(roomId).emit('kick_vote_started', { targetId, targetNickname, initiatorId: userId, initiatorNickname, votes: [userId] });
  });

  socket.on('cast_kick_vote', async ({ roomId, approve }: { roomId: string; approve: boolean }) => {
    const game = activeGames[roomId];
    if (!game || !game.kickVote) return;
    if (!game.slots.includes(userId)) return;

    const vote = game.kickVote;
    if (vote.votes.includes(userId)) return;

    if (!approve) {
      clearTimeout(vote.timer);
      game.kickVote = null;
      io.to(roomId).emit('kick_vote_result', { passed: false, targetNickname: vote.targetNickname, reason: 'negado' });
      return;
    }

    vote.votes.push(userId);
    io.to(roomId).emit('kick_vote_update', { votes: vote.votes });

    const tablePlayers = game.slots.filter(Boolean) as string[];
    if (vote.votes.length >= tablePlayers.length) {
      clearTimeout(vote.timer);
      const { targetId, targetNickname } = vote;
      game.kickVote = null;

      const slotIdx = game.slots.indexOf(targetId);
      if (slotIdx !== -1) {
        game.slots[slotIdx] = null;
        delete game.teams[targetId];
        if (game.gameState && !['WAITING', 'FINISHED'].includes(game.gameState.status)) {
          game.gameState = null as any;
          try { await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['WAITING', roomId]); } catch {}
          io.to(roomId).emit('game_aborted', { reason: `${targetNickname} foi removido por votação.` });
        }
      } else {
        const specIdx = game.spectators.findIndex(s => s.userId === targetId);
        if (specIdx !== -1) game.spectators.splice(specIdx, 1);
      }

      const kickedSid = userSockets[targetId];
      if (kickedSid) {
        io.to(kickedSid).emit('kicked_from_room');
        const kickedSocket = io.sockets.sockets.get(kickedSid);
        if (kickedSocket) kickedSocket.leave(roomId);
      }

      io.to(roomId).emit('kick_vote_result', { passed: true, targetId, targetNickname });
      io.to(roomId).emit('room_update', {
        slots: game.slots, nicknames: game.nicknames,
        teams: game.teams, ownerId: game.ownerId, spectators: game.spectators
      });
      io.to(roomId).emit('queue_updated', { spectators: game.spectators });
    }
  });

  socket.on('request_swap', ({ roomId, toIdx }: { roomId: string, toIdx: number }) => {
    const game = activeGames[roomId];
    if (!game || game.gameState) return;
    const fromIdx = game.slots.indexOf(userId);
    const targetUserId = game.slots[toIdx];

    if (!targetUserId) {
      game.slots[fromIdx] = null;
      game.slots[toIdx] = userId;
      game.teams[userId] = (toIdx % 2 === 0) ? 1 : 2;
      io.to(roomId).emit('room_update', { slots: game.slots, nicknames: game.nicknames, teams: game.teams, ownerId: game.ownerId, spectators: game.spectators });
    } else {
      io.to(roomId).emit('swap_request_received', { from: userId, fromNickname: game.nicknames[userId], toIdx, toUserId: targetUserId });
    }
  });

  socket.on('accept_swap', ({ roomId, fromUserId }: { roomId: string, fromUserId: string }) => {
    const game = activeGames[roomId];
    if (!game) return;
    const fromIdx = game.slots.indexOf(fromUserId);
    const toIdx = game.slots.indexOf(userId);

    if (fromIdx !== -1 && toIdx !== -1) {
      game.slots[fromIdx] = userId;
      game.slots[toIdx] = fromUserId;
      game.teams[userId] = (fromIdx % 2 === 0) ? 1 : 2;
      game.teams[fromUserId] = (toIdx % 2 === 0) ? 1 : 2;
      io.to(roomId).emit('room_update', { slots: game.slots, nicknames: game.nicknames, teams: game.teams, ownerId: game.ownerId, spectators: game.spectators });
      io.to(roomId).emit('system_message', `${game.nicknames[userId]} e ${game.nicknames[fromUserId]} trocaram de lugar.`);
    }
  });

  socket.on('play_card', ({ roomId, cardId }: { roomId: string, cardId: string }) => {
    const game = activeGames[roomId];
    if (!game || !game.gameState) return;
    const state = game.gameState;

    if (state.currentTurn !== userId) return;

    const player = state.players[userId];
    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;

    const card = player.hand[cardIdx];

    // --- REGRA: Ás do corte antes do 7 do corte ---
    // Bloqueado se o jogador tem 2+ cartas (não é a última rodada) e o 7 ainda não saiu.
    // Exceção 1: jogador tem AMBOS (Ás + 7) — pode jogar o Ás e o 7 é revelado a todos.
    // Exceção 2: jogador tem 1 carta (última rodada absoluta) — é obrigado a jogar o que tem.
    if (card.suit === state.trumpSuit && card.value === 'A' && !game.sevenTrumpPlayed && player.hand.length > 1) {
      const trumpSevenEntry = player.hand.find((c, i) => i !== cardIdx && c.suit === state.trumpSuit && c.value === '7');
      if (!trumpSevenEntry) {
        socket.emit('error', 'O Ás do corte não pode ser jogado antes do 7 do corte!');
        return;
      }
      if (trumpSevenEntry) {
        const capturedSeven = trumpSevenEntry;
        setTimeout(() => {
          if (activeGames[roomId]) {
            io.to(roomId).emit('trump_seven_reveal', { userId, nickname: game.nicknames[userId], sevenCard: capturedSeven });
          }
        }, 1000);
      }
    }

    // --- REGRA: 7 do corte não pode sair de fundo (último da rodada) ---
    // Exceção 1: tem o Ás do corte na mão (animação especial de revelação)
    // Exceção 2: é a ÚLTIMA rodada absoluta (jogador tem somente 1 carta na mão)
    let sevenFundoAceCard: Card | null = null;
    if (card.suit === state.trumpSuit && card.value === '7' && state.vaza.length === 3) {
      const aceEntry = player.hand.find((c, i) => i !== cardIdx && c.suit === state.trumpSuit && c.value === 'A');
      const isPlayerLastCard = player.hand.length === 1;
      if (!isPlayerLastCard && !aceEntry) {
        socket.emit('error', 'O 7 do corte não pode ser o último jogado na rodada!');
        return;
      }
      if (aceEntry) sevenFundoAceCard = aceEntry;
    }

    // --- Marcar 7 do corte jogado + revelar Ás se NÃO for fundo ---
    if (card.suit === state.trumpSuit && card.value === '7') {
      game.sevenTrumpPlayed = true;
      if (!sevenFundoAceCard) {
        const hasTrumpAce = player.hand.some((c, i) => i !== cardIdx && c.suit === state.trumpSuit && c.value === 'A');
        if (hasTrumpAce) io.to(roomId).emit('trump_ace_reveal', { userId, nickname: game.nicknames[userId] });
      }
    }

    player.hand.splice(cardIdx, 1);
    state.vaza.push({ userId, card });

    const turnIdx = game.slots.indexOf(userId);
    const nextUserId = game.slots[(turnIdx + 1) % 4] as string;
    state.currentTurn = nextUserId;

    if (state.vaza.length === 4) {
      const winnerId = BiscaEngine.resolveVaza(state.vaza, state.trumpSuit!);
      state.lastVazaWinner = winnerId;
      state.currentTurn = winnerId;
      const vazaCards = state.vaza.map(v => v.card);

      // --- HELAY ---
      const sevenEntry = state.vaza.find(v => v.card.suit === state.trumpSuit && v.card.value === '7');
      const aceEntry   = state.vaza.find(v => v.card.suit === state.trumpSuit && v.card.value === 'A');
      const sevenPos   = state.vaza.findIndex(v => v.card.suit === state.trumpSuit && v.card.value === '7');
      const acePos     = state.vaza.findIndex(v => v.card.suit === state.trumpSuit && v.card.value === 'A');
      if (sevenEntry && aceEntry && acePos > sevenPos &&
          state.players[sevenEntry.userId].team !== state.players[aceEntry.userId].team) {
        state.heleyOccurred = true;
        const heleyPoints = state.isCopas ? 2 : 1;
        const aceTeam = state.players[aceEntry.userId].team as 1 | 2;
        if (aceTeam === 1) state.gameScore.team1 += heleyPoints;
        else state.gameScore.team2 += heleyPoints;
        io.to(roomId).emit('heley_notice', { team: aceTeam, points: heleyPoints });
      }

      state.players[winnerId].vazaPoints += BiscaEngine.calculateHandPoints(vazaCards);
      io.to(roomId).emit('vaza_resolved', { winnerId, vaza: state.vaza });
      io.to(roomId).emit('game_update', state);

      // 7 de fundo com Ás: revela o Ás com animação
      if (sevenFundoAceCard) {
        const capturedAce = sevenFundoAceCard;
        setTimeout(() => {
          if (activeGames[roomId]) {
            io.to(roomId).emit('trump_seven_fundo_ace_reveal', {
              userId, nickname: game.nicknames[userId], aceCard: capturedAce
            });
          }
        }, 700);
      }

      setTimeout(async () => {
        if (!activeGames[roomId] || !activeGames[roomId].gameState) return;
        const g = activeGames[roomId];
        const s = g.gameState;

        s.vaza = [];
        s.roundCount++;

        const winIdx = g.slots.indexOf(winnerId);
        const deckBefore = s.deck.length;

        // Animar distribuição pós-vaza
        if (deckBefore > 0) {
          const dealCount = Math.min(deckBefore, 4);
          const dealOrder = Array.from({ length: dealCount }, (_, i) => g.slots[(winIdx + i) % 4]);
          io.to(roomId).emit('post_vaza_deal_sequence', { dealOrder });

          // Carta do corte vai para um jogador? Só anima na ÚLTIMA distribuição (≤4 cartas no baralho)
          if (s.visibleCorte && s.deck[0]?.id === s.visibleCorte.id && deckBefore <= 4) {
            const corteRecipIdx = (winIdx + dealCount - 1) % 4;
            io.to(roomId).emit('corte_card_deal_animation', {
              recipientId: g.slots[corteRecipIdx],
              corteCard: s.visibleCorte
            });
          }
        }

        // Comprar cartas (vencedor primeiro)
        if (deckBefore > 0) {
          for (let i = 0; i < 4; i++) {
            if (s.deck.length > 0) {
              s.players[g.slots[(winIdx + i) % 4] as string].hand.push(s.deck.pop()!);
            }
          }
          if (s.deck.length === 0 && s.visibleCorte) s.visibleCorte = null;
        }

        // --- Última rodada: compartilhar cartas entre parceiros ---
        const allHaveThree = Object.values(s.players).every(p => p.hand.length === 3);
        if (allHaveThree && s.deck.length === 0 && !g.lastRoundShareDone) {
          g.lastRoundShareDone = true;
          const savedTurn = s.currentTurn;
          s.currentTurn = 'SHARING';
          io.to(roomId).emit('game_update', s);

          for (let i = 0; i < 4; i++) {
            const pid = g.slots[i];
            if (!pid) continue;
            const partnerId = g.slots[(i + 2) % 4];
            if (!partnerId) continue;
            const sid = userSockets[pid];
            if (sid) {
              io.to(sid).emit('last_round_card_share', {
                partnerCards: s.players[partnerId].hand,
                partnerId, partnerNickname: g.nicknames[partnerId]
              });
            }
          }

          setTimeout(() => {
            if (!activeGames[roomId] || !activeGames[roomId].gameState) return;
            activeGames[roomId].gameState.currentTurn = savedTurn;
            io.to(roomId).emit('game_update', activeGames[roomId].gameState);
            io.to(roomId).emit('last_round_share_done');
          }, 8500);
          return;
        }

        // Checar fim de mão (todos sem cartas + baralho vazio)
        const handsEmpty = Object.values(s.players).every(p => p.hand.length === 0);
        if (handsEmpty && s.deck.length === 0) {
          const t1Pts = (Object.values(s.players) as any[]).filter(p => p.team === 1).reduce((a: number, b: any) => a + b.vazaPoints, 0);
          const t2Pts = (Object.values(s.players) as any[]).filter(p => p.team === 2).reduce((a: number, b: any) => a + b.vazaPoints, 0);
          const handWinner: 1 | 2 = t1Pts >= t2Pts ? 1 : 2;
          const loserPts = handWinner === 1 ? t2Pts : t1Pts;
          const isCapote = loserPts <= 30;
          // Regra 59x61: resultado apertado → ponto duplo
          const isCloseCall = !isCapote && ((t1Pts === 59 && t2Pts === 61) || (t1Pts === 61 && t2Pts === 59));
          let pts = s.isCopas ? 2 : 1;
          if (isCapote) pts = s.isCopas ? 3 : 2;
          if (isCloseCall) pts = s.isCopas ? 4 : 2;
          if (handWinner === 1) s.gameScore.team1 += pts;
          else s.gameScore.team2 += pts;

          io.to(roomId).emit('hand_finished', {
            team1Points: t1Pts, team2Points: t2Pts,
            winnerTeam: handWinner, pointsWon: pts,
            newGameScore: s.gameScore, isCopas: s.isCopas, isCapote, isCloseCall
          });
          io.to(roomId).emit('game_update', s);

          if (s.gameScore.team1 >= g.config.scoreGoal || s.gameScore.team2 >= g.config.scoreGoal) {
            s.status = 'FINISHED';
            const matchWinner: 1 | 2 = s.gameScore.team1 >= g.config.scoreGoal ? 1 : 2;
            try { await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['FINISHED', roomId]); } catch {}
            io.to(roomId).emit('game_finished', { winnerTeam: matchWinner });
            doQueueSwap(roomId, matchWinner === 1 ? 2 : 1);
          } else {
            setTimeout(() => triggerNextHand(roomId), 9000);
          }
        } else {
          io.to(roomId).emit('game_update', s);
        }
      }, sevenFundoAceCard ? 4500 : 2500);
      return;
    }

    io.to(roomId).emit('game_update', state);
  });

  socket.on('send_chat', ({ roomId, text }: { roomId: string, text: string }) => {
    const game = activeGames[roomId];
    if (!game || !text.trim()) return;

    const channel: 'players' | 'spectators' = game.spectators.some(s => s.userId === userId) ? 'spectators' : 'players';
    const message: ChatMessage = {
      id: uuidv4(), userId,
      nickname: game.nicknames[userId] || 'Sistema',
      text: text.slice(0, 200), timestamp: Date.now(), channel
    };

    game.chat.push(message);
    if (game.chat.length > 100) game.chat.shift();

    const recipients = channel === 'players'
      ? game.slots.filter(Boolean) as string[]
      : game.spectators.map(s => s.userId);

    for (const recipientId of recipients) {
      const sid = userSockets[recipientId];
      if (sid) io.to(sid).emit('chat_message', message);
    }
  });

  socket.on('bater_copas', (roomId: string) => {
    const game = activeGames[roomId];
    if (!game || !game.gameState) return;
    if (game.gameState.roundCount > 0 || game.gameState.vaza.length > 0) return;
    game.gameState.isCopas = true;
    game.gameState.trumpSuit = 'Copas';
    io.to(roomId).emit('system_message', `${game.nicknames[userId]} BATEU EM COPAS! Mão vale dobrado.`);
    io.to(roomId).emit('game_update', game.gameState);
  });

  socket.on('swap_corte_2', (roomId: string) => {
    const game = activeGames[roomId];
    if (!game || !game.gameState || game.gameState.corteSwapDone) return;
    if (game.gameState.roundCount > 0) return;

    const state = game.gameState;
    const player = state.players[userId];
    const twoIdx = player.hand.findIndex(c => c.value === '2' && c.suit === state.visibleCorte?.suit);

    if (twoIdx !== -1 && state.visibleCorte) {
      const twoCard = player.hand.splice(twoIdx, 1)[0];
      const oldCorte = state.visibleCorte;

      player.hand.push(oldCorte);
      state.visibleCorte = twoCard;
      state.corteSwapDone = true;

      const deckIdx = state.deck.findIndex(c => c.id === oldCorte.id);
      if (deckIdx !== -1) state.deck[deckIdx] = twoCard;

      io.to(roomId).emit('system_message', `${game.nicknames[userId]} trocou o 2 pela carta do corte.`);
      io.to(roomId).emit('game_update', state);
    }
  });

  socket.on('leave_room', async (roomId: string) => {
    const game = activeGames[roomId];
    if (!game) return;

    const idx = game.slots.indexOf(userId);
    if (idx !== -1) {
      game.slots[idx] = null;
      delete game.nicknames[userId];
      delete game.teams[userId];
      socket.leave(roomId);
      await cleanupRoom(roomId, io);
      io.to(roomId).emit('system_message', `${session.username} saiu da sala.`);
    } else {
      const specIdx = game.spectators.findIndex(s => s.userId === userId);
      if (specIdx !== -1) {
        const nick = game.spectators[specIdx].nickname;
        game.spectators.splice(specIdx, 1);
        socket.leave(roomId);
        io.to(roomId).emit('queue_updated', { spectators: game.spectators });
        io.to(roomId).emit('system_message', `${nick} saiu da fila de espera.`);
      }
    }
  });

  socket.on('disconnect', async () => {
    delete userSockets[userId];
    for (const roomId in activeGames) {
      const game = activeGames[roomId];
      if (game.kickVote?.initiatorId === userId) {
        clearTimeout(game.kickVote.timer);
        game.kickVote = null;
        io.to(roomId).emit('kick_vote_result', { passed: false, targetNickname: '', reason: 'iniciador saiu' });
      }
      const specIdx = game.spectators.findIndex(s => s.userId === userId);
      if (specIdx !== -1) {
        const nick = game.spectators[specIdx].nickname;
        game.spectators.splice(specIdx, 1);
        io.to(roomId).emit('queue_updated', { spectators: game.spectators });
        io.to(roomId).emit('system_message', `${nick} saiu da fila de espera.`);
      }
      if (game.slots.includes(userId)) {
        if (game.gameState && game.gameState.status === 'IN_GAME') {
          io.to(roomId).emit('player_disconnected', { nickname: game.nicknames[userId] || 'Jogador', timeout: 30000 });

          game.reconnectionTimers[userId] = setTimeout(async () => {
            io.to(roomId).emit('game_aborted', { reason: 'Jogador abandonou a partida.' });
            game.gameState = null as any;
            try { await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['WAITING', roomId]); } catch {}

            const idx = game.slots.indexOf(userId);
            if (idx !== -1) game.slots[idx] = null;
            await cleanupRoom(roomId, io);
          }, 30000);
        } else {
          const idx = game.slots.indexOf(userId);
          game.slots[idx] = null;
          delete game.nicknames[userId];
          delete game.teams[userId];
          await cleanupRoom(roomId, io);
        }
      }
    }
  });
});

// ── Vite / Static ────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  (async () => {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  })();
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*all', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;

initDB()
  .then(() => {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
