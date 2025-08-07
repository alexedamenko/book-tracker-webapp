import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: "Метод запрещён" });

  const { id } = await req.json?.() || await new Response(req.body).json();

  if (!id) return res.status(400).json({ error: "Не передан ID" });

  const { error } = await supabase.from("user_books").delete().eq("id", id);

  if (error) return res.status(500).json({ error: "Ошибка при удалении" });

  return res.status(200).json({ success: true });
}
