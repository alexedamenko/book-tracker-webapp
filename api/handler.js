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
