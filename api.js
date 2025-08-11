// 📁 api.js — Подключение к Supabase
export async function getBooks(userId) {
  const res = await fetch(`/api/handler?route=getBooks&user_id=${encodeURIComponent(userId)}`);
  if (!res.ok) {
    console.error("Ошибка при получении книг");
    return [];
  }
  return await res.json();
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

export async function searchBooks(query) {
  const res = await fetch(`/api/handler?route=searchBooks&query=${encodeURIComponent(query)}`);
  if (!res.ok) {
    console.error("Ошибка при поиске книг");
    return [];
  }
  return await res.json();
}
export async function addBook(book) {
  const r = await fetch('/api/handler?route=addBook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(book)
  });
  const j = await r.json();
  return j?.id || null;
}

export async function deleteImageFromStorage(bucket, fileName) {
  const res = await fetch("/api/deleteImageFromStorage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, fileName })
  });

  if (!res.ok) {
    console.error("Ошибка при удалении из", bucket, fileName);
  }
}


export async function uploadCover(file) {
  if (!file) return "";

  const formData = new FormData();
  formData.append("file", file, file.name);

  const res = await fetch("/api/uploadCover", {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    alert("❌ Ошибка загрузки обложки");
    return "";
  }

  const { url } = await res.json();
  return url || "";
}

export async function deleteCommentImage(url) {
  const res = await fetch("/api/deleteCommentImage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });

  if (!res.ok) {
    console.error("Не удалось удалить картинку", url);
  }
}

export async function uploadExport(userId, filename, blob, contentType) {
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('filename', filename);
  form.append('contentType', `${contentType}; charset=utf-8`);
  form.append('user_id', userId); // 👈 важно для подпапки

  const res = await fetch('/api/uploadExport', { method: 'POST', body: form });
  const data = await res.json(); // тут точно JSON
  return data?.url || null;
}

export async function listCollections(userId) {
  const r = await fetch(`/api/handler?route=listCollections&user_id=${encodeURIComponent(userId)}`);
  return r.ok ? r.json() : [];
}

export async function createCollection(userId, name, icon = '', color = '') {
  const r = await fetch('/api/handler?route=createCollection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, name, icon, color })
  });
  return r.ok ? r.json() : null; // {id}
}

export async function renameCollection(id, fields) {
  await fetch('/api/handler?route=renameCollection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...fields })
  });
}

export async function deleteCollection(id) {
  await fetch('/api/handler?route=deleteCollection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
}

export async function setBookCollections(userId, bookId, collectionIds) {
  await fetch('/api/handler?route=setBookCollections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, book_id: bookId, collection_ids: collectionIds })
  });
}

export async function listBookCollections(bookId) {
  const r = await fetch(`/api/handler?route=listBookCollections&book_id=${encodeURIComponent(bookId)}`);
  return r.ok ? r.json() : [];
}

export async function listAllBookCollections(userId) {
  const r = await fetch(`/api/handler?route=listAllBookCollections&user_id=${encodeURIComponent(userId)}`);
  return r.ok ? r.json() : [];
}

