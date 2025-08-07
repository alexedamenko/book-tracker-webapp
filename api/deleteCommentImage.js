import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  const { url } = req.body;
  if (!url || !url.includes("/comments/")) {
    return res.status(400).json({ error: 'Некорректный URL' });
  }

  try {
    const fileName = decodeURIComponent(url.split("/").pop());

    const { error } = await supabase.storage
      .from("comments")
      .remove([fileName]);

    if (error) {
      console.error("Ошибка удаления:", error);
      return res.status(500).json({ error: 'Ошибка удаления' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Ошибка обработки удаления:", err);
    return res.status(500).json({ error: 'Сбой сервера' });
  }
}
