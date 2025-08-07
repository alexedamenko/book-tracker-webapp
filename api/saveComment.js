import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: "Метод запрещён" });

  const { bookId, userId, comment } = await req.json?.() || await new Response(req.body).json();

  if (!bookId || !userId) return res.status(400).json({ error: "Нет данных" });

  const { error } = await supabase
    .from("user_books")
    .update({ comment })
    .eq("id", bookId)
    .eq("user_id", userId);

  if (error) return res.status(500).json({ error: "Ошибка сохранения" });

  return res.status(200).json({ success: true });
}
