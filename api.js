// 📁 api.js — Подключение к Supabase
export async function getBooks(userId) {
  const res = await fetch(`/api/getBooks?user_id=${userId}`);
  const data = await res.json();
  return data || [];
}

export async function addBook(book) {
  const res = await fetch("/api/addBook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(book),
  });
  if (!res.ok) console.error("❌ Ошибка при добавлении книги");
}

export async function exportBooks(userId) {
  const res = await fetch(`/api/exportBooks?user_id=${userId}`);
  if (!res.ok) {
    console.error("❌ Ошибка при получении данных для экспорта");
    return [];
  }
  return await res.json();
}

export async function uploadExportFile(filename, blob, contentType = "text/csv") {
  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("type", contentType);

  const res = await fetch("/api/uploadExport", {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    console.error("❌ Ошибка загрузки файла");
    return null;
  }

  const { url } = await res.json();
  return url;
}

