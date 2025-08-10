// 📁 handler.js — единая серверная функция (масштабируемая)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔧 Чтение тела POST-запроса
async function getBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

// 📌 Маршруты API
const routes = {
  async getBooks(req, res, params) {
    const userId = params.get("user_id");
    if (!userId) return res.status(400).json({ error: "Не указан user_id" });

    const { data, error } = await supabase
      .from('user_books')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
  },

  async addBook(req, res) {
    try {
      const book = await getBody(req);
      if (!book?.title || !book?.author) {
        return res.status(400).json({ error: "Отсутствует title или author" });
      }

      const { error } = await supabase.from('user_books').insert([book]);
      if (error) return res.status(500).json({ error: error.message });

      res.status(200).json({ success: true });
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
    }
  },

  async searchBooks(req, res, params) {
    const query = params.get("query") || "";
    if (!query) return res.status(400).json({ error: "Нет запроса поиска" });

    const { data, error } = await supabase
      .from("books_library")
      .select("title, author, cover_url")
      .ilike("title", `%${query}%`)
      .limit(5);

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
  }
};


// GET /api/handler?route=listCollections&user_id=...
routes.listCollections = async (req, res, params) => {
  const userId = params.get('user_id');
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const { data, error } = await supabase
    .from('collections')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

// POST JSON { user_id, name, icon?, color? }
routes.createCollection = async (req, res) => {
  const { user_id, name, icon, color } = await readJsonBody(req);
  if (!user_id || !name) return res.status(400).json({ error: 'user_id & name required' });

  const { data, error } = await supabase
    .from('collections')
    .insert([{ user_id, name, icon: icon || null, color: color || null }])
    .select('id').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ id: data.id });
};

// POST JSON { id, name?, icon?, color?, sort_order? }
routes.renameCollection = async (req, res) => {
  const { id, ...fields } = await readJsonBody(req);
  if (!id) return res.status(400).json({ error: 'id required' });

  const { error } = await supabase.from('collections').update(fields).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
};

// POST JSON { id }  (удалит и связи из-за ON DELETE CASCADE)
routes.deleteCollection = async (req, res) => {
  const { id } = await readJsonBody(req);
  if (!id) return res.status(400).json({ error: 'id required' });

  const { error } = await supabase.from('collections').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
};

// === Items (связи книга ↔ коллекция) ===

// POST JSON { user_id, book_id, collection_ids: [] }
// Полностью заменяет список полок для книги (atomic на уровне API)
routes.setBookCollections = async (req, res) => {
  const { user_id, book_id, collection_ids } = await readJsonBody(req);
  if (!user_id || !book_id || !Array.isArray(collection_ids))
    return res.status(400).json({ error: 'user_id, book_id, collection_ids required' });

  // Текущие связи
  const { data: cur, error: e1 } = await supabase
    .from('collection_items')
    .select('collection_id')
    .eq('user_id', user_id)
    .eq('book_id', book_id);
  if (e1) return res.status(500).json({ error: e1.message });

  const current = new Set((cur || []).map(r => r.collection_id));
  const wanted  = new Set(collection_ids);

  const toAdd = [...wanted].filter(id => !current.has(id));
  const toDel = [...current].filter(id => !wanted.has(id));

  if (toAdd.length) {
    const rows = toAdd.map(cid => ({ user_id, book_id, collection_id: cid }));
    const { error: e2 } = await supabase.from('collection_items').insert(rows);
    if (e2) return res.status(500).json({ error: e2.message });
  }
  if (toDel.length) {
    const { error: e3 } = await supabase
      .from('collection_items')
      .delete()
      .eq('user_id', user_id)
      .eq('book_id', book_id)
      .in('collection_id', toDel);
    if (e3) return res.status(500).json({ error: e3.message });
  }

  res.json({ success: true, added: toAdd.length, removed: toDel.length });
};

// GET /api/handler?route=listBookCollections&book_id=...
routes.listBookCollections = async (req, res, params) => {
  const bookId = params.get('book_id');
  if (!bookId) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('collection_items')
    .select('collection_id')
    .eq('book_id', bookId);

  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(r => r.collection_id));
};

// GET /api/handler?route=listAllBookCollections&user_id=...
// Вернёт пары {book_id, collection_id} для быстрого фильтра на клиенте
routes.listAllBookCollections = async (req, res, params) => {
  const userId = params.get('user_id');
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const { data, error } = await supabase
    .from('collection_items')
    .select('book_id, collection_id')
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
};

// (опционально) GET /api/handler?route=getBooksByCollection&user_id=...&collection_id=...&status=read|reading|want
routes.getBooksByCollection = async (req, res, params) => {
  const userId = params.get('user_id');
  const collectionId = params.get('collection_id');
  const status = params.get('status');
  if (!userId || !collectionId) return res.status(400).json({ error: 'user_id & collection_id required' });

  // сначала id книг
  const { data: ids, error: e1 } = await supabase
    .from('collection_items')
    .select('book_id')
    .eq('user_id', userId)
    .eq('collection_id', collectionId);
  if (e1) return res.status(500).json({ error: e1.message });

  const bookIds = (ids || []).map(r => r.book_id);
  if (!bookIds.length) return res.json([]);

  let q = supabase.from('user_books').select('*').in('id', bookIds);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};


// 📌 Главный обработчик
export default async function handler(req, res) {
  // CORS (если тестируешь с фронта локально)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const fullUrl = new URL(req.url, `http://${req.headers.host}`);
  const route = fullUrl.searchParams.get("route");
  const params = fullUrl.searchParams;

  console.log(`📥 ${req.method} /api/handler?route=${route}`);

  if (!route || !routes[route]) {
    return res.status(404).json({ error: "Route not found" });
  }

  // Вызываем маршрут
  try {
    await routes[route](req, res, params);
  } catch (err) {
    console.error(`❌ Ошибка в маршруте "${route}":`, err);
    res.status(500).json({ error: "Internal server error" });
  }
}
