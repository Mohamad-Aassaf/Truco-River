// news.js
// Novidades do jogo: o admin cria, edita e apaga; todos os jogadores veem.
// Fica no mesmo lugar das contas: Postgres (DATABASE_URL) ou data/news.json.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TAGS = ['novidade', 'melhoria', 'correcao', 'evento', 'aviso'];

// Imagens/GIFs das notícias: guardadas à parte (não vão junto da lista para
// todo mundo) e servidas em /news-media/<id>
const MEDIA_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_MEDIA_BYTES = 3 * 1024 * 1024; // GIF animado até 3 MB
const MAX_IMAGES = 4;
const MEDIA_ID_RE = /^[a-f0-9-]{36}$/;

// Primeiras notícias (entram uma vez só, quando ainda não existe nenhuma)
const SEED = [
  {
    tag: 'melhoria',
    title: 'Bots mais espertos',
    body: 'Os bots foram reescritos: agora calculam a chance de ganhar a mão antes de jogar, trucar ou aceitar, prestam atenção no placar e blefam de vez em quando.\nE ficou mais fácil escolher o nível: adicione o bot e troque a dificuldade ao lado do nome dele.'
  },
  {
    tag: 'novidade',
    title: 'Volte para a partida em até 30 segundos',
    body: 'Fechou a aba sem querer ou a internet caiu? Abra o site de novo em até 30 segundos e você volta direto para a mesa, com as mesmas cartas.'
  },
  {
    tag: 'novidade',
    title: 'Pontos do Envido na mesa',
    body: 'Quando um Envido é aceito, aparece a contagem de pontos de cada um (quem perde pode dizer "São cartas boas...").\nNo fim da mão, quem ganhou mostra as cartas que fecham o envido ou a flor.'
  },
  {
    tag: 'novidade',
    title: 'Contas, amigos e regras',
    body: 'Crie sua conta para adicionar amigos, ver quem está online e convidar a gurizada para a sua sala.\nE as regras completas do Truco Gaúcho estão no botão "Regras", com calculadora de envido.'
  }
];

function cleanItem(data) {
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 90) : '';
  const body = typeof data.body === 'string' ? data.body.trim().slice(0, 2000) : '';
  const tag = TAGS.includes(data.tag) ? data.tag : 'novidade';
  const images = Array.isArray(data.images)
    ? data.images.filter(id => typeof id === 'string' && MEDIA_ID_RE.test(id)).slice(0, MAX_IMAGES)
    : [];
  if (!title) return { error: 'Escreva um título.' };
  if (!body && !images.length) return { error: 'Escreva o texto da notícia.' };
  return { item: { title, body, tag, images, pinned: !!data.pinned } };
}

