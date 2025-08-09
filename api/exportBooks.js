import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** ✅ Разрешённые поля (белый список) */
const WHITELIST = [
  'title', 'author', 'status', 'rating',
  'started_at', 'finished_at', 'added_at',
  'comment', 'category', 'tags', 'id', 'cover_url'
];

/** ✅ Набор по умолчанию — жёстко зафиксируй тут нужные колонки и порядок */
const DEFAULT_FIELDS = [
  'title', 'author', 'status', 'rating',
  'started_at', 'finished_at', 'comment'
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  const userId = req.query.user_id?.toString();
  const format = (req.query.format || 'csv').toString().toLowerCase(); // csv | json

  if (!userId) return res.status(400).json({ error: 'Не указан user_id' });

  // 🧰 поля из query (опционально) → фильтруем по whitelist; иначе берём дефолт
  const fieldsParam = (req.query.fields || '').toString();
  const requested = fieldsParam
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const fields = (requested.length
      ? requested.filter(f => WHITELIST.includes(f))
      : DEFAULT_FIELDS
    );

  if (!fields.length) {
    return res.status(400).json({ error: 'Нет валидных полей для экспорта' });
  }

  try {
    // Загружаем только нужные колонки
    const selectClause = fields.join(', ');
    const { data, error } = await supabase
      .from('user_books')
      .select(selectClause)
      .eq('user_id', userId);

    if (error) {
      console.error('Ошибка при экспорте данных:', error);
      return res.status(500).json({ error: 'Ошибка Supabase' });
    }

    // ---------- подготовка файла ----------
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `books-${userId}-${ts}.${format}`;

    let content;
    let contentType;

    if (format === 'json') {
      // Формируем объекты только с выбранными полями
      const slim = (data ?? []).map(row => {
        const out = {};
        for (const f of fields) out[f] = row?.[f] ?? '';
        return out;
      });
      content = Buffer.from(JSON.stringify(slim, null, 2), 'utf8');
      contentType = 'application/json; charset=utf-8';
    } else {
      // CSV + BOM для Excel; хедер = имена полей (можешь заменить на русские подписи)
      const header = fields;
      const rows = (data ?? []).map(row =>
        header.map(f => `"${String(row?.[f] ?? '').replace(/"/g, '""')}"`).join(',')
      );
      const bom = '\uFEFF';
      const csv = bom + [header.join(','), ...rows].join('\n');
      content = Buffer.from(csv, 'utf8');
      contentType = 'text/csv; charset=utf-8';
    }

    // ---------- сохраняем копию в Supabase Storage ----------
    const bucket = 'exports'; // приватный или публичный — как у тебя настроено
    const path = `${userId}/${filename}`;
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, content, { contentType, upsert: true });
    if (upErr) console.warn('⚠️ Не удалось сохранить копию в Storage:', upErr);

    // ---------- форс-скачивание ----------
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(content);
  } catch (e) {
    console.error('Сбой сервера при экспорте:', e);
    return res.status(500).json({ error: 'Сбой сервера' });
  }
}

