import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔹 Нормализация
function normalize(str) {
  return str.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeAuthor(str) {
  return normalize(str).split(" ").sort().join(" ");
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Метод запрещён" });
  }

  try {
    const { title, author, cover_url } = req.body;

    if (!title || !author) {
      return res.status(400).json({ error: "Нет данных" });
    }

    const normTitle = normalize(title);
    const normAuthor = normalizeAuthor(author);

    const { data: existing, error } = await supabase
      .from("books_library")
      .select("title, author");

    if (error) {
      console.error("Ошибка при проверке дубликатов:", error);
      return res.status(500).json({ error: "Ошибка базы данных" });
    }

    const duplicate = existing.find(
      b => normalize(b.title) === normTitle && normalizeAuthor(b.author) === normAuthor
    );

    if (!duplicate) {
      const { error: insertError } = await supabase
        .from("books_library")
        .insert([{ title, author, cover_url }]);

      if (insertError) {
        console.error("Ошибка при вставке:", insertError);
        return res.status(500).json({ error: "Ошибка добавления" });
      }
    }

    return res.status(200).json({ inserted: !duplicate });
  } catch (err) {
    console.error("Сбой сервера:", err);
    return res.status(500).json({ error: "Сбой сервера" });
  }
}
