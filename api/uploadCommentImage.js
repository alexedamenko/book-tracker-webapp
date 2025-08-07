import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// отключаем встроенный парсер body
export const config = {
  api: {
    bodyParser: false,
  },
};

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
        file.on('data', (data) => buffers.push(data));
        file.on('end', () => {
          result.file = Buffer.concat(buffers);
          result.filename = filename;
          result.mimetype = mimetype;
        });
      });

      busboy.on('finish', () => resolve(result));
      req.pipe(busboy);
    });

    // Безопасное определение расширения файла
    let ext = "png";
    if (result.filename && typeof result.filename === "string") {
      const parts = result.filename.split(".");
      ext = parts.length > 1 ? parts.pop() : "png";
    }

    const fileName = `${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from("comments")
      .upload(fileName, result.file, {
        cacheControl: "3600",
        upsert: false,
        contentType: result.mimetype,
      });

    if (error) {
      console.error("Ошибка загрузки:", error);
      return res.status(500).json({ error: "Ошибка загрузки файла" });
    }

    const { data } = supabase.storage.from("comments").getPublicUrl(fileName);
    return res.status(200).json({ url: data?.publicUrl });
  } catch (err) {
    console.error("Сбой сервера:", err);
    return res.status(500).json({ error: "Сбой сервера" });
  }
}
