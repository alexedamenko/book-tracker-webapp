import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  try {
    const { bucket, fileName } = req.body;

    if (!bucket || !fileName || typeof bucket !== 'string' || typeof fileName !== 'string') {
      return res.status(400).json({ error: 'Некорректные данные' });
    }

    const { error } = await supabase.storage
      .from(bucket)
      .remove([fileName]);

    if (error) {
      console.error("Ошибка при удалении файла:", error);
      return res.status(500).json({ error: 'Ошибка при удалении' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Сбой сервера:", err);
    return res.status(500).json({ error: 'Сбой сервера' });
  }
}
