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
      busboy.on('file', (fieldname, file, fileInfo) => {
        const buffers = [];

        file.on('data', data => buffers.push(data));
        file.on('end', () => {
          result.file = Buffer.concat(buffers);

          // 🔥 Поддержка новых и старых версий busboy
          if (typeof fileInfo === 'string') {
            result.filename = fileInfo;
            result.mimetype = "application/octet-stream";
          } else {
            result.filename = fileInfo?.filename || `export-${Date.now()}.csv`;
            result.mimetype = fileInfo?.mimeType || "text/csv";
          }
        });
      });

      busboy.on('finish', () => resolve(result));
      req.pipe(busboy);
    });

    if (!result.file || typeof result.filename !== 'string') {
      console.error("❌ Некорректный файл или имя:", result.filename);
      return res.status(400).json({ error: 'Файл не передан или имя некорректно' });
    }

    const { error } = await supabase.storage
      .from("exports")
      .upload(result.filename, result.file, {
        cacheControl: "3600",
        upsert: true,
        contentType: result.mimetype,
      });

    if (error) {
      console.error("Ошибка загрузки в Supabase:", error);
      return res.status(500).json({ error: "Ошибка загрузки файла" });
    }

    const { data } = supabase.storage.from("exports").getPublicUrl(result.filename);
    return res.status(200).json({ url: data?.publicUrl });
  } catch (err) {
    console.error("Сбой сервера при загрузке:", err);
    return res.status(500).json({ error: "Сбой сервера" });
  }
}
