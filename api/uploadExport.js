import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  try {
    const Busboy = (await import('busboy')).default;
    const busboy = Busboy({ headers: req.headers });

    const result = {};

    const formData = await new Promise((resolve, reject) => {
      busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
        const buffers = [];
        file.on('data', data => buffers.push(data));
        file.on('end', () => {
          result.file = Buffer.concat(buffers);
          result.filename = filename;
          result.mimetype = mimetype;
        });
      });

      busboy.on('finish', () => resolve(result));
      req.pipe(busboy);
    });

    // 🛡 Защита от невалидных данных
    if (!result.file || typeof result.filename !== 'string') {
      console.error("❌ Некорректный файл или имя:", result.filename);
      return res.status(400).json({ error: 'Файл не передан или имя некорректно' });
    }

    const fileName = result.filename || `export-${Date.now()}.csv`;

    const { error } = await supabase.storage
      .from("exports")
      .upload(fileName, result.file, {
        ca
