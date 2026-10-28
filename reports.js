// reports.js
// Relatos de bugs e sugestões enviados pelos jogadores (com print opcional).
// Só o admin vê. Fica no mesmo lugar das contas: Postgres (DATABASE_URL) ou data/reports.json.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KINDS = ['bug', 'sugestao'];
const MAX_REPORTS = 500;
const MAX_IMAGE_CHARS = 900 * 1024; // imagem já comprimida no navegador (data URL)

function cleanReport(data) {
  const kind = KINDS.includes(data.kind) ? data.kind : null;
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 100) : '';
  const description = typeof data.description === 'string' ? data.description.trim().slice(0, 3000) : '';
  if (!kind) return { error: 'Escolha se é um bug ou uma sugestão.' };
  if (title.length < 3) return { error: 'Escreva um título (pelo menos 3 letras).' };
  if (description.length < 5) return { error: 'Conte um pouco mais na descrição.' };

  let image = null;
  if (data.image) {
    if (typeof data.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data.image)) {
      return { error: 'Imagem inválida. Use JPG, PNG ou WEBP.' };
    }
    if (data.image.length > MAX_IMAGE_CHARS) return { error: 'A imagem ficou grande demais. Tente outra.' };
    image = data.image;
  }

  const ctx = data.context && typeof data.context === 'object' ? data.context : {};
  const context = {
    screen: String(ctx.screen || '').slice(0, 20),
    viewport: String(ctx.viewport || '').slice(0, 20),
    device: String(ctx.device || '').slice(0, 200),
    deck: String(ctx.deck || '').slice(0, 20)
  };
  return { report: { kind, title, description, image, context } };
}

function createReports(accountStore) {
  const usePg = accountStore && accountStore.kind === 'postgres' && accountStore.pool;
  const file = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'reports.json');
  let items = [];
  let writing = Promise.resolve();

  async function load() {
    if (usePg) {
      const pool = accountStore.pool;
      await pool.query('CREATE TABLE IF NOT EXISTS truco_reports (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
      const res = await pool.query('SELECT data FROM truco_reports');
      items = res.rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
    } else {
      try {
        items = JSON.parse(fs.readFileSync(file, 'utf8')).items || [];
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('Erro ao ler reports.json:', e.message);
        items = [];
      }
    }
    console.log(`Relatos carregados: ${items.length}`);
  }

  function persist(changed, removedId) {
    writing = writing.then(async () => {
      try {
        if (usePg) {
          const pool = accountStore.pool;
          if (removedId) await pool.query('DELETE FROM truco_reports WHERE id = $1', [removedId]);
          if (changed) {
            await pool.query(`INSERT INTO truco_reports (id, data) VALUES ($1, $2)
              ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [changed.id, JSON.stringify(changed)]);
          }
        } else {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file + '.tmp', JSON.stringify({ items }));
          fs.renameSync(file + '.tmp', file);
        }
      } catch (e) {
        console.error('Erro ao gravar relatos:', e.message);
      }
    });
    return writing;
  }

  const ready = new Promise(resolve => {
    const attempt = () => load().then(resolve).catch(err => {
      console.error('Erro ao carregar relatos, tentando de novo em 5s:', err.message);
      setTimeout(attempt, 5000);
    });
    attempt();
  });

  // Lista para o admin, sem as imagens (vêm uma por uma, quando ele abre)
  const summary = r => ({
    id: r.id, kind: r.kind, title: r.title, description: r.description,
    hasImage: !!r.image, status: r.status, date: r.date, author: r.author, context: r.context
  });

  function list() {
    return items.slice().sort((a, b) => b.date - a.date).map(summary);
  }

  function add(data, author) {
    const { report, error } = cleanReport(data || {});
    if (error) return { error };
    if (items.length >= MAX_REPORTS) {
      // Abre espaço apagando o resolvido mais antigo
      const oldest = items.filter(r => r.status === 'resolvido').sort((a, b) => a.date - b.date)[0];
      if (!oldest) return { error: 'A caixa de relatos está cheia. Tente mais tarde.' };
      remove(oldest.id);
    }
    const item = { id: crypto.randomUUID(), ...report, status: 'aberto', date: Date.now(), author };
    items.push(item);
    persist(item);
    return { ok: true, item: summary(item) };
  }

  function setStatus(id, status) {
    const item = items.find(r => r.id === id);
    if (!item) return { error: 'Esse relato não existe mais.' };
    item.status = status === 'resolvido' ? 'resolvido' : 'aberto';
    persist(item);
    return { ok: true };
  }

  function remove(id) {
    const before = items.length;
    items = items.filter(r => r.id !== id);
    if (items.length === before) return { error: 'Esse relato não existe mais.' };
    persist(null, id);
    return { ok: true };
  }

  function image(id) {
    const item = items.find(r => r.id === id);
    return item && item.image ? { ok: true, image: item.image } : { error: 'Sem imagem.' };
  }

  return { ready, list, add, setStatus, remove, image, openCount: () => items.filter(r => r.status === 'aberto').length };
}

module.exports = { createReports };
