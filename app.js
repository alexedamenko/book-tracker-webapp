// 📁 app.js — Основная логика WebApp

// 🛠 Импорт основных функций API и подключения к Supabase
import {
  getBooks,
  addBook,
  uploadExportFile,
  exportBooks,
  updateBook,
  deleteBook,
  saveComment,
  checkAndInsertLibraryBook
} from './api.js';

// ✅ Инициализация WebApp Telegram и проверка запуска внутри Telegram
Telegram.WebApp.ready();
if (!Telegram.WebApp.initDataUnsafe?.user?.id) {
  alert("❗ Пожалуйста, открой приложение через Telegram");
  throw new Error("WebApp запущен вне Telegram");
}
const userId = Telegram.WebApp.initDataUnsafe.user.id.toString();

// 📚 Хранилище текущего списка книг и активной вкладки
let books = [];
let currentTab = "read";

// 🔁 Основная функция отрисовки экрана с книгами
window.renderMainScreen = async function () {
  books = await getBooks(userId);
  const container = document.getElementById("app");
  const filtered = books.filter(b => b.status === currentTab);

  container.innerHTML = `
    <h2>📘 Мой книжный трекер</h2>

    <div class="nav-tabs">
      <div class="nav-tab ${currentTab === 'reading' ? 'active' : ''}" onclick="switchTab('reading')">Читаю</div>
      <div class="nav-tab ${currentTab === 'read' ? 'active' : ''}" onclick="switchTab('read')">Прочитал</div>
      <div class="nav-tab ${currentTab === 'want_to_read' ? 'active' : ''}" onclick="switchTab('want_to_read')">Хочу прочитать</div>
    </div>

    <button onclick="showAddForm()">+ Добавить книгу</button>

    <div id="book-list">
      ${filtered.length > 0 ? filtered.map(renderBookCard).join("") : "<p>📭 Нет книг в этой категории</p>"}
    </div>

    <div class="footer-buttons">
      <button id="exportBtn">📤Export</button>
      <div id="formatMenu" class="hidden">
        <div class="format-option" data-format="csv">CSV</div>
        <div class="format-option" data-format="json">JSON</div>
      </div>
      <button onclick="showStats()">📊 Статистика</button>
      <button onclick="showSearch()">🔍 Поиск / рекомендации</button>
    </div>
  `;

  // ⬇️ Назначение обработчиков на кнопки экспорта
  document.getElementById("exportBtn").addEventListener("click", () => {
    document.getElementById("formatMenu").classList.toggle("hidden");
  });

  document.querySelectorAll(".format-option").forEach(option => {
    option.addEventListener("click", async () => {
      const format = option.getAttribute("data-format");
      document.getElementById("formatMenu").classList.add("hidden");

      const data = await exportBooks(userId);
if (!data || !data.length) {
  alert("Нет данных для экспорта");
  return;
}

      if (format === "csv") exportToCSV(data);
      if (format === "json") exportToJSON(data);
    });
  });
}


// ☑️ Переключение вкладки
window.switchTab = function (tab) {
  currentTab = tab;
  renderMainScreen();
};

// 📷 Зум обложки (одна функция вместо трёх)
window.showZoom = function (url) {
  const overlay = document.getElementById("zoom-overlay");
  const img = document.getElementById("zoom-image");
  img.src = url;
  overlay.classList.remove("hidden");
};

window.closeZoom = function () {
  document.getElementById("zoom-overlay").classList.add("hidden");
};

// 🧩 Отрисовка карточки книги (обложка, название, рейтинг, даты и заметка)
function renderBookCard(book) {
   return `
    <div class="book-card">
      <img src="${book.cover_url}" alt="${book.title}" onclick="showZoom('${book.cover_url}')" />
      
      <div class="info">
       <div class="card-actions-top">
          <button class="icon-btn" onclick="editBook('${book.id}')">✏️</button>
          <button class="icon-btn" onclick="deleteBook('${book.id}')">🗑️</button>
        </div>
        <div class="main-block">
          <b class="book-title">${book.title}</b>
          <i class="book-author">${book.author}</i>
          ${book.rating ? `<div class="stars">${renderStars(book.rating)}</div>` : ""}
          ${book.started_at ? `<div>📖 ${book.started_at}</div>` : ""}
          ${book.finished_at ? `<div>🏁 ${book.finished_at}</div>` : ""}
          <div class="comment-preview">
            <button onclick="openComment('${book.id}')">💬 Заметки/Выводы</button>
                  </div>
              </div>
         </div>
    </div>
  `;
}

