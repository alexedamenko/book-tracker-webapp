// /api/uploadExport.js
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не разрешён' });

  try {
    const Busboy = (await import('busboy')).default;
    const busboy = Busboy({ headers: req.headers });

    const result = { fields: {}, file: null, filename: null, mimetype: null };

    busboy.on('field', (name, val) => { result.fields[name] = String(val || ''); });

    busboy.on('file', (fieldname, file, info) => {
      const chunks = [];
      // busboy v1.x
      const v1name = info?.filename;
      const v1type = info?.mimeType || info?.mimetype;

      file.on('data', (d) => chunks.push(d));
      file.on('end', () => {
        result.file = Buffer.concat(chunks);
        result.filename = v1name || result.fields.filename || `export-${Date.now()}.csv`;
        result.mimetype =
          (result.fields.contentType || v1type || 'application/octet-stream')
            .replace(/;\s*charset=.*$/i, '') + '; charset=utf-8';
      });
    });

    await new Promise((resolve, reject) => {
      busboy.on('finish', resolve);
      busboy.on('error', reject);
      req.pipe(busboy);
    });

    if (!result.file || !result.filename) {
      return res.status(400).json({ error: 'Файл не передан' });
    }

    // папка пользователя
    const userId = result.fields.user_id || req.headers['x-user-id'] || 'unknown_user';
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const finalName = result.filename.replace(/(\.\w+)$/, `-${ts}$1`);
    const path = `${userId}/${finalName}`;

    const { error: upErr } = await supabase.storage
      .from('exports')
      .upload(path, result.file, {
        contentType: result.mimetype,
        upsert: true,
        cacheControl: '3600'
      });

    if (upErr) {
      console.error('Ошибка загрузки в Storage:', upErr);
      return res.status(500).json({ error: 'Ошибка загрузки файла' });
    }

    // публичная ссылка (если бакет приватный — сделаем createSignedUrl на стороне клиента/другого роута)
    const { data: pub } = supabase.storage.from('exports').getPublicUrl(path);
    return res.status(200).json({ url: pub?.publicUrl || null, path });
  } catch (e) {
    console.error('Сбой сервера при загрузке:', e);
    return res.status(500).json({ error: 'Сбой сервера' });
  }
}
