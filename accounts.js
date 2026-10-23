// accounts.js
// Contas de jogador, sessões e amigos.
//
// Armazenamento:
// - Com a variável de ambiente DATABASE_URL (Postgres), os dados ficam no banco.
// - Sem ela, ficam no arquivo data/users.json (ou em DATA_DIR/users.json).
//   Atenção: em hospedagens com disco temporário (ex: Render grátis) o arquivo
//   some a cada reinício, então lá use um Postgres.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MAX_SESSIONS = 8;
const MAX_FRIENDS = 200;
const MAX_PENDING = 50;

// ---------------------------------------------------------------------------
// Armazenamento (tudo fica em memória; cada alteração é gravada em seguida)
// ---------------------------------------------------------------------------

function createFileStore(dir) {
  const file = path.join(dir, 'users.json');
  let writing = Promise.resolve();
  let users = {};

  return {
    kind: 'arquivo',
    async load() {
      try {
        users = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('Erro ao ler users.json:', e.message);
        users = {};
      }
      return users;
    },
    save(allUsers) {
      // Grava o arquivo inteiro de forma atômica (arquivo temporário + rename)
      writing = writing.then(() => new Promise(resolve => {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFile(tmp, JSON.stringify(allUsers), err => {
          if (err) { console.error('Erro ao gravar contas:', err.message); return resolve(); }
          fs.rename(tmp, file, err2 => {
            if (err2) console.error('Erro ao gravar contas:', err2.message);
            resolve();
          });
        });
      }));
      return writing;
    }
  };
}

function createPgStore(databaseUrl, PoolClass) {
  const Pool = PoolClass || require('pg').Pool;
  const local = /localhost|127\.0\.0\.1/.test(databaseUrl);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: local || process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
  const dirty = new Set();
  let flushing = Promise.resolve();

  return {
    kind: 'postgres',
    pool,
    async load() {
      await pool.query(`CREATE TABLE IF NOT EXISTS truco_users (
        username TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )`);
      const res = await pool.query('SELECT username, data FROM truco_users');
      const users = {};
      res.rows.forEach(r => { users[r.username] = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; });
      return users;
    },
    save(allUsers, changedKeys) {
      (changedKeys || Object.keys(allUsers)).forEach(k => dirty.add(k));
      flushing = flushing.then(async () => {
        const keys = [...dirty];
        dirty.clear();
        for (const key of keys) {
          const user = allUsers[key];
          try {
            if (user) {
              await pool.query(
                `INSERT INTO truco_users (username, data) VALUES ($1, $2)
                 ON CONFLICT (username) DO UPDATE SET data = EXCLUDED.data`,
                [key, JSON.stringify(user)]
              );
            } else {
              await pool.query('DELETE FROM truco_users WHERE username = $1', [key]);
            }
          } catch (e) {
            console.error(`Erro ao gravar conta ${key}:`, e.message);
          }
        }
      });
      return flushing;
    }
  };
}

// ---------------------------------------------------------------------------
// Senhas e tokens
// ---------------------------------------------------------------------------

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key.toString('hex')));
  });
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(a || '', 'hex');
  const bb = Buffer.from(b || '', 'hex');
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Serviço de contas
// ---------------------------------------------------------------------------