function createNews(accountStore) {
  const usePg = accountStore && accountStore.kind === 'postgres' && accountStore.pool;
  const file = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'news.json');
  const mediaDir = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'news-media');
  const mediaCache = new Map(); // id -> { mime, buf } (as mais vistas ficam na memória)
  let items = [];
  let seeded = false;
  let writing = Promise.resolve();

  async function load() {
    if (usePg) {
      const pool = accountStore.pool;
      await pool.query('CREATE TABLE IF NOT EXISTS truco_news (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
      await pool.query('CREATE TABLE IF NOT EXISTS truco_news_media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL, created BIGINT NOT NULL)');
      const res = await pool.query('SELECT id, data FROM truco_news');
      res.rows.forEach(r => {
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (r.id === '_meta') seeded = !!data.seeded;
        else items.push(data);
      });
    } else {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        items = saved.items || [];
        seeded = !!saved.seeded;
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('Erro ao ler news.json:', e.message);
      }
    }

    if (!seeded) {
      const now = Date.now();
      SEED.forEach((s, i) => items.push({ id: crypto.randomUUID(), ...s, pinned: false, date: now - i * 60000, updatedAt: now - i * 60000 }));
      seeded = true;
      await persistAll();
    }
    console.log(`Novidades carregadas: ${items.length}`);
  }

  function persistAll() {
    writing = writing.then(async () => {
      try {
        if (usePg) {
          const pool = accountStore.pool;
          await pool.query(`INSERT INTO truco_news (id, data) VALUES ('_meta', $1)
            ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [JSON.stringify({ seeded: true })]);
          for (const it of items) {
            await pool.query(`INSERT INTO truco_news (id, data) VALUES ($1, $2)
              ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [it.id, JSON.stringify(it)]);
          }
        } else {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file + '.tmp', JSON.stringify({ seeded, items }));
          fs.renameSync(file + '.tmp', file);
        }
      } catch (e) {
        console.error('Erro ao gravar novidades:', e.message);
      }
    });
    return writing;
  }

  async function removeFromStore(id) {
    if (usePg) {
      writing = writing.then(() => accountStore.pool.query('DELETE FROM truco_news WHERE id = $1', [id])
        .catch(e => console.error('Erro ao apagar novidade:', e.message)));
      return writing;
    }
    return persistAll();
  }

  // Se o banco falhar ao iniciar, tenta de novo (as novidades só aparecem depois)
  const ready = new Promise(resolve => {
    const attempt = () => load().then(resolve).catch(err => {
      console.error('Erro ao carregar novidades, tentando de novo em 5s:', err.message);
      items = [];
      setTimeout(attempt, 5000);
    });
    attempt();
  });

  // Fixadas primeiro, depois as mais novas
  function list() {
    return items.slice().sort((a, b) => (b.pinned - a.pinned) || (b.date - a.date));
  }

  function save(data) {
    const { item, error } = cleanItem(data || {});
    if (error) return { error };
    const now = Date.now();
    if (data.id) {
      const existing = items.find(it => it.id === data.id);
      if (!existing) return { error: 'Essa notícia não existe mais.' };
      const dropped = (existing.images || []).filter(mid => !item.images.includes(mid));
      Object.assign(existing, item, { updatedAt: now });
      dropped.forEach(mid => { if (!isUsed(mid)) deleteMedia(mid); });
    } else {
      if (items.length >= 200) return { error: 'Limite de 200 notícias. Apague algumas antigas.' };
      items.push({ id: crypto.randomUUID(), ...item, date: now, updatedAt: now });
    }
    persistAll();
    return { ok: true };
  }

  function remove(id) {
    const gone = items.find(it => it.id === id);
    const before = items.length;
    items = items.filter(it => it.id !== id);
    if (items.length === before) return { error: 'Essa notícia não existe mais.' };
    removeFromStore(id);
    (gone.images || []).forEach(mid => { if (!isUsed(mid)) deleteMedia(mid); });
    return { ok: true };
  }

  // --- Imagens ---------------------------------------------------------------
  const isUsed = mid => items.some(it => (it.images || []).includes(mid));

  // Recebe uma imagem como data URL (o navegador já comprime as que não são GIF)
  async function addMedia(dataUrl) {
    const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { error: 'Use uma imagem JPG, PNG, WEBP ou GIF.' };
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return { error: 'Imagem vazia.' };
    if (buf.length > MAX_MEDIA_BYTES) return { error: 'Imagem grande demais (máximo 3 MB).' };
    const id = crypto.randomUUID();
    const mime = m[1];
    try {
      if (usePg) {
        await accountStore.pool.query('INSERT INTO truco_news_media (id, mime, data, created) VALUES ($1, $2, $3, $4)', [id, mime, buf, Date.now()]);
      } else {
        fs.mkdirSync(mediaDir, { recursive: true });
        fs.writeFileSync(path.join(mediaDir, `${id}.${MEDIA_TYPES[mime]}`), buf);
      }
    } catch (e) {
      console.error('Erro ao guardar imagem da novidade:', e.message);
      return { error: 'Não deu para guardar a imagem. Tente de novo.' };
    }
    mediaCache.set(id, { mime, buf });
    return { ok: true, id };
  }

  async function getMedia(id) {
    if (!MEDIA_ID_RE.test(String(id))) return null;
    if (mediaCache.has(id)) return mediaCache.get(id);
    let found = null;
    try {
      if (usePg) {
        const r = await accountStore.pool.query('SELECT mime, data FROM truco_news_media WHERE id = $1', [id]);
        if (r.rows[0]) found = { mime: r.rows[0].mime, buf: r.rows[0].data };
      } else if (fs.existsSync(mediaDir)) {
        const name = fs.readdirSync(mediaDir).find(f => f.startsWith(id + '.'));
        if (name) {
          const ext = name.split('.').pop();
          const mime = Object.keys(MEDIA_TYPES).find(k => MEDIA_TYPES[k] === ext);
          found = { mime, buf: fs.readFileSync(path.join(mediaDir, name)) };
        }
      }
    } catch (e) {
      console.error('Erro ao ler imagem da novidade:', e.message);
    }
    if (found) {
      mediaCache.set(id, found);
      if (mediaCache.size > 40) mediaCache.delete(mediaCache.keys().next().value);
    }
    return found;
  }

  function deleteMedia(id) {
    mediaCache.delete(id);
    if (usePg) {
      accountStore.pool.query('DELETE FROM truco_news_media WHERE id = $1', [id]).catch(e => console.error('Erro ao apagar imagem:', e.message));
    } else if (fs.existsSync(mediaDir)) {
      fs.readdirSync(mediaDir).filter(f => f.startsWith(id + '.')).forEach(f => fs.unlinkSync(path.join(mediaDir, f)));
    }
  }

  return { ready, list, save, remove, addMedia, getMedia, deleteMedia, isUsed, TAGS, MAX_IMAGES };
}

module.exports = { createNews, TAGS };