// ⭐ Отображение рейтинга в виде звёздочек
function renderStars(rating = 0) {
  const fullStar = '★';
  const emptyStar = '☆';
  return [...Array(5)].map((_, i) => i < rating ? fullStar : emptyStar).join('');
}

// ➕ Показ формы добавления книги
window.showAddForm = function() {
  const container = document.getElementById("app");
  container.innerHTML = `
    <h2>➕ Добавление книги</h2>
    <form class="add-book-form" onsubmit="(event)">
      <div class="form-block">
        <label>Название книги</label>
        <input type="text" id="title" required autocomplete="off" />
        <div id="suggestions" class="suggestions-list"></div>
      </div>

      <div class="form-block">
        <label>Автор</label>
        <input type="text" id="author" required />
      </div>

      <div class="form-block">
        <label>Обложка</label>
        <input type="file" id="cover_file" accept="image/*" />
        <input type="url" id="cover_url" placeholder="Ссылка на обложку (необязательно)" />
        <img id="coverPreview" 
             style="
               max-height: 140px;
               max-width: 100%;
               margin-top: 8px;
               display: none;
               object-fit: contain;
               border-radius: 8px;
               box-shadow: 0 2px 6px rgba(0,0,0,0.15);
             " />
      </div>

      <div class="form-block">
        <label>Статус</label>
        <select id="status">
          <option value="want_to_read">Хочу прочитать</option>
          <option value="reading">Читаю</option>
          <option value="read">Прочитал</option>
        </select>
      </div>

      <div class="form-block">
        <label>Оценка</label>
        <select id="rating">
          <option value="">Без оценки</option>
          ${[1, 2, 3, 4, 5].map(n => `<option value="${n}">⭐ ${n}</option>`).join("")}
        </select>
      </div>

      <div class="form-block date-group">
        <label>Дата начала</label>
        <input type="date" id="started_at" />
        <label>Дата окончания</label>
        <input type="date" id="finished_at" />
      </div>

      <div class="form-buttons">
        <button type="submit" class="save-btn">💾 Сохранить</button>
        <button type="button" class="back-btn" onclick="renderMainScreen()">← Назад</button>
      </div>
    </form>
  `;

  // 🔍 Автопоиск книг
  document.getElementById("title").addEventListener("input", handleBookSearch);

  // 📷 Предпросмотр при выборе файла
  document.getElementById("cover_file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const preview = document.getElementById("coverPreview");
      preview.src = URL.createObjectURL(file);
      preview.style.display = "block";
    }
  });

  // 📷 Предпросмотр при вставке URL
  document.getElementById("cover_url").addEventListener("input", (e) => {
    const url = e.target.value.trim();
    const preview = document.getElementById("coverPreview");
    if (url) {
      preview.src = url;
      preview.style.display = "block";
    } else {
      preview.style.display = "none";
    }
  });

  // Дата Прочтения
  document.getElementById("status").addEventListener("change", () => {
  const status = document.getElementById("status").value;
  const finishedInput = document.getElementById("finished_at");

  if (status === "read" && !finishedInput.value) {
    const today = new Date().toISOString().split("T")[0];
    finishedInput.value = today;
  }
});
};


// 📷 Загрузка обложки в Supabase
export async function uploadCover(file) {
  if (!file) return "";

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
  const fileName = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("covers")
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type // 🔹 Обязательно указываем тип файла
    });

  if (error) {
    console.error("Ошибка загрузки обложки:", error);
    alert("Ошибка загрузки обложки");
    return "";
  }

  const { data } = supabase.storage.from("covers").getPublicUrl(fileName);
  return data?.publicUrl || "";
}