function createAccounts(options = {}) {
  const store = options.store
    || (process.env.DATABASE_URL
      ? createPgStore(process.env.DATABASE_URL)
      : createFileStore(process.env.DATA_DIR || path.join(__dirname, 'data')));

  let users = {};
  let loaded = false;

  // Carrega as contas; se o banco falhar, tenta de novo a cada 5s.
  // Enquanto não carregar, entrar/criar conta fica indisponível (para não sobrescrever contas).
  const ready = new Promise(resolve => {
    const attempt = () => store.load().then(u => {
      users = u || {};
      loaded = true;
      console.log(`Contas carregadas (${store.kind}): ${Object.keys(users).length}`);
      resolve();
    }).catch(err => {
      console.error(`Erro ao carregar contas (${store.kind}), tentando de novo em 5s:`, err.message);
      setTimeout(attempt, 5000);
    });
    attempt();
  });

  const UNAVAILABLE = { error: 'Contas indisponíveis no momento. Tente de novo em instantes.' };
  const whenReady = () => loaded ? Promise.resolve(true)
    : Promise.race([ready.then(() => true), new Promise(r => setTimeout(() => r(false), 5000))]);

  const persist = (...keys) => store.save(users, keys);
  const key = name => String(name || '').trim().toLowerCase();
  const get = name => users[key(name)] || null;

  function publicUser(u) {
    return {
      username: u.username,
      createdAt: u.createdAt,
      stats: { played: u.stats.played, won: u.stats.won }
    };
  }

  function newSession(u) {
    const token = crypto.randomBytes(32).toString('base64url');
    u.sessions.push({ h: sha256(token), at: Date.now() });
    while (u.sessions.length > MAX_SESSIONS) u.sessions.shift();
    return token;
  }

  // Token no formato "usuario.segredo" para achar a conta sem varrer todas
  const packToken = (u, secret) => `${key(u.username)}.${secret}`;

  async function register(username, password) {
    if (!(await whenReady())) return UNAVAILABLE;
    username = String(username || '').trim();
    password = String(password || '');
    if (!USERNAME_RE.test(username)) {
      return { error: 'O usuário deve ter de 3 a 16 caracteres: letras, números ou _.' };
    }
    if (password.length < 6 || password.length > 72) {
      return { error: 'A senha deve ter de 6 a 72 caracteres.' };
    }
    if (get(username)) return { error: 'Esse nome de usuário já está em uso.' };

    const salt = crypto.randomBytes(16).toString('hex');
    const u = {
      username,
      salt,
      passHash: await hashPassword(password, salt),
      createdAt: Date.now(),
      sessions: [],
      friends: [],
      requestsIn: [],
      requestsOut: [],
      stats: { played: 0, won: 0 }
    };
    if (get(username)) return { error: 'Esse nome de usuário já está em uso.' }; // corrida durante o hash
    users[key(username)] = u;
    const token = packToken(u, newSession(u));
    persist(key(username));
    return { user: publicUser(u), token };
  }

  async function login(username, password) {
    if (!(await whenReady())) return UNAVAILABLE;
    const u = get(username);
    const hash = await hashPassword(String(password || ''), u ? u.salt : 'sem-conta');
    if (!u || !safeEqualHex(hash, u.passHash)) return { error: 'Usuário ou senha incorretos.' };
    const token = packToken(u, newSession(u));
    persist(key(u.username));
    return { user: publicUser(u), token };
  }

  async function resume(token) {
    if (!(await whenReady())) return UNAVAILABLE;
    const [name, secret] = String(token || '').split('.');
    const u = name && secret ? get(name) : null;
    if (!u) return { error: 'Sessão expirada.' };
    const h = sha256(secret);
    const session = u.sessions.find(s => safeEqualHex(s.h, h));
    if (!session) return { error: 'Sessão expirada.' };
    return { user: publicUser(u) };
  }

  async function logout(token) {
    if (!(await whenReady())) return;
    const [name, secret] = String(token || '').split('.');
    const u = name && secret ? get(name) : null;
    if (!u) return;
    const h = sha256(secret);
    u.sessions = u.sessions.filter(s => !safeEqualHex(s.h, h));
    persist(key(u.username));
  }

  // --- Amigos ---------------------------------------------------------------
  // Listas guardam as chaves (nome em minúsculas). Retorna os usuários afetados.

  const without = (list, k) => list.filter(x => x !== k);

  function sendRequest(fromName, toName) {
    const a = get(fromName);
    const b = get(toName);
    if (!a) return { error: 'Entre na sua conta primeiro.' };
    if (!b) return { error: 'Não existe jogador com esse usuário.' };
    const ka = key(a.username), kb = key(b.username);
    if (ka === kb) return { error: 'Você não pode adicionar a si mesmo.' };
    if (a.friends.includes(kb)) return { error: `${b.username} já é seu amigo.` };
    if (a.requestsOut.includes(kb)) return { error: `Você já enviou um pedido para ${b.username}.` };

    // Se o outro já tinha pedido, vira amizade direto
    if (a.requestsIn.includes(kb)) return respondRequest(a.username, b.username, true);

    if (a.friends.length >= MAX_FRIENDS) return { error: 'Sua lista de amigos está cheia.' };
    if (a.requestsOut.length >= MAX_PENDING || b.requestsIn.length >= MAX_PENDING) {
      return { error: 'Muitos pedidos pendentes. Tente mais tarde.' };
    }
    a.requestsOut.push(kb);
    b.requestsIn.push(ka);
    persist(ka, kb);
    return { ok: true, message: `Pedido enviado para ${b.username}.`, affected: [ka, kb] };
  }

  function respondRequest(meName, otherName, accept) {
    const me = get(meName);
    const other = get(otherName);
    if (!me || !other) return { error: 'Jogador não encontrado.' };
    const km = key(me.username), ko = key(other.username);
    if (!me.requestsIn.includes(ko)) return { error: 'Esse pedido não existe mais.' };

    me.requestsIn = without(me.requestsIn, ko);
    other.requestsOut = without(other.requestsOut, km);
    if (accept) {
      if (me.friends.length >= MAX_FRIENDS || other.friends.length >= MAX_FRIENDS) {
        persist(km, ko);
        return { error: 'Lista de amigos cheia.', affected: [km, ko] };
      }
      if (!me.friends.includes(ko)) me.friends.push(ko);
      if (!other.friends.includes(km)) other.friends.push(km);
    }
    persist(km, ko);
    return {
      ok: true,
      message: accept ? `Agora você e ${other.username} são amigos!` : 'Pedido recusado.',
      affected: [km, ko]
    };
  }

  function cancelRequest(meName, otherName) {
    const me = get(meName);
    const other = get(otherName);
    if (!me || !other) return { error: 'Jogador não encontrado.' };
    const km = key(me.username), ko = key(other.username);
    me.requestsOut = without(me.requestsOut, ko);
    other.requestsIn = without(other.requestsIn, km);
    persist(km, ko);
    return { ok: true, affected: [km, ko] };
  }

  function removeFriend(meName, otherName) {
    const me = get(meName);
    const other = get(otherName);
    if (!me || !other) return { error: 'Jogador não encontrado.' };
    const km = key(me.username), ko = key(other.username);
    me.friends = without(me.friends, ko);
    other.friends = without(other.friends, km);
    persist(km, ko);
    return { ok: true, message: `${other.username} foi removido dos amigos.`, affected: [km, ko] };
  }

  function areFriends(aName, bName) {
    const a = get(aName);
    return !!(a && a.friends.includes(key(bName)));
  }

  function recordResult(name, won) {
    const u = get(name);
    if (!u) return;
    u.stats.played += 1;
    if (won) u.stats.won += 1;
    persist(key(u.username));
  }

  function displayName(k) {
    const u = users[k];
    return u ? u.username : k;
  }

  return {
    ready,
    store,
    key,
    get,
    publicUser,
    displayName,
    register,
    login,
    resume,
    logout,
    sendRequest,
    respondRequest,
    cancelRequest,
    removeFriend,
    areFriends,
    recordResult
  };
}

module.exports = { createAccounts, createFileStore, createPgStore, USERNAME_RE };
