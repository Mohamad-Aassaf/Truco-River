// news.js
// Novidades do jogo: o admin cria, edita e apaga; todos os jogadores veem.
// Fica no mesmo lugar das contas: Postgres (DATABASE_URL) ou data/news.json.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TAGS = ['novidade', 'melhoria', 'correcao', 'evento', 'aviso'];

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
  if (!title) return { error: 'Escreva um título.' };
  if (!body) return { error: 'Escreva o texto da notícia.' };
  return { item: { title, body, tag, pinned: !!data.pinned } };
}

function createNews(accountStore) {
  const usePg = accountStore && accountStore.kind === 'postgres' && accountStore.pool;
  const file = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'news.json');
  let items = [];
  let seeded = false;
  let writing = Promise.resolve();

  async function load() {
    if (usePg) {
      const pool = accountStore.pool;
      await pool.query('CREATE TABLE IF NOT EXISTS truco_news (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
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
      Object.assign(existing, item, { updatedAt: now });
    } else {
      if (items.length >= 200) return { error: 'Limite de 200 notícias. Apague algumas antigas.' };
      items.push({ id: crypto.randomUUID(), ...item, date: now, updatedAt: now });
    }
    persistAll();
    return { ok: true };
  }

  function remove(id) {
    const before = items.length;
    items = items.filter(it => it.id !== id);
    if (items.length === before) return { error: 'Essa notícia não existe mais.' };
    removeFromStore(id);
    return { ok: true };
  }

  return { ready, list, save, remove, TAGS };
}

module.exports = { createNews, TAGS };