// ✅ Обработка добавления новой книги
window.submitAddForm = async function (e) {
  e.preventDefault();
  const tgUser = Telegram.WebApp.initDataUnsafe?.user || {};

  let coverUrl = document.getElementById("cover_url").value.trim();
  const file = document.getElementById("cover_file").files[0];
  if (file) {
    coverUrl = await uploadCover(file);
    if (!coverUrl) {
      alert("❌ Не удалось загрузить обложку. Попробуйте ещё раз.");
      return;
    }
  }

  const status = document.getElementById("status").value;
  const startedAt = document.getElementById("started_at").value || null;
  let finishedAt = document.getElementById("finished_at").value || null;

  if (status === "read" && !finishedAt) {
    finishedAt = new Date().toISOString().split("T")[0];
  }

  const ratingValue = document.getElementById("rating").value;

  // 🔹 Нормализация
  const normalize = (str) =>
    str.trim().replace(/\s+/g, " ").toLowerCase();

  const normalizeAuthor = (str) =>
    normalize(str).split(" ").sort().join(" ");

  const title = document.getElementById("title").value.trim();
  const author = document.getElementById("author").value.trim();

  const normTitle = normalize(title);
  const normAuthor = normalizeAuthor(author);

  const book = {
    id: crypto.randomUUID(),
    user_id: userId,
    username: tgUser?.username || "",
    user_first_name: tgUser?.first_name || "",
    title,
    author,
    cover_url: coverUrl || "",
    status,
    rating: ratingValue ? Number(ratingValue) : null,
    added_at: new Date().toISOString().split("T")[0],
    started_at: startedAt,
    finished_at: finishedAt
  };

  // 📌 Проверка в books_library без дублей
  const { data: existing, error: searchError } = await supabase
    .from("books_library")
    .select("id, title, author")
    .limit(100); // ограничим запрос

  if (searchError) {
    console.error("Ошибка проверки в books_library:", searchError);
  } else {
    const duplicate = existing.find(
      b => normalize(b.title) === normTitle && normalizeAuthor(b.author) === normAuthor
    );

    if (!duplicate) {
      const { error: insertError } = await supabase
        .from("books_library")
        .insert([{
          title,
          author,
          cover_url: coverUrl || null
        }]);
      if (insertError) {
        console.error("Ошибка добавления в books_library:", insertError);
      }
    }
  }

  // 📌 Добавляем книгу в трекер
  await addBook(book);
  currentTab = book.status;
  renderMainScreen();
};

// ✏️ Автозаполнение полей книги
async function searchBooks(query) {
  const { data, error } = await supabase
    .from("books_library") // таблица всех книг
    .select("title, author, cover_url")
    .ilike("title", `%${query}%`)
    .limit(5);

  return error ? [] : data;
}

async function handleBookSearch(e) {
  const value = e.target.value.trim();
  const list = document.getElementById("suggestions");
  list.innerHTML = "";
  if (value.length < 4) return;

  const suggestions = await searchBooks(value);
  list.innerHTML = suggestions.map(
    book => `<div class="suggestion-item" onclick="selectBook('${book.title}', '${book.author}', '${book.cover_url || ""}')">${book.title} — ${book.author}</div>`
  ).join("");
}

window.selectBook = function(title, author, coverUrl) {
  document.getElementById("title").value = title;
  document.getElementById("author").value = author;
  if (coverUrl) {
    document.getElementById("coverPreview").src = coverUrl;
    document.getElementById("coverPreview").style.display = "block";
    document.getElementById("cover_url").value = coverUrl;
  }
  document.getElementById("suggestions").innerHTML = "";
};

