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
   removeFriendship,
   // группы и «книга недели»
   createGroup, listGroups, joinGroup, setGroupBook,
   groupDashboard, updateGroupProgress, listGroupComments, postGroupComment,
   isbnLookup,
  // группы и «книга недели»
   mapStats, booksByCountry, exportMap
 } from './api.js';

Telegram.WebApp.ready();
Telegram.WebApp.expand();

function applySafeTop() {
  const app = document.getElementById('app');
  if (!app) return;

  // читаем CSS-переменную от Telegram (может быть пустой на Android)
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--tg-content-safe-area-inset-top')
    .trim();

  const safeTop = parseInt(raw || '0', 10) || 0;

  // добавляем запас под «Close»-пузырь
  const EXTRA = 22; // подгони при желании 18–28
  app.style.paddingTop = (safeTop + EXTRA) + 'px';
}

// применяем сразу и при изменении viewport (поворот/клавиатура и т.п.)
applySafeTop();
Telegram.WebApp.onEvent('viewportChanged', applySafeTop);

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

function getStartParamSafe() {
  const tg = window.Telegram?.WebApp;
  const sp1 = tg?.initDataUnsafe?.start_param || '';
  // иногда start_param доступен только в подписанной строке initData
  let sp2 = '';
  try {
    const qs = new URLSearchParams(tg?.initData || '');
    sp2 = qs.get('start_param') || '';
  } catch {}
  return sp1 || sp2 || '';
}

(function handleFriendDeepLinkOnce() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return; // вне Telegram — не трогаем

  const sp = getStartParamSafe();
  if (!sp || !/^FRIEND_/.test(sp)) return;

  const key = 'friend_accept_'+sp;
  if (sessionStorage.getItem(key)) return; // чтобы не дёргать повторно
  sessionStorage.setItem(key, '1');

  const code = sp.slice(7);
  acceptFriendInvite(code, String(userId))
    .then(r => {
      if (r?.success) {
        // можно тихо обновить экран друзей, если он открыт
        console.log('Friend auto-accepted');
      } else {
        console.warn('Friend auto-accept failed:', r?.error);
      }
    })
    .catch(err => console.warn('Friend auto-accept error', err));
})();


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


// Укажи юзернейм своего бота (без @)
const BOT_USERNAME = window.__BOT_USERNAME__ || 'booktracker_chip_bot';
const APP_SHORT_NAME = window.__APP_SHORT_NAME__ || 'chip'; // ← short name из BotFather

