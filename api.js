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

export async function updateBook(id, fields) {
  const res = await fetch("/api/updateBook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...fields }),
  });

  if (!res.ok) {
    console.error("Ошибка при обновлении книги");
  }
}

export async function saveComment(bookId, userId, comment) {
  await fetch("/api/saveComment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, userId, comment }),
  });
}
export async function checkAndInsertLibraryBook(title, author, cover_url) {
  await fetch("/api/checkAndInsertLibraryBook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, author, cover_url }),
  });
}

export async function deleteBook(id) {
  await fetch("/api/deleteBook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function uploadCommentImage(blob) {
  const formData = new FormData();
  formData.append("file", blob, "comment.png");

  const res = await fetch("/api/uploadCommentImage", {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    alert("Ошибка загрузки изображения");
    return "";
  }

  const { url } = await res.json();
  return url || "";
}

export async function deleteImageFromStorage(bucket, fileName) {
  const res = await fetch("/api/deleteImage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ bucket, fileName })
  });

  if (!res.ok) {
    console.warn("Ошибка при удалении изображения");
  }
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

