import fs from "fs";
import { createReadStream } from "fs";
import { IncomingForm } from "formidable";
import { createClient } from "@supabase/supabase-js";

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const form = new IncomingForm({ multiples: false, keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Ошибка разбора формы:", err);
      return res.status(500).json({ error: "Ошибка формы" });
    }

    const file = files.file;
    if (!file || !file.filepath) {
      return res.status(400).json({ error: "Файл не найден" });
    }

    const fileStream = createReadStream(file.filepath);
    const filename = file.originalFilename || `export-${Date.now()}.csv`;
    const mimetype = file.mimetype || "text/csv";

    try {
      const { error } = await supabase.storage
        .from("exports")
