import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  const userId = req.query.user_id?.toString();

  if (!userId) {
    return res.status(400).json({ error: "Не указан user_id" });
  }

  try {
    const { data, error } = await supabase
      .from("user_books")
      .select("title, author, status, rating, started_at, finished_at, added_at, comment")
      .eq("user_id", userId);

    if (error) {
      console.error("Ошибка при экспорте данных:", error);
      return res.status(500).json({ error: "Ошибка Supabase" });
    }

    console.log(`📦 Экспортировано книг: ${data.length} для пользователя ${userId}`);

    return res.status(200).json(data);
  } catch (err) {
    console.error("Сбой сервера при экспорте:", err);
    return res.status(500).json({ error: "Сбой сервера" });
  }
}
