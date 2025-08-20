// 📁 app.js — Основная логика WebApp

// 🛠 Импорт основных функций API и подключения к Supabase
 import {
   // базовые
   getBooks, addBook, uploadExport, updateBook, deleteBook,
   saveComment, checkAndInsertLibraryBook, deleteImageFromStorage,
   uploadCover, searchBooks, deleteCommentImage, uploadCommentImage,
   // полки
   listCollections, listAllBookCollections, listBookCollections,
   setBookCollections, createCollection, renameCollection, deleteCollection,
   // профили/друзья
   upsertProfile, listFriends, sendFriendRequest, listFriendRequests,
   respondFriendRequest, friendsReadingNow, createFriendInvite, acceptFriendInvite,
   // группы и «книга недели»
   createGroup, listGroups, joinGroup, setGroupBook,
   groupDashboard, updateGroupProgress, listGroupComments, postGroupComment
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



// Синхронизируем профиль в БД (не блокирует UI)
(async () => {
  try {
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user || {};
    await upsertProfile({
      user_id: String(userId),
      username: (u.username || '').toLowerCase(),
      name: [u.first_name, u.last_name].filter(Boolean).join(' '),
      avatar_url: '' // если появится — подставим
    });
  } catch (e) {
    console.warn('Profile sync failed', e);
  }
})();

// one-shot обработка start_param, чтобы не срабатывало повторно при каждом рендере
(function handleStartParamOnce() {
  try {
    const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param || '';
    if (!sp || !sp.startsWith('FRIEND_')) return;
    const key = `friend_start_param_${sp}`;
    if (sessionStorage.getItem(key)) return; // уже обработали
    sessionStorage.setItem(key, '1');
    const code = sp.slice(7);
    acceptFriendInvite(code, String(userId)).then(r => {
      if (r?.success) {
        // можно показать мягкое уведомление
        console.log('Friend invite accepted via deep link');
      } else {
        console.warn('Invite accept failed', r?.error);
      }
    });
  } catch (e) {
    console.warn('Start param handling failed', e);
  }
})();


// Укажи юзернейм своего бота (без @)
const BOT_USERNAME = window.__booktracker_chip_bot__ || 'your_bot'; // 

function makeFriendLink(code) {
  const c = String(code || '').toUpperCase().trim();
  return `https://t.me/${BOT_USERNAME}?startapp=FRIEND_${c}`;
}


// 📚 Хранилище текущего списка книг и активной вкладки
let books = [];
let currentTab = "read";

// ==== СОРТИРОВКА: глобальные настройки/хелперы ====
const SORT_DEFAULT = 'auto';    // auto: read→finished_at, reading→started_at, want→added_at
let sortKey = SORT_DEFAULT;
let sortDir = 'desc';

// контекст (вкладка + полка) → ключ для localStorage
function sortCtxKey() {
  const tab = String(currentTab || 'all');
  const col = String(currentCollectionId || 'all');
  return `sort:${tab}:${col}`;
}
function loadSortStateForContext() {
  const raw = localStorage.getItem(sortCtxKey());
  if (!raw) { sortKey = SORT_DEFAULT; sortDir = 'desc'; return; }
  try {
    const j = JSON.parse(raw);
    sortKey = j?.key || SORT_DEFAULT;
    sortDir = j?.dir || 'desc';
  } catch { sortKey = SORT_DEFAULT; sortDir = 'desc'; }
}
function saveSortStateForContext() {
  localStorage.setItem(sortCtxKey(), JSON.stringify({ key: sortKey, dir: sortDir }));
}

// умная нормализация строк (регистр, ё→е, убираем кавычки/дефисы/пунктуацию)
function normStrSmart(s) {
  return String(s ?? '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[«»"“”'’`]/g, '')     // кавычки
    .replace(/[–—-]/g, ' ')          // длинные/короткие дефисы → пробел
    .replace(/[.,;:()!?]/g, ' ')     // пунктуация
    .replace(/\s+/g, ' ')
    .trim();
}

// collator для аккуратного А→Я (русский), игнор пунктуации/регистр, натуральные числа
const collRU = new Intl.Collator('ru', {
  sensitivity: 'base',
  ignorePunctuation: true,
  numeric: true
});


// 📚 Хранилище текущего списка полок
let collections = [];
let bookCollectionsMap = new Map(); // bookId -> Set(collectionId)
let currentCollectionId = null;

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, m => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

async function loadCollectionsData() {
  collections = await listCollections(userId);
  const pairs = await listAllBookCollections(userId);
  bookCollectionsMap = new Map();
  for (const { book_id, collection_id } of pairs) {
    if (!bookCollectionsMap.has(book_id)) bookCollectionsMap.set(book_id, new Set());
    bookCollectionsMap.get(book_id).add(collection_id);
  }
}

function getVisibleBooks() {
  let base = books.filter(b => b.status === currentTab);
  if (currentCollectionId) {
    base = base.filter(b => bookCollectionsMap.get(b.id)?.has(currentCollectionId));
  }
  return applySort(base); // 👈 сортируем тут
}

const COLLECTION_MEMO_KEY = 'ui_current_collection';

function loadCurrentCollection() {
  const v = localStorage.getItem(COLLECTION_MEMO_KEY);
  currentCollectionId = v && v !== 'null' && v !== '' ? v : null;
}

function saveCurrentCollection() {
  if (currentCollectionId) localStorage.setItem(COLLECTION_MEMO_KEY, currentCollectionId);
  else localStorage.removeItem(COLLECTION_MEMO_KEY);
}



// 🔁 Основная функция отрисовки экрана с книгами
window.renderMainScreen = async function () {
  books = await getBooks(userId);
  window.books = books;
  const container = document.getElementById("app");
  await loadCollectionsData();
  
  // восстановим выбранную полку (если есть сохранённая)
loadCurrentCollection();
  
  // 🔑 загрузить сорт-настройки для текущих (вкладка, полка)
  loadSortStateForContext();
  const visible = getVisibleBooks();
  
   container.innerHTML = `
    <h2>📘 Мой книжный трекер</h2>

    <div class="nav-tabs">
      <div class="nav-tab ${currentTab === 'reading' ? 'active' : ''}" onclick="switchTab('reading')">Читаю</div>
      <div class="nav-tab ${currentTab === 'read' ? 'active' : ''}" onclick="switchTab('read')">Прочитал</div>
      <div class="nav-tab ${currentTab === 'want_to_read' ? 'active' : ''}" onclick="switchTab('want_to_read')">Хочу прочитать</div>
    </div>

    <button onclick="showAddForm()">+ Добавить книгу</button>
    

  ${renderCollectionsBar()}
  ${renderSortBar()}   
  
    <div id="book-list">
    ${visible.length ? visible.map(renderBookCard).join("") : "<p>📭 Нет книг в этой категории</p>"}
    </div>

    <div class="footer-buttons">
      <button id="exportBtn">📤 Export</button>
      <div id="formatMenu" class="hidden">
        <div class="format-option" data-format="csv">CSV</div>
        <div class="format-option" data-format="json">JSON</div>
      </div>
      <button onclick="showStats()">📊 Статистика</button>
      <button onclick="showSearch()">🔍 Поиск</button>
      <button onclick="showFriends()">👥 Друзья</button>
      <button onclick="showGroups()">👥 Группы</button>
    </div>
  `;

  // смена ключа сортировки
const sel = container.querySelector('#sortKey');
  if (sel) sel.addEventListener('change', () => {
    sortKey = sel.value;
    saveSortStateForContext();   // 💾 запомнить для этой (вкладка+полка)
  renderMainScreen();
});
const dirBtn = container.querySelector('#sortDirToggle');
  if (dirBtn) dirBtn.addEventListener('click', () => {
    sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
    saveSortStateForContext();   // 💾
    renderMainScreen();
  });
 
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

function renderCollectionsBar() {
  return `
    <div class="collections-bar" style="display:flex; gap:8px; overflow:auto; padding:6px 0;">
      <!-- ВАЖНО: у «Все полки» НЕТ data-id -->
      <button id="manageCollectionsBtn" class="chip ${!currentCollectionId ? 'active' : ''}">
        Все полки
      </button>
      ${collections.map(c => `
        <button class="chip ${String(currentCollectionId) === String(c.id) ? 'active' : ''}" data-id="${c.id}">
          ${c.icon || ''} ${escapeHtml(c.name)}
        </button>
      `).join('')}
      <!-- отдельная кнопка для открытия менеджера -->
      <button id="openCollectionsManagerBtn" class="chip ghost" title="Управлять полками">⚙️</button>
    </div>
  `;
}

function renderSortBar() {
  const k = sortKey; const d = sortDir;
  return `
    <div class="sort-bar">
      <span class="sort-label">Сортировка:</span>
      <div class="sort-controls">
        <select id="sortKey" class="sort-select">
          <option value="auto"        ${k==='auto'?'selected':''}>Авто (по вкладке)</option>
          <option value="title"       ${k==='title'?'selected':''}>Название (А→Я)</option>
          <option value="author"      ${k==='author'?'selected':''}>Автор (А→Я)</option>
          <option value="rating"      ${k==='rating'?'selected':''}>Оценка</option>
          <option value="added_at"    ${k==='added_at'?'selected':''}>Дата добавления</option>
          <option value="finished_at" ${k==='finished_at'?'selected':''}>Дата завершения</option>
        </select>
        <button type="button"
                id="sortDirToggle"
                class="sort-arrow"
                title="${d==='asc'?'По возрастанию':'По убыванию'}"
                aria-label="Направление сортировки">
          ${d === 'asc' ? '↑' : '↓'}
        </button>
      </div>
    </div>
  `;
}





function applySort(list) {
  // авто-режим: по вкладке
  let effKey = sortKey;
  if (effKey === 'auto') {
    effKey = (currentTab === 'read')
      ? 'finished_at'
      : (currentTab === 'reading' ? 'started_at' : 'added_at');
  }
  const dir = (sortDir === 'asc') ? 1 : -1;

  const dateVal = (v) => {
    if (!v) return NaN;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? NaN : t;
  };

  function cmp(a, b) {
    let va, vb;
    switch (effKey) {
      case 'title':
        va = normStrSmart(a.title);  vb = normStrSmart(b.title);  break;
      case 'author':
        va = normStrSmart(a.author); vb = normStrSmart(b.author); break;
      case 'rating':
        va = Number(a.rating ?? 0); vb = Number(b.rating ?? 0);    break;
      case 'added_at':
        va = dateVal(a.added_at ?? a.created_at);
        vb = dateVal(b.added_at ?? b.created_at);
        break;
      case 'finished_at':
        va = dateVal(a.finished_at); vb = dateVal(b.finished_at); break;
      case 'started_at':
        va = dateVal(a.started_at);  vb = dateVal(b.started_at);  break;
      default:
        va = 0; vb = 0;
    }

    // пустые значения: при desc — в конец, при asc — в начало
    const aEmpty = (va === '' || va === null || Number.isNaN(va));
    const bEmpty = (vb === '' || vb === null || Number.isNaN(vb));
    if (aEmpty && !bEmpty) return (dir === 1) ? -1 : 1;
    if (!aEmpty && bEmpty) return (dir === 1) ?  1 : -1;

    // основное сравнение (строки через collator, числа/даты — как числа)
    if (typeof va === 'string' && typeof vb === 'string') {
      const res = collRU.compare(va, vb);
      if (res !== 0) return res * dir;
    } else {
      const na = Number(va), nb = Number(vb);
      if (na < nb) return -1 * dir;
      if (na > nb) return  1 * dir;
    }

    // вторичный ключ: стабильный
    // если основная сортировка — по названию, то тай-брейкер по автору; иначе — по названию
    const ta = normStrSmart(a.title),  tb = normStrSmart(b.title);
    const aa = normStrSmart(a.author), ab = normStrSmart(b.author);
    if (effKey === 'title') {
      const res2 = collRU.compare(aa, ab);
      if (res2 !== 0) return res2;
      return collRU.compare(ta, tb);
    } else {
      const res2 = collRU.compare(ta, tb);
      if (res2 !== 0) return res2;
      return collRU.compare(aa, ab);
    }
  }

  return [...list].sort(cmp);
}





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
  const chips = (bookCollectionsMap.get(book.id) || new Set());
  const chipsHtml = [...chips].slice(0, 3).map(cid => {
    const c = collections.find(x => x.id === cid);
    return c ? `<span class="chip small">${c.icon || '🏷️'} ${escapeHtml(c.name)}</span>` : '';
  }).join(' ');

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
          <i class="book-author">${book.author || ''}</i>
          ${chipsHtml ? `<div class="chips-row">${chipsHtml}</div>` : ''}
          ${book.rating ? `<div class="stars">${renderStars(book.rating)}</div>` : ""}
          ${book.started_at ? `<div>📖 ${book.started_at}</div>` : ""}
          ${book.finished_at ? `<div>🏁 ${book.finished_at}</div>` : ""}
          <div class="comment-preview">
            <button onclick="openComment('${book.id}')">💬 Заметки</button>
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
window.showAddForm = async function() {
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

<div class="form-block">
  <label>Полки</label>
  <div id="col-select" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px"></div>
  <div style="display:flex;gap:8px;margin-top:6px;">
    <input id="quickShelfName" placeholder="Быстрая новая полка" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;">
    <button type="button" id="quickShelfBtn">＋ Создать</button>
  </div>
</div>

      <div class="form-buttons">
        <button type="submit" class="save-btn">💾 Сохранить</button>
        <button type="button" class="back-btn" onclick="renderMainScreen()">← Назад</button>
      </div>
    </form>
  `;
// подгрузим полки и чекбоксы
collections = await listCollections(userId);
document.getElementById('col-select').innerHTML = collections.map(c => `
  <label style="display:flex;align-items:center;gap:6px">
    <input type="checkbox" value="${c.id}"/>
    ${c.icon || '🏷️'} ${escapeHtml(c.name)}
  </label>
`).join('');

// быстрая полка
document.getElementById('quickShelfBtn').onclick = async ()=>{
  const name = document.getElementById('quickShelfName').value.trim();
  if (!name) return;
  const created = await createCollection(userId, name);
  collections = await listCollections(userId);
  document.getElementById('col-select').innerHTML = collections.map(c => `
    <label style="display:flex;align-items:center;gap:6px">
      <input type="checkbox" value="${c.id}" ${created?.id===c.id?'checked':''}/>
      ${c.icon || '🏷️'} ${escapeHtml(c.name)}
    </label>
  `).join('');
};

  
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
 const newId = await addBook(book);
 if (!newId) { alert('Не удалось создать книгу'); return; }
 const ids = [...document.querySelectorAll('#col-select input:checked')].map(i=>i.value);
 if (ids.length) await setBookCollections(userId, newId, ids);
 currentTab = book.status;
 await focusBookInList(newId);
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
window.editBook = async function(id) {
  window.prevTabOnOpen   = currentTab;
  window.lastOpenedBookId = id;

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
             style="max-height:140px;max-width:100%;margin-top:8px;${book.cover_url ? '' : 'display:none;'}object-fit:contain;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.15);" />
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
            
<div class="form-block">
  <label>Полки</label>
  <div id="col-select" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px"></div>
  <div style="display:flex;gap:8px;margin-top:6px;">
    <input id="quickShelfName" placeholder="Быстрая новая полка" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;">
    <button type="button" id="quickShelfBtn">＋ Создать</button>
  </div>
</div>

      <div class="form-buttons">
        <button type="submit" class="save-btn">💾 Сохранить</button>
        <button type="button" class="back-btn" id="backBtn">← Назад</button>
      </div>
    </form>
  `;
// подгружаем список полок и отмечаем те, где книга уже состоит
collections = await listCollections(userId);
const selected = new Set(await listBookCollections(id));
document.getElementById('col-select').innerHTML = collections.map(c => `
  <label style="display:flex;align-items:center;gap:6px">
    <input type="checkbox" value="${c.id}" ${selected.has(c.id) ? 'checked' : ''}/>
    ${c.icon || '🏷️'} ${escapeHtml(c.name)}
  </label>
`).join('');
  
// «Быстрая полка» в редакторе (по желанию)
document.getElementById('quickShelfBtn').onclick = async ()=>{
  const name = document.getElementById('quickShelfName').value.trim();
  if (!name) return;
  const created = await createCollection(userId, name);
  collections = await listCollections(userId);
  const sel = new Set([...document.querySelectorAll('#col-select input:checked')].map(i=>i.value));
  if (created?.id) sel.add(created.id);
  document.getElementById('col-select').innerHTML = collections.map(c => `
    <label style="display:flex;align-items:center;gap:6px">
      <input type="checkbox" value="${c.id}" ${sel.has(c.id)?'checked':''}/>
      ${c.icon || '🏷️'} ${escapeHtml(c.name)}
    </label>
  `).join('');
};
  
    // превью обложки
  document.getElementById("cover_file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById("coverPreview");
    if (file) { preview.src = URL.createObjectURL(file); preview.style.display = "block"; }
  });
  document.getElementById("cover_url").addEventListener("input", (e) => {
    const url = e.target.value.trim();
    const preview = document.getElementById("coverPreview");
    if (url) { preview.src = url; preview.style.display = "block"; } else { preview.style.display = "none"; }
  });

  // автоустановка даты окончания
  document.getElementById("status").addEventListener("change", () => {
    const status = document.getElementById("status").value;
    const finishedInput = document.getElementById("finished_at");
    if (status === "read" && !finishedInput.value) {
      finishedInput.value = new Date().toISOString().split("T")[0];
    }
  });

  // Назад
  document.getElementById("backBtn").addEventListener("click", () => {
    focusBookInList(window.lastOpenedBookId || id);
  });

  // Сохранение
  document.getElementById("editForm").addEventListener("submit", async function(e) {
    e.preventDefault();

    let coverUrl = document.getElementById("cover_url").value.trim();
    const file = document.getElementById("cover_file").files[0];
    if (file) coverUrl = await uploadCover(file);

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
    // сохранить выбор полок и вернуться к карточке
const ids = [...document.querySelectorAll('#col-select input:checked')].map(i => i.value);
await setBookCollections(userId, id, ids);
await focusBookInList(id);
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
  await focusBookInList(null);
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
    if (window.prevTabOnOpen) currentTab = window.prevTabOnOpen; // вернуться туда, откуда пришли
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
  window.prevTabOnOpen   = currentTab;
  window.lastOpenedBookId = bookId;
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
      <button onclick="focusBookInList(window.lastOpenedBookId)">← Назад</button>
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

window.showCollections = async function() {
  // на всякий: освежим список полок
  collections = await listCollections(userId);

  const container = document.getElementById('app');
  container.innerHTML = `
    <h2>🏷️ Полки</h2>

    <div style="display:flex;gap:8px; margin-bottom:12px;">
      <input id="newShelfName" placeholder="Новая полка (например: Классика)" style="flex:1;padding:10px;border-radius:8px;border:1px solid #ddd;">
      <button id="createShelfBtn">＋ Создать</button>
    </div>

    <div id="shelvesList">
      ${collections.length ? collections.map(c => `
        <div class="shelf-row" data-id="${c.id}" style="display:flex;align-items:center;gap:8px; padding:10px; border:1px solid #eee; border-radius:8px; margin-bottom:8px;">
          <div style="flex:1; font-weight:600;">${c.icon || '🏷️'} ${escapeHtml(c.name)}</div>
          <button class="rename">Переименовать</button>
          <button class="delete" style="color:#b91c1c;">Удалить</button>
          <button class="open">Открыть</button>
        </div>
      `).join('') : `<div style="opacity:.7">Полок пока нет</div>`}
    </div>

    <div class="footer-buttons" style="margin-top:12px;">
      <button onclick="renderMainScreen()">← Назад</button>
    </div>
  `;

  // создать
  document.getElementById('createShelfBtn').onclick = async () => {
    const name = document.getElementById('newShelfName').value.trim();
    if (!name) return;
    const created = await createCollection(userId, name);
    if (created?.id) {
      collections = await listCollections(userId);
      showCollections();
    }
  };

  // делегирование
  container.querySelector('#shelvesList').addEventListener('click', async (e)=>{
    const row = e.target.closest('.shelf-row'); if (!row) return;
    const id = row.dataset.id;

    if (e.target.classList.contains('rename')) {
      const cur = collections.find(x=>x.id===id);
      const name = prompt('Новое название полки', cur?.name || '');
      if (name && name.trim()) { await renameCollection(id, { name: name.trim() }); showCollections(); }
      return;
    }
    if (e.target.classList.contains('delete')) {
      if (confirm('Удалить полку? Книги не удалятся.')) { await deleteCollection(id); showCollections(); }
      return;
    }
if (e.target.classList.contains('open')) {
  currentCollectionId = id;
  saveCurrentCollection();          // 👈 сохраняем
  renderMainScreen();
  return;
}
  });
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
  };

  // сохраняем новый комментарий
await saveComment(bookId, userId, newComment);
await focusBookInList(bookId);
 };

(function enableCollectionsDelegation() {
  const root = document.getElementById('app');
  if (!root || root.dataset.collectionsBound === '1') return;
  root.dataset.collectionsBound = '1';

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('.collections-bar .chip');
    if (!chip) return;

    // «Все полки» — ТОЛЬКО снять фильтр (не открывать менеджер)
    if (chip.id === 'manageCollectionsBtn') {
  e.preventDefault();
  currentCollectionId = null;
  saveCurrentCollection();          // 👈 сохраняем
  renderMainScreen();
  return;
}

// Обычная полка — переключатель
const id = chip.getAttribute('data-id');
if (!id) return;
currentCollectionId = (String(currentCollectionId) === String(id)) ? null : id;
saveCurrentCollection();            // 👈 сохраняем
renderMainScreen();
  });

  // Отдельная кнопка для менеджера полок (см. ниже в разметке)
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('#openCollectionsManagerBtn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    showCollections();
  });
})();

window.showFriends = async function() {
  const container = document.getElementById('app');
  const friends = await listFriends(userId);
  const reading = await friendsReadingNow(userId); // книги со статусом reading
  const readingMap = new Map(reading.map(b => [b.user_id, b]));

  const requests = await listFriendRequests(userId);

  container.innerHTML = `
    <h2>👥 Друзья</h2>

    <div style="display:flex;gap:8px;margin:8px 0 16px;">
      <input id="addByUsername" placeholder="Добавить по @username" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;">
      <button id="sendReq">Добавить</button>
    </div>
    
<div style="display:flex;gap:8px; margin:8px 0;">
  <button id="makeCodeBtn">Мой код</button>
  <div id="myCodeWrap" style="display:none; align-items:center; gap:8px;">
    <code id="myCode" style="font-weight:700;"></code>
    <button id="copyMyCode">Копировать</button>
    <button id="shareMyCode">Поделиться</button>
  </div>
</div>
<div style="display:flex;gap:8px; margin:8px 0 16px;">
  <input id="friendCodeInput" placeholder="Ввести код друга" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;">
  <button id="useCodeBtn">Добавить по коду</button>
</div>

    ${requests.requests.length ? `
      <h3>Заявки</h3>
      <div>${requests.requests.map(r => {
        const p = requests.profiles.find(x => x.user_id === r.from_user);
        const name = p?.name || ('@' + (p?.username || 'user'));
        return `<div style="display:flex;gap:8px;align-items:center;margin:6px 0;">
          <div style="flex:1;">${name}</div>
          <button onclick="respondFriend('${r.id}', true)">Принять</button>
          <button onclick="respondFriend('${r.id}', false)">Отклонить</button>
        </div>`;
      }).join('')}</div>
    ` : ''}
    

    <h3>Мои друзья</h3>
    <div>
      ${friends.length ? friends.map(f => {
        const b = readingMap.get(f.user_id);
        return `<div class="friend-row" style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #eee;border-radius:10px;margin-bottom:8px;">
          <div style="flex:1;">
            <div style="font-weight:600;">${f.name || '@'+(f.username||'user')}</div>
            ${b ? `<div style="opacity:.8;">Читает: ${b.title} — ${b.author||''}</div>` : `<div style="opacity:.7;">Не читает сейчас</div>`}
          </div>
          ${b ? `<button onclick="startGroupWithFriend('${f.user_id}', '${b.title}', '${b.author||''}', '${b.cover_url||''}')">📚 Читать вместе</button>` : ''}
        </div>`;
      }).join('') : '<div>Пока нет друзей</div>'}
    </div>

    <div class="footer-buttons"><button onclick="renderMainScreen()">← Назад</button></div>
  `;

 const wrap = document.getElementById('myCodeWrap');
document.getElementById('makeCodeBtn').onclick = async () => {
  const r = await createFriendInvite(userId);
  if (r?.code) {
    const link = makeFriendLink(r.code);
    // сразу открываем в Telegram (если внутри клиента)
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(link);
    else if (navigator.share) navigator.share({ url: link });
    else {
      await navigator.clipboard.writeText(link);
      alert('Ссылка скопирована');
    }
  } else {
    alert(r?.error || 'Не удалось создать код');
  }
};
 
document.getElementById('copyMyCode').onclick = () => {
  const c = document.getElementById('myCode').textContent;
  if (c) navigator.clipboard.writeText(c);
};
document.getElementById('shareMyCode').onclick = () => {
  const c = document.getElementById('myCode').textContent.trim();
  if (!c) return;
  const link = makeFriendLink(c);
  const text = `Добавь меня в друзья в Book Tracker: ${link}`;

  // 1) если Mini App внутри Telegram-клиента — откроем ссылку прямо в Telegram
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(link);
    return;
  }

  // 2) если поддерживается нативный share (мобильный браузер)
  if (navigator.share) {
    navigator.share({ text, url: link }).catch(()=>{});
    return;
  }

  // 3) запасной вариант — копируем в буфер
  navigator.clipboard.writeText(text)
    .then(()=> alert('Ссылка скопирована'))
    .catch(()=> window.prompt('Скопируйте ссылку:', link));
};
 
document.getElementById('useCodeBtn').onclick = async () => {
  const code = document.getElementById('friendCodeInput').value.trim();
  if (!code) return;
  const r = await acceptFriendInvite(code, userId);
  if (r?.success) { alert('Готово! Вы теперь друзья.'); showFriends(); }
  else alert(r?.error || 'Не удалось принять код');
};


  document.getElementById('sendReq').onclick = async () => {
    const u = document.getElementById('addByUsername').value.trim();
    if (!u) return;
    const r = await sendFriendRequest(userId, u);
    alert(r.error || 'Заявка отправлена');
    showFriends();
  };
};

window.respondFriend = async function(reqId, ok) {
  await respondFriendRequest(reqId, !!ok);
  showFriends();
};

window.startGroupWithFriend = async function(friendId, title, author, cover) {
  const g = await createGroup(userId, 'Дуэт чтения');
  await joinGroup(friendId, g.invite_code); // если уже состоит — просто будет upsert
  const gb = await setGroupBook(g.group_id, { title, author, cover_url: cover });
  // откроем группу:
  showGroup(g.group_id);
};

window.showGroup = async function(groupId) {
  const container = document.getElementById('app');
  const data = await groupDashboard(groupId);

  const book = data?.book;
  const members = data?.members || [];
  const profMap = new Map(data?.profiles.map(p => [p.user_id, p]) || []);
  const progMap = new Map((data?.progress || []).map(p => [p.user_id, p]));

  container.innerHTML = `
    <h2>👥 Группа</h2>

    ${book ? `
      <div class="group-book" style="padding:12px;border:1px solid #eee;border-radius:12px;margin-bottom:12px;">
        <div style="font-weight:700;">${book.title}</div>
        <div style="opacity:.8;">${book.author||''}</div>
        ${book.start_at ? `<div>Старт: ${book.start_at}</div>`:''}
        ${book.end_at ? `<div>Дедлайн: ${book.end_at}</div>`:''}
      </div>
    ` : `
      <div>Пока нет активной книги. <button onclick="promptSetGroupBook('${groupId}')">Выбрать книгу</button></div>
    `}

    <h3>Прогресс</h3>
    <div>
      ${members.map(m => {
        const p = profMap.get(m.user_id);
        const pr = progMap.get(m.user_id);
        const pct = pr?.progress_pct ?? (pr?.current_page && pr?.total_pages ? Math.round(100*pr.current_page/pr.total_pages) : 0);
        return `<div style="display:flex;align-items:center;gap:10px;margin:6px 0;">
          <div style="flex:1;">
            <div>${p?.name || '@'+(p?.username||'user')}</div>
            <div style="height:8px;border-radius:999px;background:#eee;overflow:hidden;">
              <div style="height:8px;width:${pct||0}%;background:#60a5fa;"></div>
            </div>
          </div>
          ${String(m.user_id)===String(userId) && book ? `
            <button onclick="promptUpdateProgress('${book.id||''}','${groupId}','${book.id? '': (data.book.id)}','${data.book.id}')">Обновить</button>
          ` : ''}
        </div>`;
      }).join('')}
    </div>

    <div class="footer-buttons"><button onclick="renderMainScreen()">← Назад</button></div>
  `;
};

window.promptSetGroupBook = async function(groupId) {
  const title = prompt('Название книги недели');
  if (!title) return;
  const author = prompt('Автор (необязательно)') || '';
  const gb = await setGroupBook(groupId, { title, author });
  showGroup(groupId);
};

window.promptUpdateProgress = async function(_bookId, groupId, _x, groupBookId) {
  const mode = confirm('Ок — проценты. Отмена — страницы.');
  if (mode) {
    const pct = Number(prompt('Прогресс, % (0-100)') || '0');
    await updateGroupProgress(groupBookId, userId, { progress_pct: Math.max(0, Math.min(100, pct)) });
  } else {
    const cur = Number(prompt('Текущая страница') || '0');
    const tot = Number(prompt('Всего страниц') || '0');
    await updateGroupProgress(groupBookId, userId, { current_page: cur, total_pages: tot });
  }
  showGroup(groupId);
};

window.showGroups = async function() {
  const gs = await listGroups(userId);
  const container = document.getElementById('app');
  container.innerHTML = `
    <h2>👥 Мои группы</h2>
    <div style="display:flex;gap:8px;margin:8px 0 16px;">
      <input id="groupName" placeholder="Название группы" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;">
      <button id="createGroupBtn">Создать</button>
    </div>
    <div style="display:flex;gap:8px;margin:8px 0 16px;">
      <input id="inviteCode" placeholder="Код приглашения" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;">
      <button id="joinBtn">Вступить</button>
    </div>
    <div>
      ${gs.length ? gs.map(g => `
        <div style="padding:10px;border:1px solid #eee;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div><b>${g.name}</b> · ${g.members_count||1} участн.</div>
          <div style="display:flex;gap:8px;">
            <button onclick="showGroup('${g.id}')">Открыть</button>
            <button onclick="navigator.clipboard.writeText('${g.invite_code||''}'); alert('Код скопирован');">Код</button>
          </div>
        </div>
      `).join('') : '<div>Пока нет групп</div>'}
    </div>
    <div class="footer-buttons"><button onclick="renderMainScreen()">← Назад</button></div>
  `;

  document.getElementById('createGroupBtn').onclick = async ()=>{
    const name = document.getElementById('groupName').value.trim();
    if (!name) return;
    const info = await createGroup(userId, name);
    alert('Группа создана. Код: ' + info.invite_code);
    showGroups();
  };
  document.getElementById('joinBtn').onclick = async ()=>{
    const code = document.getElementById('inviteCode').value.trim();
    if (!code) return;
    const info = await joinGroup(userId, code);
    showGroups();
  };
};

