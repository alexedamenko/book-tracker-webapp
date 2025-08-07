
import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: false, // нужен для обработки форм с файлами
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешён' });
  }

  try {
    const formData = await new Promise((resolve, reject) => {
      const busboy = Busboy({ headers: req.headers });
      const result = {};

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

    const ext = formData.filename.split('.').pop() || 'png';
    const fileName = `${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from('comments')
      .upload(fileName, formData.file, {
        contentType: formData.mimetype,
        upsert: false,
      });

    if (error) {
      console.error('Ошибка загрузки:', error);
      return res.status(500).json({ error: 'Ошибка при загрузке' });
    }

    const { data } = supabase.storage.from('comments').getPublicUrl(fileName);
    return res.status(200).json({ url: data?.publicUrl });
  } catch (e) {
    console.error('Ошибка:', e);
    return res.status(500).json({ error: 'Сбой сервера' });
  }
}
