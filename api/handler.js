// 📁 handler.js — единая серверная функция
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { method, url } = req;
  const route = new URL(req.url, `http://${req.headers.host}`).searchParams.get("route");

  if (method === 'GET' && route === 'getBooks') {
    const userId = new URL(req.url, `http://${req.headers.host}`).searchParams.get("user_id");

    const { data, error } = await supabase
      .from('user_books')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (method === 'POST' && route === 'addBook') {
    try {
      const book = await getBody(req);
      const { error } = await supabase.from('user_books').insert([book]);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  if (method === 'GET' && route === 'searchBooks') {
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams.get("query");

    const { data, error } = await supabase
      .from("books_library")
      .select("title, author, cover_url")
      .ilike("title", `%${query}%`)
      .limit(5);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // ❌ Неизвестный маршрут
  return res.status(404).json({ error: "Route not found" });
}

// 🔧 Чтение тела запроса (для POST)
async function getBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}
