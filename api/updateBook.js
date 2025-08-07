import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  const { id, ...fields } = await req.json?.() || await new Response(req.body).json();

  if (!id) {
    return res.status(400).json({ error: "Не указан ID книги" });
  }

  const { error } = await supabase
    .from("user_books")
    .update(fields)
    .eq("id", id);

  if (error) {
    console.error("Ошибка при обновлении:", error);
    return res.status(500).json({ error: "Не удалось обновить" });
  }

  return res.status(200).json({ success: true });
}
