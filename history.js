// history.js
// Histórico das partidas que terminaram (ou foram interrompidas). Só o admin vê.
// Fica no mesmo lugar das contas: Postgres (DATABASE_URL) ou data/history.json.
// Guarda por 30 dias (HISTORY_DAYS) e apaga sozinho o que passar disso.

const fs = require('fs');
const path = require('path');

const DAY = 24 * 60 * 60 * 1000;
const KEEP_MS = (Number(process.env.HISTORY_DAYS) || 30) * DAY;
const MAX_LOG = 1500;          // linhas da narrativa por partida
const MAX_ITEMS_PG = 20000;    // limite de segurança no banco
const MAX_ITEMS_FILE = 500;    // no arquivo local (desenvolvimento) guarda menos
const PAGE = 40;

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function createHistory(accountStore) {
  const usePg = accountStore && accountStore.kind === 'postgres' && accountStore.pool;
  const file = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'history.json');
  // Em memória fica só o resumo; a narrativa vem do banco quando o admin abre
  let items = [];
  let full = new Map(); // só no modo arquivo
  let writing = Promise.resolve();

  const summary = h => {
    const { log, ...rest } = h;
    return rest;
  };

  async function load() {
    const cutoff = Date.now() - KEEP_MS;
    if (usePg) {
      const pool = accountStore.pool;
      await pool.query('CREATE TABLE IF NOT EXISTS truco_history (id TEXT PRIMARY KEY, ended_at BIGINT NOT NULL, data JSONB NOT NULL)');
      await pool.query('CREATE INDEX IF NOT EXISTS truco_history_ended ON truco_history (ended_at)');
      await pool.query('DELETE FROM truco_history WHERE ended_at < $1', [cutoff]);
      const res = await pool.query("SELECT data - 'log' AS data FROM truco_history ORDER BY ended_at DESC LIMIT $1", [MAX_ITEMS_PG]);
      items = res.rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
    } else {
      try {
        const all = (JSON.parse(fs.readFileSync(file, 'utf8')).items || []).filter(h => h.endedAt >= cutoff);
        all.forEach(h => full.set(h.id, h));
        items = all.map(summary);
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('Erro ao ler history.json:', e.message);
        items = [];
      }
    }
    items.sort((a, b) => b.endedAt - a.endedAt);
    console.log(`Histórico de partidas carregado: ${items.length}`);
  }

  function persist(added, removedIds = []) {
    writing = writing.then(async () => {
      try {
        if (usePg) {
          const pool = accountStore.pool;
          if (removedIds.length) await pool.query('DELETE FROM truco_history WHERE id = ANY($1)', [removedIds]);
          if (added) {
            await pool.query(`INSERT INTO truco_history (id, ended_at, data) VALUES ($1, $2, $3)
              ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, ended_at = EXCLUDED.ended_at`, [added.id, added.endedAt, JSON.stringify(added)]);
          }
        } else {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const all = items.map(s => full.get(s.id)).filter(Boolean);
          fs.writeFileSync(file + '.tmp', JSON.stringify({ items: all }));
          fs.renameSync(file + '.tmp', file);
        }
      } catch (e) {
        console.error('Erro ao gravar histórico:', e.message);
      }
    });
    return writing;
  }

  const ready = new Promise(resolve => {
    const attempt = () => load().then(resolve).catch(err => {
      console.error('Erro ao carregar histórico, tentando de novo em 5s:', err.message);
      setTimeout(attempt, 5000);
    });
    attempt();
  });

  // Apaga o que passou do prazo (e o excesso, do mais antigo para o mais novo)
  function prune() {
    const cutoff = Date.now() - KEEP_MS;
    const max = usePg ? MAX_ITEMS_PG : MAX_ITEMS_FILE;
    const removed = [];
    items = items.filter((h, i) => {
      const keep = h.endedAt >= cutoff && i < max;
      if (!keep) { removed.push(h.id); full.delete(h.id); }
      return keep;
    });
    return removed;
  }
  setInterval(() => { ready.then(() => { const r = prune(); if (r.length) persist(null, r); }); }, 6 * 60 * 60 * 1000).unref();

  function add(record) {
    if (!record || !record.id) return;
    const rec = { ...record, log: (record.log || []).slice(-MAX_LOG) };
    ready.then(() => {
      items = items.filter(h => h.id !== rec.id);
      items.unshift(summary(rec));
      if (!usePg) full.set(rec.id, rec);
      const removed = prune();
      persist(rec, removed);
    });
  }

  // Busca por jogador, código ou nome da sala; também "bot", "duplas", "campeonato"
  function list({ q = '', offset = 0 } = {}) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const match = h => {
      if (!terms.length) return true;
      const hay = norm([
        h.roomId, h.roomName, h.mode === '2v2' ? 'duplas 2v2' : '1v1', h.how,
        h.tournament ? `campeonato ${h.tournament.name}` : '',
        ...(h.players || []).map(p => `${p.name} ${p.bot ? 'bot' : ''}`)
      ].join(' '));
      return terms.every(t => hay.includes(t));
    };
    const found = items.filter(match);
    const start = Math.max(0, Number(offset) || 0);
    return { ok: true, total: found.length, items: found.slice(start, start + PAGE), offset: start, page: PAGE, keepDays: Math.round(KEEP_MS / DAY) };
  }

  async function get(id) {
    if (typeof id !== 'string') return { error: 'Partida não encontrada.' };
    if (usePg) {
      const res = await accountStore.pool.query('SELECT data FROM truco_history WHERE id = $1', [id]);
      if (!res.rows.length) return { error: 'Essa partida não está mais no histórico.' };
      const d = res.rows[0].data;
      return { ok: true, item: typeof d === 'string' ? JSON.parse(d) : d };
    }
    const h = full.get(id);
    return h ? { ok: true, item: h } : { error: 'Essa partida não está mais no histórico.' };
  }

  // Partidas de uma conta (as mais novas primeiro)
  function listForAccount(account, limit = 200) {
    return items.filter(h => (h.players || []).some(p => p.account === account)).slice(0, limit);
  }

  return { ready, add, list, get, listForAccount, flush: () => writing };
}

module.exports = { createHistory };