// ✏️ Показ формы редактирования книги
window.editBook = function(id) {
  const book = books.find(b => b.id === id);
  const container = document.getElementById("app");

  container.innerHTML = `
    <h2>✏️ Редактирование книги</h2>
    <form id="editForm" class="add-book-form">

      <div class="form-block">
        <label>Название книги</label>
        <input type="text" id="title" value="${book.title}" required />
      </div>

      <div class="form-block">
        <label>Автор</label>
        <input type="text" id="author" value="${book.author}" required />
      </div>

      <div class="form-block">
        <label>Обложка</label>
        <input type="file" id="cover_file" accept="image/*" />
        <input type="url" id="cover_url" value="${book.cover_url || ''}" />
        <img id="coverPreview" 
             src="${book.cover_url || ''}" 
             style="
               max-height: 140px;
               max-width: 100%;
               margin-top: 8px;
               ${book.cover_url ? '' : 'display:none;'}
               object-fit: contain;
               border-radius: 8px;
               box-shadow: 0 2px 6px rgba(0,0,0,0.15);
             " />
      </div>

      <div class="form-block">
        <label>Статус</label>
        <select id="status">
          <option value="want_to_read" ${book.status === 'want_to_read' ? 'selected' : ''}>Хочу прочитать</option>
          <option value="reading" ${book.status === 'reading' ? 'selected' : ''}>Читаю</option>
          <option value="read" ${book.status === 'read' ? 'selected' : ''}>Прочитал</option>
        </select>
      </div>

      <div class="form-block">
        <label>Оценка</label>
        <select id="rating">
          <option value="">Без оценки</option>
          ${[1,2,3,4,5].map(n => `<option value="${n}" ${book.rating === n ? 'selected' : ''}>⭐ ${n}</option>`).join("")}
        </select>
      </div>

      <div class="form-block date-group">
        <label>Дата добавления</label>
        <input type="date" id="added_at" value="${book.added_at || ''}" />
        <label>Дата начала</label>
        <input type="date" id="started_at" value="${book.started_at || ''}" />
        <label>Дата окончания</label>
        <input type="date" id="finished_at" value="${book.finished_at || ''}" />
      </div>

      <div class="form-buttons">
        <button type="submit" class="save-btn">💾 Сохранить</button>
        <button type="button" class="back-btn" id="backBtn">← Назад</button>
      </div>
    </form>
  `;

  // 📷 Предпросмотр при выборе файла
  document.getElementById("cover_file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById("coverPreview");
    if (file) {
      preview.src = URL.createObjectURL(file);
      preview.style.display = "block";
    }
  });

  // 📷 Предпросмотр при вводе URL
  document.getElementById("cover_url").addEventListener("input", (e) => {
    const url = e.target.value.trim();
    const preview = document.getElementById("coverPreview");
    if (url) {
      preview.src = url;
      preview.style.display = "block";
    } else {
      preview.style.display = "none";
    }
  });
  
  // Дата Прочтения
  document.getElementById("status").addEventListener("change", () => {
  const status = document.getElementById("status").value;
  const finishedInput = document.getElementById("finished_at");

  if (status === "read" && !finishedInput.value) {
    const today = new Date().toISOString().split("T")[0];
    finishedInput.value = today;
  }
});


  // Назад
  document.getElementById("backBtn").addEventListener("click", renderMainScreen);

  // Сохранение
  document.getElementById("editForm").addEventListener("submit", async function(e) {
    e.preventDefault();

    let coverUrl = document.getElementById("cover_url").value.trim();
    const file = document.getElementById("cover_file").files[0];
    if (file) {
      coverUrl = await uploadCover(file);
    }

    const updated = {
      title: document.getElementById("title").value.trim(),
      author: document.getElementById("author").value.trim(),
      cover_url: coverUrl,
      status: document.getElementById("status").value,
      rating: document.getElementById("rating").value ? Number(document.getElementById("rating").value) : null,
      comment: book.comment,
      added_at: document.getElementById("added_at").value || null,
      started_at: document.getElementById("started_at").value || null,
      finished_at: document.getElementById("finished_at").value || null
    };

    await updateBook(id, updated);
renderMainScreen();
  });
};


// 🗑 Удаление книги
window.deleteBook = async function(id) {
  const book = books.find(b => b.id === id);
  const confirmDelete = confirm("Удалить эту книгу? Это действие нельзя отменить.");
  if (!confirmDelete) return;

  // удаляем картинки из комментариев
  if (book?.comment) {
    const images = (book.comment.match(/https?:\/\/[^\s)]+/g) || []).filter(url => url.includes("/comments/"));
    for (const imgUrl of images) {
      await deleteImageFromSupabase(imgUrl);
    }
  }

  // удаляем запись из базы
await deleteBook(id);
  
alert("🗑 Книга удалена");
  await renderMainScreen();
};

// 📤 Экспорт в CSV/JSON
function exportToCSV(data) {
  if (!data || !data.length) return;

  const header = Object.keys(data[0]);
  const rows = data.map(row =>
    header.map(field => `"${(row[field] || "").toString().replace(/"/g, '""')}"`)
  );
  
  // Добавляем BOM (Byte Order Mark) для корректного открытия в Excel
  const bom = "\uFEFF";
  const csvContent = bom + [header.join(","), ...rows.map(r => r.join(","))].join("\n");

  uploadAndShare(csvContent, `books-${userId}.csv`, "text/csv");
}


function exportToJSON(data) {
  const jsonContent = JSON.stringify(data, null, 2);
  uploadAndShare(jsonContent, `books-${userId}.json`, "application/json");
}
// ☁️ Загрузка и открытие файла экспорта
async function uploadAndShare(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = await uploadExportFile(filename, blob, type);

  if (url) {
    alert("✅ Файл готов к скачиванию");
    window.open(url, "_blank");
  } else {
    alert("❌ Ошибка при экспорте файла");
  }
}

renderMainScreen();

