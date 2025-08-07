// 📁 api/addBook.js (серверная функция)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const book = req.body;

  const { error } = await supabase.from("user_books").insert([book]);

  if (error) {
    console.error("❌ Ошибка Supabase при добавлении книги:", error);
    return res.status(500).json({ error: "Ошибка Supabase" });
  }

  return res.status(200).json({ ok: true });
}