function makeFriendLink(code) {
  const c = String(code || '').toUpperCase().trim();
  // правильный формат с short name
  return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=FRIEND_${c}`;
}

// ——— UI стили для экрана карты (как в мокапе)
(function injectMapStyles(){
  const css = `
  :root{
    --bg:#f6f7fb; --card:#ffffff; --text:#0f172a; --muted:#64748b;
    --chip:#f1f5f9; --chip-border:#e2e8f0;
    --brand:#ff8a3d; --brand-2:#ffc38c; --brand-3:#ffe7cf;
  }
  body{ background:var(--bg); }
  h2{ font-size:22px; font-weight:700; margin:4px 0 8px; }
  .seg{ background:var(--chip); border:1px solid var(--chip-border); padding:4px; border-radius:999px; }
  .chip{ background:var(--chip); border:1px solid var(--chip-border); border-radius:999px; padding:8px 12px; font-size:14px; }
  .chip.active{ background:#fff; border-color:var(--brand); box-shadow:0 1px 0 rgba(0,0,0,.03); }
  .region-pill{ background:#fff; border:1px solid #e5e7eb; border-radius:999px; padding:6px 10px; font-size:13px; }
  .map-card{ background:var(--card); border-radius:16px; box-shadow:0 6px 24px rgba(15,23,42,.06); overflow:hidden; }
  `;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();

// ==== ECharts loader (для экрана "Карта") — начало
async function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => res(src);
    s.onerror = () => rej(new Error('Failed to load: ' + src));
    document.head.appendChild(s);
  });
}

async function loadWithFallback(urls) {
  let lastErr;
  for (const u of urls) {
    try { return await loadScript(u); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All script sources failed');
}

async function fetchWithFallback(urls) {
  let lastErr;
  for (const u of urls) {
    try {
      const r = await fetch(u, { mode: 'cors' });
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All JSON sources failed');
}

async function ensureECharts() {
  if (window.echarts?.init) return;
  await loadWithFallback([
        'https://unpkg.com/echarts@5/dist/echarts.min.js',
      ]);
}

// грузим и регистрируем мир как GeoJSON из /public (без CORS)
async function ensureWorldMap() {
  if (window.__worldRegistered) return;
  const r = await fetch('/world.geo.json'); // <- локальный файл из public/
  if (!r.ok) throw new Error('world.geo.json not found in /public');
  const world = await r.json();
  echarts.registerMap('world', world); // nameProperty по умолчанию 'name'
  window.__worldRegistered = true;
}

// ==== ECharts loader — конец


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

function cleanIsbn(s){ return (s||'').replace(/[^0-9Xx]/g,'').toUpperCase(); }
function isValidIsbn10(isbn){
  isbn = cleanIsbn(isbn);
  if (!/^\d{9}[0-9X]$/.test(isbn)) return false;
  let sum = 0;
  for (let i=0;i<9;i++) sum += (i+1)*parseInt(isbn[i],10);
  sum += (isbn[9]==='X'?10:parseInt(isbn[9],10))*10;
  return sum % 11 === 0;
}
function isbn10to13(isbn10){
  const core = '978' + cleanIsbn(isbn10).slice(0,9);
  let sum = 0;
  for (let i=0;i<12;i++){
    const d = parseInt(core[i],10);
    sum += d * (i%2 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return core + check;
}
function isValidIsbn13(isbn){
  isbn = cleanIsbn(isbn);
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i=0;i<12;i++){
    const d = parseInt(isbn[i],10);
    sum += d * (i%2 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(isbn[12],10);
}
function normalizeToIsbn13(any){
  let x = cleanIsbn(any);
  if (x.length===10 && isValidIsbn10(x)) return isbn10to13(x);
  if (x.length===13 && isValidIsbn13(x)) return x;
  return null;
}


// 📚 Хранилище текущего списка полок
let collections = [];
let bookCollectionsMap = new Map(); // bookId -> Set(collectionId)
let currentCollectionId = null;
let currentIsbnMeta = null; // сюда положим метаданные книги после lookup


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

<div class="footer-nav">
  <button onclick="toggleExportMenu()" id="exportBtn">⬆️ <span class="label">Экспорт</span></button>
  <button onclick="showStats()">📊 <span class="label">Статистика</span></button>
  <button onclick="showSearch()">🔎 <span class="label">Поиск</span></button>
  <button onclick="showFriends()">👥 <span class="label">Друзья</span></button>
  <button onclick="showGroups()">👥 <span class="label">Группы</span></button>
  <button onclick="showMapScreen()">🌍 <span class="label">Карта</span></button> <!-- 👈 НОВОЕ -->
</div>


<!-- всплывающее меню форматов оставляем как есть -->
<div id="formatMenu" class="format-menu hidden">
  <div class="format-option" data-format="csv">CSV</div>
  <div class="format-option" data-format="json">JSON</div>
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
        <label>Добавить по ISBN</label>
        <div style="display:flex; gap:8px;">
          <input id="isbnInput" placeholder="ISBN-13 или ISBN-10" inputmode="numeric" style="flex:1" />
          <button type="button" id="scanIsbnBtn" title="Сканировать">📷</button>
          <button type="button" id="fillFromIsbnBtn" title="Подтянуть данные">⤵︎</button>
        </div>
        <video id="cam" playsinline style="width:100%;max-height:40vh;display:none;"></video>
        <div id="isbnHint" style="font-size:12px;opacity:.7;margin-top:4px;">Сканируй штрих-код EAN-13 на обложке или введи цифрами</div>
      </div>
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
 // --- ISBN lookup ---
async function fillFromIsbn() {
  const input = document.getElementById('isbnInput');
  if (!input) return;
  const raw = input.value.trim();
  const isbn13 = normalizeToIsbn13(raw);
  if (!isbn13) { alert('Некорректный ISBN'); return; }

  const meta = await isbnLookup(isbn13);
  if (!meta) { alert('Книга не найдена'); return; }

  currentIsbnMeta = meta;

  // Заполняем поля
  const titleEl = document.getElementById('title');
  const authorEl = document.getElementById('author');
  if (titleEl) titleEl.value = meta.title || '';
  if (authorEl) authorEl.value = meta.authors || '';

  const cover = meta.cover_url || '';
  const coverInput = document.getElementById('cover_url');
  const preview = document.getElementById('coverPreview');
  if (coverInput && preview) {
    if (cover) {
      coverInput.value = cover;
      preview.src = cover;
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  }

  // По умолчанию «Хочу прочитать», если явно не выбрано другое
  const sel = document.getElementById('status');
  if (sel && sel.value !== 'reading' && sel.value !== 'read') {
    sel.value = 'want_to_read';
  }
}

// навешиваем обработчик ТОЛЬКО сейчас, когда разметка уже в DOM
const fillBtn = document.getElementById('fillFromIsbnBtn');
if (fillBtn) fillBtn.addEventListener('click', fillFromIsbn);

// --- Сканер EAN-13 ---
async function startScan() {
  const video = document.getElementById('cam');
  if (!video) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
    video.srcObject = stream;
    video.style.display = 'block';
    await video.play();

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13'] });
      const tick = async () => {
        if (video.readyState === 4) {
          const bitmap = await createImageBitmap(video);
          try {
            const codes = await detector.detect(bitmap);
            if (codes.length) {
              const ean = codes[0].rawValue;
              stopScan();
              const input = document.getElementById('isbnInput');
              if (input) input.value = ean;
              await fillFromIsbn();
              return;
            }
          } catch {}
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else {
      alert('Сканер не поддерживается на этом устройстве. Введите ISBN вручную.');
      stopScan();
    }
  } catch (e) {
    alert('Нет доступа к камере. Введите ISBN вручную.');
  }
}

function stopScan() {
  const video = document.getElementById('cam');
  if (!video) return;
  video.style.display = 'none';
  const s = video.srcObject;
  if (s) s.getTracks().forEach(t => t.stop());
  video.srcObject = null;
}

const scanBtn = document.getElementById('scanIsbnBtn');
if (scanBtn) scanBtn.addEventListener('click', startScan);

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

 // если ранее подтягивали по ISBN — доклеим
let extraIsbnFields = {};
if (currentIsbnMeta) {
  extraIsbnFields = {
    isbn13: currentIsbnMeta.isbn13 || null,
    isbn10: currentIsbnMeta.isbn10 || null,
    language: currentIsbnMeta.language || null,
    published_year: currentIsbnMeta.published_year || null
  };
}
 
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
    finished_at: finishedAt,
    ...extraIsbnFields
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
           <button class="danger" onclick="confirmRemoveFriend('${f.user_id}')">Удалить</button>
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
    document.getElementById('myCode').textContent = r.code;
    wrap.style.display = 'inline-flex';     // показать блок с кодом
    // ничего не открываем! ни openTelegramLink, ни openLink
  } else {
    alert(r?.error || 'Не удалось создать код');
  }
};

 
document.getElementById('copyMyCode').onclick = async () => {
  const c = document.getElementById('myCode').textContent.trim();
  if (!c) return;
  const link = makeFriendLink(c);
  await navigator.clipboard.writeText(link);
  alert('Ссылка скопирована');
};


document.getElementById('shareMyCode').onclick = () => {
  const c = document.getElementById('myCode').textContent.trim();
  if (!c) return;
  const link = makeFriendLink(c);
  const caption = 'Добавь меня в друзья в Book Tracker';

  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(caption)}`;
    tg.openTelegramLink(shareUrl);
  } else if (navigator.share) {
    navigator.share({ url: link, text: caption }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(link).then(()=>alert('Ссылка скопирована'));
  }
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
window.confirmRemoveFriend = async function(friendId){
  if (!confirm('Удалить этого пользователя из друзей?')) return;
  const r = await removeFriendship(String(userId), String(friendId));
  if (r?.success) showFriends();
  else alert(r?.error || 'Не удалось удалить');
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

window.showMapScreen = async function () {
  const container = document.getElementById('app');
  container.innerHTML = `
    <h2>🌍 Мир через книги</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
      <div class="seg" role="group" aria-label="mode">
        <button id="modeAuthor" class="chip active">Автор</button>
        <button id="modeSetting" class="chip">Сюжет</button>
      </div>
      <select id="statusFilter" class="chip">
        <option value="">Все статусы</option>
        <option value="read">Прочитал</option>
        <option value="reading">Читаю</option>
        <option value="want_to_read">Хочу</option>
      </select>
      <input id="yearFrom" placeholder="с 2020" class="chip" style="width:100px">
      <input id="yearTo" placeholder="по 2025" class="chip" style="width:100px">
      <button id="applyFilters" class="chip active">Фильтр</button>
    </div>

    <div id="mapTotals" style="margin:6px 0;opacity:.8"></div>
    <div id="regionBadges" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>

    <div id="mapWrap" class="map-card" style="width:100%; height:56vh; min-height:380px;"></div>

    <div style="display:flex;gap:8px;margin:10px 0 4px;">
      <button id="shareMapBtn">Поделиться</button>
      <button id="downloadMapBtn">Скачать PNG</button>
    </div>

    <h3 style="margin-top:12px;">Топ стран</h3>
    <div id="topList"></div>

    <div class="footer-buttons" style="margin-top:12px;">
      <button onclick="renderMainScreen()">← Назад</button>
    </div>

    <div id="countrySheet" class="hidden" style="position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #eee;border-radius:12px 12px 0 0;box-shadow:0 -10px 30px rgba(0,0,0,.08);max-height:70vh;overflow:auto;padding:12px;"></div>
  `;

try {
  await ensureECharts();
  await ensureWorldMap();
} catch (e) {
  console.error('ECharts load error:', e);
  const el = document.getElementById('mapWrap');
 // тёмная «карточка» под карту — как на референсе
el.style.background = '#111827';    // slate-900
el.style.border = 'none';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.innerHTML = `
    <div style="text-align:center; color:#667085; padding:16px;">
      Не удалось загрузить библиотеку карты.<br/>
      Попробуй ещё раз или открой в браузере.
      <div style="margin-top:8px;">
        <button id="retryMap" style="padding:8px 12px;">Повторить</button>
      </div>
    </div>`;
  const btn = document.getElementById('retryMap');
  if (btn) btn.onclick = () => showMapScreen();
  return; // выходим, чтобы не продолжать рендер
}

  const el = document.getElementById('mapWrap');
  const chart = echarts.init(el, null, { renderer:'canvas' });

  let mode = 'author';
  let filters = { status:'', year_from:'', year_to:'' };
  const $ = (id)=>document.getElementById(id);

  function iso2ToEchartsName(code) {
    // Мини-словарь для «капризных» названий на карте ECharts
    const m = {
      'US':'United States of America', 'GB':'United Kingdom', 'RU':'Russia',
      'IR':'Iran', 'SY':'Syria', 'KP':'Dem. Rep. Korea', 'KR':'Republic of Korea',
      'LA':'Lao PDR', 'CZ':'Czech Rep.', 'CD':'Dem. Rep. Congo', 'CG':'Congo',
      'BO':'Bolivia', 'TZ':'Tanzania', 'VE':'Venezuela', 'AE':'United Arab Emirates'
    };
    // простые случаи часто совпадают (France, Italy, Japan, Spain…)
    const simple = {
      'FR':'France','IT':'Italy','ES':'Spain','DE':'Germany','JP':'Japan','CN':'China','CA':'Canada','BR':'Brazil','AU':'Australia','IN':'India','MX':'Mexico','SE':'Sweden','NO':'Norway','FI':'Finland','PL':'Poland','TR':'Turkey','AR':'Argentina','ZA':'South Africa','NL':'Netherlands','CH':'Switzerland'
    };
    return m[code] || simple[code] || code; // fallback — покажется только tooltip
  }

function renderBadges(regions, isDark) {
   // для светлой темы игнорируем isDark
  regionBadges.innerHTML = regions.map(r =>
    `<span class="region-pill">${r.name}: <b>${r.pct}%</b></span>`
  ).join(' ');
}
  function renderTotals(t) {
    mapTotals.innerHTML = `
    <span class="region-pill">Всего стран: <b>${t.countries}</b></span>
    <span class="region-pill">Книг: <b>${t.books}</b></span>
    <span class="region-pill">Режим: <b>${mode==='author'?'автор':'сюжет'}</b></span>
  `;
}
  function renderTop(by_country) {
    const top = by_country.slice(0, 8);
    $('topList').innerHTML = top.length
      ? top.map((x,i)=>`<div class="row" data-code="${x.code}" style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #f1f1f1;cursor:pointer;">
          <span>${i+1}. ${x.code}</span><b>${x.count}</b>
         </div>`).join('')
      : '<div style="opacity:.6">Нет данных</div>';
    $('topList').querySelectorAll('.row').forEach(el=>{
      el.addEventListener('click', ()=> openCountrySheet(el.dataset.code));
    });
  }

  async function draw() {
    const stats = await mapStats(userId, { mode, ...filters });
    const isDark = true; // или: const isDark = (window.Telegram?.WebApp?.colorScheme === 'dark');
    renderTotals(stats.totals);
    renderBadges(stats.regions,false);
    renderTop(stats.by_country);

// соберём данные для карты (один раз!)
const seriesData = stats.by_country.map(({ code, count }) => ({
  name: iso2ToEchartsName(code),
  value: count,
  _iso2: code
}));

// оверлей «пусто», если нет данных
const mapContainer = document.getElementById('mapWrap');
const emptyOverlayId = 'mapEmptyOverlay';
let emptyOverlay = document.getElementById(emptyOverlayId);
if (!emptyOverlay) {
  emptyOverlay = document.createElement('div');
  emptyOverlay.id = emptyOverlayId;
  emptyOverlay.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:16px;color:#667085;';
  mapContainer.style.position = 'relative';
  mapContainer.appendChild(emptyOverlay);
}
if (seriesData.length === 0) {
  emptyOverlay.style.display = 'flex';
  emptyOverlay.innerHTML = 'Пока нет данных для карты.<br/>Добавь в книгах 🇺🇸 страну автора или 🌍 страны сюжета.';
} else {
  emptyOverlay.style.display = 'none';
}

// рендер карты

const palette = {
  land:'#F7F8FC', border:'#E5E9F2', emph:'#FFE3C3',
  ramp:['#FFEAD7','#FFC796','#FF8A3D'] // светло→насыщенно-оранжевый
};
const isMobile = window.innerWidth < 480;
const vmax = Math.max(1, ...seriesData.map(d=>d.value));

chart.setOption({
  backgroundColor: 'transparent',
  geo: {
    map: 'world',
    roam: true,
    zoom: isMobile ? 1.25 : 1.15,
    center: [15, 12],
    left: 0, right: 0, top: 0, bottom: 0,
    itemStyle: {
      areaColor: palette.land,
      borderColor: palette.border,
      borderWidth: 0.8,
      shadowColor:'rgba(15,23,42,.04)', shadowBlur:8
    },
    emphasis: { itemStyle: { areaColor: palette.emph } },
    label: { show:false }
  },
  visualMap: {
    show:false,
    min:0, max:vmax,
    inRange:{ color: palette.ramp }
  },
  tooltip:{
    trigger:'item',
    backgroundColor:'#fff',
    borderColor:'var(--brand)',
    borderWidth:1,
    textStyle:{ color:'var(--text)' },
    extraCssText:'box-shadow:0 8px 24px rgba(15,23,42,.12); border-radius:10px; padding:8px 10px;'
  },
  series:[{
    type:'map',
    map:'world',
    geoIndex:0,
    nameProperty:'name',
    data: seriesData,
    animationDurationUpdate: 350
  }]
}, { replaceMerge:['series','geo','visualMap'] });



// клик по стране -> список книг
chart.off('click');
chart.on('click', (params) => {
  const code = params?.data?._iso2;
  if (code) openCountrySheet(code);
});
  }

  async function openCountrySheet(code) {
    const list = await booksByCountry(userId, code, mode);
    const sheet = $('countrySheet');
    sheet.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
        <b style="font-size:16px;">${code} · книги (${list.length})</b>
        <button onclick="document.getElementById('countrySheet').classList.add('hidden')">Закрыть</button>
      </div>
      ${list.length ? list.map(b => `
        <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f3f3f3;cursor:pointer;" onclick="openBook('${b.id}')">
          ${b.cover_url ? `<img src="${b.cover_url}" style="width:36px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #eee;">` : ''}
          <div style="min-width:0;">
            <div style="font-weight:600;">${b.title}</div>
            <div style="opacity:.7;font-size:12px;">${b.author||''}</div>
          </div>
        </div>
      `).join('') : '<div style="opacity:.6">Пока нет книг</div>'}
    `;
    sheet.classList.remove('hidden');
  }

  // Экспорт/шаринг
  async function exportPng() {
    const dataURL = chart.getDataURL({ type:'png', pixelRatio: 2, backgroundColor:'#ffffff' });
    const meta = { mode, filters };
    const r = await exportMap(userId, dataURL, meta);
    if (!r?.url) { alert('Не удалось сохранить PNG'); return; }

    // Скачать локально (на десктопе) + открыть ссылку (в TG откроется браузер)
    const a = document.createElement('a');
    a.href = dataURL; a.download = `world-through-books-${Date.now()}.png`; a.click();

    const tg = window.Telegram?.WebApp;
    const caption = `Мир через книги — ${mode==='author'?'по авторам':'по сюжету'} (${new Date().toLocaleDateString()})`;
    if (tg?.sendData) {
      tg.sendData(JSON.stringify({ type:'share_map', url: r.url, caption }));
    } else if (tg?.openLink) {
      tg.openLink(r.url);
    } else {
      window.open(r.url, '_blank', 'noopener,noreferrer');
    }
  }

  $('shareMapBtn').onclick = exportPng;
  $('downloadMapBtn').onclick = exportPng;

  // переключатели и фильтры
  $('modeAuthor').onclick = ()=>{ mode='author'; $('modeAuthor').classList.add('active'); $('modeSetting').classList.remove('active'); draw(); };
  $('modeSetting').onclick = ()=>{ mode='setting'; $('modeSetting').classList.add('active'); $('modeAuthor').classList.remove('active'); draw(); };
  $('applyFilters').onclick = ()=>{
    filters = {
      status: $('statusFilter').value || '',
      year_from: $('yearFrom').value || '',
      year_to: $('yearTo').value || ''
    };
    draw();
  };

  // первый рендер
  await draw();
};
