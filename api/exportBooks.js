import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const userId = req.query.user_id;

  if (!userId) {
    return res.status(400).json({ error: "Не указан user_id" });
  }

  const { data, error } = await supabase
    .from("user_books")
    .select("title, author, status, rating, started_at, finished_at, added_at, comment")
    .eq("user_id", userId);

  if (error) {
    console.error("Ошибка при экспорте данных:", error);
    return res.status(500).json({ error: "Ошибка Supabase" });
  }

  return res.status(200).json(data);
}
