// 📁 api/uploadExport.js
import formidable from "formidable";
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false
  }
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Ошибка разбора формы:", err);
      return res.status(500).json({ error: "Ошибка формы" });
    }

    const file = files.file?.[0];
    const filename = file.originalFilename;
    const mimetype = file.mimetype;
    const stream = file.filepath ? require("fs").createReadStream(file.filepath) : null;

    if (!stream) return res.status(400).json({ error: "Файл не найден" });

    const { error } = await supabase.storage
      .from("exports")
      .upload(filename, stream, {
        cacheControl: '3600',
        upsert: true,
        contentType: mimetype
      });

    if (error) {
      console.error("Ошибка загрузки в Supabase:", error);
      return res.status(500).json({ error: "Ошибка загрузки" });
    }

    const { data } = supabase.storage.from("exports").getPublicUrl(filename);
    return res.status(200).json({ url: data.publicUrl });
  });
}
