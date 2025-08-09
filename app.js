// 📁 app.js — Основная логика WebApp

// 🛠 Импорт основных функций API и подключения к Supabase
import {
  getBooks,
  addBook,
  uploadExport,
  exportBooks,
  updateBook,
  deleteBook,
  saveComment,
  checkAndInsertLibraryBook,
  deleteImageFromStorage,
  uploadCover,
  searchBooks,
  deleteCommentImage,
  uploadCommentImage
} from './api.js';

// ✅ Инициализация WebApp Telegram (и демо-режим локально)
const tg = window.Telegram?.WebApp;
let userId;

if (tg && tg.initDataUnsafe?.user?.id) {
  tg.ready();
  userId = tg.initDataUnsafe.user.id.toString();
} else {
  console.warn("Demo mode: running outside Telegram");
  userId = "demo_user_001";
}


// 📚 Хранилище текущего списка книг и активной вкладки
let books = [];
let currentTab = "read";

// 🔁 Основная функция отрисовки экрана с книгами
window.renderMainScreen = async function () {
  books = await getBooks(userId);
  window.books = books;
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
      <button onclick="showSearch()">🔍 Поиск</button>
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

// Берём уже загруженный список (если пусто — подстрахуемся повторной загрузкой)
const data = (books && books.length) ? books : await getBooks(userId);
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
    <div class="book-card" data-book-id="${book.id}">
      <img src="${book.cover_url}" alt="${book.title}" onclick="showZoom('${book.cover_url}')" />

      <div class="info">
        <div class="card-actions-top">
          <button class="icon-btn" onclick="editBook('${book.id}')">✏️</button>
          <button class="icon-btn" onclick="deleteBook('${book.id}')">🗑️</button>
        </div>
        <div class="main-block">
          <b class="book-title multi">${book.title}</b>
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

// 📖 Просмотр карточки книги
window.openBook = function (id) {
  window.prevTabOnOpen = currentTab;   // откуда пришли
  window.lastOpenedBookId = id;               // что открывали
  const book = books.find(b => String(b.id) === String(id));
  if (!book) { alert("Книга не найдена"); return; }

  const container = document.getElementById("app");
  container.innerHTML = `
    <div id="book-list">
      ${renderBookCard(book)}
    </div>

    <div class="footer-buttons" style="margin-top: 12px;">
      <button onclick="focusBookInList('${book.id}')">← Назад</button>
    </div>
  `;
  // чтобы после перехода всё было видно
  window.scrollTo({ top: 0, behavior: "instant" });
};



// ➕ Показ формы добавления книги
window.showAddForm = function() {
  const container = document.getElementById("app");
  container.innerHTML = `
    <h2>➕ Добавление книги</h2>
    <form class="add-book-form" onsubmit="submitAddForm(event)">
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
await checkAndInsertLibraryBook(title, author, coverUrl);

  // 📌 Добавляем книгу в трекер
  await addBook(book);
  currentTab = book.status;
  renderMainScreen();
};

// ✏️ Автозаполнение полей книги
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
await focusBookInList(book.id || window.lastOpenedBookId); 
  });
};


// 🗑 Удаление книги
window.deleteBook = async function(id) {
  const book = books.find(b => b.id === id);
  const confirmDelete = confirm("Удалить эту книгу? Это действие нельзя отменить.");
  if (!confirmDelete) return;

  // удаляем картинки из комментариев
if (book?.comment) {
  const images = (book.comment.match(/https?:\/\/[^\s)]+/g) || []).filter(url =>
    url.includes("/comments/")
  );

  for (const imgUrl of images) {
    await deleteCommentImage(imgUrl);
  }
}


  // удаляем запись из базы
await deleteBook(id);
  
alert("🗑 Книга удалена");
  await renderMainScreen();
};


// 📊 Простейшая статистика по месяцам (сколько книг завершено в месяц)
window.showStats = function () {
  const container = document.getElementById("app");

  // Берём из уже загруженного массива books только завершённые
  const finished = books
    .filter(b => b.finished_at)
    .map(b => b.finished_at.slice(0, 7)); // 'YYYY-MM'

  // Группировка: { '2025-01': 3, ... }
  const byMonth = finished.reduce((acc, ym) => {
    acc[ym] = (acc[ym] || 0) + 1;
    return acc;
  }, {});

  // Превратим в массив и отсортируем по дате
  const rows = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));

  // Максимум для «баров»
  const max = rows.length ? Math.max(...rows.map(([, n]) => n)) : 0;

  container.innerHTML = `
    <h2>📊 Статистика чтения</h2>
    ${rows.length ? `
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${rows.map(([ym, n]) => {
          const width = max ? Math.round((n / max) * 100) : 0;
          return `
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:90px; font-family:monospace;">${ym}</div>
              <div style="flex:1; background:#eee; border-radius:6px; height:12px; overflow:hidden;">
                <div style="width:${width}%; height:100%; background:#007aff;"></div>
              </div>
              <div style="width:28px; text-align:right;">${n}</div>
            </div>
          `;
        }).join("")}
      </div>
    ` : `<p>Пока нет завершённых книг — нечего показать.</p>`}

    <div class="footer-buttons">
      <button onclick="renderMainScreen()">← Назад</button>
    </div>
  `;
};





// 🔍 Вкладка "Поиск" — только строка + автодополнение по локальным книгам
window.showSearch = async function () {
  const container = document.getElementById("app");

  // Загружаем книги 1 раз, если ещё не загружены
  if (!window.books || window.books.length === 0) {
    window.books = await getBooks(userId);
  }

  container.innerHTML = `
    <h2>🔍 Поиск</h2>

    <div id="searchWrap" style="position:relative; margin-bottom:12px;">
      <input id="searchInput" placeholder="Начни вводить название или автора…" autocomplete="off"
        style="width:100%; padding:10px 12px; border-radius:8px; border:1px solid #ccc; outline:none;" />

      <div id="typeahead"
        style="position:absolute; z-index:1000; top:100%; left:0; right:0;
               background:#fff; border:1px solid #ddd; border-top:none; border-radius:0 0 8px 8px;
               max-height:280px; overflow-y:auto; display:none; box-shadow:0 8px 24px rgba(0,0,0,.06);">
      </div>
    </div>

    <div class="footer-buttons">
      <button onclick="renderMainScreen()">← Назад</button>
    </div>
  `;

  const input = document.getElementById("searchInput");
  const dd    = document.getElementById("typeahead");

  // ---------- utils ----------
  const norm = (s) => (s ?? "").toString().toLowerCase().replaceAll("ё","е").trim();
  const esc  = (s="") => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function highlight(text, q) {
    const base = esc(text || "");
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return base;
    const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join("|");
    return base.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
  }

  // Поиск по title+author(+category/note/tags) c AND-логикой; топ-10
  function searchLocal(q) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];

    return window.books
      .map(b => {
        const hay = norm([b.title, b.author, b.category, b.note, Array.isArray(b.tags)? b.tags.join(" "):""].join("  "));
        const ok = terms.every(t => hay.includes(t));
        if (!ok) return null;

        // простая релевантность: раньше вхождение в title — выше
        const idxTitle  = norm(b.title || "").indexOf(norm(q));
        const idxAuthor = norm(b.author || "").indexOf(norm(q));
        const score = (idxTitle === -1 ? 1000 : idxTitle) + (idxAuthor === -1 ? 500 : idxAuthor);
        return { b, score };
      })
      .filter(Boolean)
      .sort((a,b) => a.score - b.score)
      .slice(0, 10)
      .map(x => x.b);
  }

  // ---------- dropdown render + поведение ----------
  let suggestions = [];
  let active = -1; // индекс подсвеченного элемента

  function hideDD() { dd.style.display = "none"; active = -1; }
  function showDD() { dd.style.display = suggestions.length ? "block" : "none"; }

  function renderDD(q) {
    if (!suggestions.length) {
      dd.innerHTML = `<div style="padding:10px 12px; color:#777;">Ничего не найдено</div>`;
      dd.style.display = "block";
      return;
    }
    dd.innerHTML = suggestions.map((b, i) => `
      <div class="ta-item" data-id="${b.id}"
           style="display:flex; gap:10px; align-items:center; padding:10px 12px; cursor:pointer;
                  ${i===active ? 'background:#f5f7ff;' : ''}">
        ${b.cover_url ? `<img src="${esc(b.cover_url)}" alt="" style="width:32px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #eee;">` : ''}
        <div style="min-width:0;">
          <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${highlight(b.title, q)}
          </div>
          <div style="font-size:12px; opacity:.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${highlight(b.author || "", q)}
          </div>
        </div>
      </div>
    `).join("");

    // клики по пунктам
    dd.querySelectorAll(".ta-item").forEach((el, i) => {
      el.addEventListener("mouseenter", () => { active = i; paintActive(); });
      el.addEventListener("mousedown", (e) => { // mousedown, чтобы не потерять фокус до click
        e.preventDefault();
        const id = el.getAttribute("data-id");
        if (typeof openBook === "function") openBook(id);
      });
    });

    showDD();
  }

  function paintActive() {
    [...dd.children].forEach((el, i) => {
      el.style.background = (i===active) ? "#f5f7ff" : "";
    });
  }

  const debouncedSearch = (fn => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), 180); };
  })(q => {
    if (q.length < 2) { hideDD(); return; }
    suggestions = searchLocal(q);
    active = suggestions.length ? 0 : -1;
    renderDD(q);
    paintActive();
  });

  // ---------- handlers ----------
  input.addEventListener("input", (e) => debouncedSearch(e.target.value));
  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 2) { suggestions = searchLocal(input.value); renderDD(input.value); paintActive(); }
  });
  input.addEventListener("keydown", (e) => {
    const q = input.value.trim();
    if (e.key === "ArrowDown") {
      if (!suggestions.length) return;
      e.preventDefault();
      active = (active + 1) % suggestions.length; paintActive();
      dd.children[active]?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "ArrowUp") {
      if (!suggestions.length) return;
      e.preventDefault();
      active = (active - 1 + suggestions.length) % suggestions.length; paintActive();
      dd.children[active]?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter") {
      if (active >= 0 && suggestions[active]) {
        e.preventDefault();
        const id = suggestions[active].id;
        if (typeof openBook === "function") openBook(id);
      }
    }
    if (e.key === "Escape") {
      input.value = "";
      hideDD();
    }
  });

  // клик вне — закрыть список
  document.addEventListener("click", (e) => {
    if (!document.getElementById("searchWrap")) return; // экран сменили
    if (!document.getElementById("searchWrap").contains(e.target)) hideDD();
  }, { capture: true });
};

window.lastOpenedBookId = null;

window.focusBookInList = async function (bookId) {
  // обновим данные (на случай редактирования/удаления)
  books = await getBooks(userId);

  // 👉 случай удаления или «просто вернуться»
  if (!bookId) {
    if (window.prevTabOnOpen) window.currentTab = window.prevTabOnOpen; // вернуться туда, откуда пришли
    await renderMainScreen();
    window.prevTabOnOpen = null;
    return;
  }

  // 👉 обычный случай: вернуться к книге, переключив вкладку по её актуальному статусу
  const book = books.find(b => String(b.id) === String(bookId));
  await renderMainScreen(); // на всякий случай отрисуем, если не нашли книгу
  if (!book) return;

  currentTab = book.status || currentTab;
  await renderMainScreen();

  // подсветка и прокрутка к книге
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const el = document.querySelector(`[data-book-id="${bookId}"]`);
  if (el) {
    el.classList.add('book-focus');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => el.classList.remove('book-focus'), 1600);
  }
};

  





  // ✅ Жёсткий набор колонок и порядок
const EXPORT_COLS = [
  { key: 'title',       label: 'Название',   get: b => b.title ?? '' },
  { key: 'author',      label: 'Автор',      get: b => b.author ?? '' },
  { key: 'status',      label: 'Статус',     get: b => b.status ?? '' },
  { key: 'rating',      label: 'Оценка',     get: b => b.rating ?? '' },
  { key: 'started_at',  label: 'Начал',      get: b => b.started_at ?? '' },
  { key: 'finished_at', label: 'Закончил',   get: b => b.finished_at ?? '' },
  { key: 'comment',     label: 'Комментарий',get: b => (b.comment ?? '').replace(/\r?\n/g,' ') },
  // при желании добавь: category, tags, added_at и т.д.
];
// 📤 Экспорт в CSV/JSON
  
function escapeCsv(v) {
  return `"${String(v ?? '').replace(/"/g,'""')}"`;
}
async function exportToCSV(data) {
  if (!data?.length) { alert("Нет данных для экспорта"); return; }
  const header = EXPORT_COLS.map(c => c.label);
  const rows = data.map(b => EXPORT_COLS.map(c => escapeCsv(c.get(b))));
  const bom = "\uFEFF";
  const csvContent = bom + [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  await uploadAndShare(csvContent, `books-${userId}.csv`, 'text/csv');
}

async function exportToJSON(data) {
  const slim = (data ?? []).map(b =>
    Object.fromEntries(EXPORT_COLS.map(c => [c.key, c.get(b)]))
  );
  const jsonContent = JSON.stringify(slim, null, 2);
  await uploadAndShare(jsonContent, `books-${userId}.json`, 'application/json');
}

// ☁️ Загрузка и скачивание файла экспорта (Telegram-friendly)
async function uploadAndShare(content, filename, type) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const finalName = filename.replace(/(\.\w+)$/, `-${ts}$1`);
  const blob = new Blob([content], { type: `${type}; charset=utf-8` });

  // 👇 твоя функция: теперь сигнатура uploadExportFile(userId, ...)
  const publicUrl = await uploadExport(userId, finalName, blob, type);
  if (!publicUrl) {
    alert("❌ Ошибка при экспорте файла");
    return;
  }

  // форс-скачивание
  const dlUrl = publicUrl + (publicUrl.includes("?") ? "&" : "?") +
                "download=" + encodeURIComponent(finalName);

  // 🔑 КЛЮЧЕВОЕ: на мобилках открываем внешним браузером
  const tg = window.Telegram?.WebApp;
  if (tg?.openLink) {
    tg.openLink(dlUrl); // откроет Safari/Chrome с нормальным диалогом скачивания
  } else {
    // десктоп/обычный браузер
    window.open(dlUrl, "_blank", "noopener,noreferrer");
  }
}


renderMainScreen();

// 📸 Удаление изображения из Supabase Storage по URL
async function deleteImageFromSupabase(imageUrl) {
  try {
    if (!imageUrl.includes("/comments/")) return;

    const fileName = decodeURIComponent(imageUrl.split("/").pop());
    await deleteImageFromStorage("comments", fileName);
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
      const url = await uploadCommentImage(blob);
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

