import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalize(str) {
  return str.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeAuthor(str) {
  return normalize(str).split(" ").sort().join(" ");
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: "Метод запрещён" });

  const { title, author, cover_url } = await req.json?.() || await new Response(req.body).json();

  if (!title || !author) return res.status(400).json({ error: "Нет данных" });

  const normTitle = normalize(title);
  const normAuthor = normalizeAuthor(author);

  const { data: existing } = await supabase
    .from("books_library")
    .select("title, author");

  const duplicate = existing.find(
    b => normalize(b.title) === normTitle && normalizeAuthor(b.author) === normAuthor
  );

  if (!duplicate) {
    await supabase.from("books_library").insert([{ title, author, cover_url }]);
  }

  return res.status(200).json({ inserted: !duplicate });
}