// 📸 Удаление изображения из Supabase Storage по URL
async function deleteImageFromSupabase(imageUrl) {
  try {
    if (!imageUrl.includes("/comments/")) return; // только картинки из bucket comments
    const fileName = decodeURIComponent(imageUrl.split("/").pop());
    const { error } = await supabase.storage
      .from("comments")
      .remove([fileName]);
    if (error) console.error("Ошибка удаления файла:", error);
  } catch (err) {
    console.error("Ошибка обработки удаления:", err);
  }
}

// 💬 Открытие/редактирование комментария к книге через Toast UI Editor
window.openComment = function(bookId, readonly = true) {
  const book = books.find(b => b.id === bookId);
  const container = document.getElementById("app");

  container.innerHTML = `
    <h2>💬 Комментарий к книге</h2>
    <b>${book.title}</b> <i>(${book.author})</i><br/><br/>
    <div id="toastEditor"></div>

    <div class="comment-actions">
      ${readonly
        ? `<button onclick="openComment('${bookId}', false)">✏️ Редактировать</button>`
        : `<button onclick="saveComment('${book.id}')">💾 Сохранить</button>`
      }
      <button onclick="renderMainScreen()">← Назад</button>
    </div>
  `;

  if (readonly) {
    toastui.Editor.factory({
      el: document.querySelector('#toastEditor'),
      viewer: true,
      initialValue: book.comment || "Комментарий пока не добавлен."
    });
  } else {
window.toastEditor = new toastui.Editor({
  el: document.querySelector('#toastEditor'),
  height: '400px',
  language: 'ru',
  initialEditType: 'wysiwyg',
  previewStyle: 'vertical',
  initialValue: book.comment || "",
  toolbarItems: [
    ['heading', 'bold', 'italic', 'strike'],
    ['hr', 'quote'],
    ['ul', 'ol', 'task'],
    ['table', 'link', 'image'],
    // 👉 Добавляем кнопки Undo/Redo
    [{
      name: 'undo',
      tooltip: 'Отменить',
      className: 'toastui-editor-toolbar-icons undo',
      command: 'undo',
      text: '↩️'
    },
    {
      name: 'redo',
      tooltip: 'Повторить',
      className: 'toastui-editor-toolbar-icons redo',
      command: 'redo',
      text: '↪️'
    }]
  ],
  hooks: {
    addImageBlobHook: async (blob, callback) => {
      const url = await uploadImageToSupabase(blob);
      callback(url, 'загруженное изображение');
    }
  }
});


    // 💡 Корректировка позиции всплывающих окон
    const fixPopupPosition = () => {
      const popups = document.querySelectorAll('.toastui-editor-popup');
      popups.forEach(popup => {
        const rect = popup.getBoundingClientRect();
if (rect.left < 0 || rect.right > window.innerWidth) {
  const shift = Math.min(Math.abs(rect.left), rect.right - window.innerWidth);
  popup.style.transform = `translateX(${-shift - 12}px)`;
}

      });
    };

    const observer = new MutationObserver(() => fixPopupPosition());
    observer.observe(document.body, { childList: true, subtree: true });

    // также вызываем через timeout (на случай пропуска мутации)
  setTimeout(fixPopupPosition, 300);
  setTimeout(fixPopupPosition, 800); // резервный вызов
  }
};


// сохранение комментария
window.saveComment = async function(bookId) {
  const book = books.find(b => b.id === bookId);
  const oldComment = book?.comment || "";
  const newComment = toastEditor.getMarkdown();

  // находим удалённые картинки
  const oldImages = (oldComment.match(/https?:\/\/[^\s)]+/g) || []).filter(url => url.includes("/comments/"));
  const newImages = (newComment.match(/https?:\/\/[^\s)]+/g) || []).filter(url => url.includes("/comments/"));
  const removedImages = oldImages.filter(url => !newImages.includes(url));

  // удаляем их из storage
  for (const imgUrl of removedImages) {
    await deleteImageFromSupabase(imgUrl);
  }

  // сохраняем новый комментарий
await saveComment(bookId, userId, newComment);

  renderMainScreen();
};

// 📸 Загрузка изображения из комментария в Supabase Storage
async function uploadImageToSupabase(blob) {
  const fileName = `${crypto.randomUUID()}.${blob.type.split("/")[1]}`;
  const { error } = await supabase.storage
    .from("comments")
    .upload(fileName, blob, { upsert: false });

  if (error) {
    alert("Ошибка загрузки изображения");
    return "";
  }

  const { data } = supabase.storage
    .from("comments")
    .getPublicUrl(fileName);

  return data.publicUrl;
}
