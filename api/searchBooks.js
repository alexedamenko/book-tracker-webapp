import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  const { query } = req.body;

  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }

  const { data, error } = await supabase
    .from("books_library")
    .select("title, author, cover_url")
    .ilike("title", `%${query}%`)
    .limit(5);

  if (error) {
    console.error("Ошибка поиска:", error);
    return res.status(500).json({ error: 'Ошибка поиска' });
  }

  res.status(200).json({ results: data });
}
