// 📁 app.js — Основная логика WebApp
import { supabase, getBooks, addBook, uploadExportFile } from './api.js';

Telegram.WebApp.ready();
if (!Telegram.WebApp.initDataUnsafe?.user?.id) {
  alert("❗ Пожалуйста, открой приложение через Telegram");
  throw new Error("WebApp запущен вне Telegram");
}
const userId = Telegram.WebApp.initDataUnsafe.user.id.toString();

let books = [];
let currentTab = "read";

async function renderMainScreen() {
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
      ${filtered.map(renderBookCard).join("")}
    </div>

    <div class="footer-buttons">
      <button id="exportBtn">📤 Экспорт</button>
      <div id="formatMenu" class="hidden">
        <div class="format-option" data-format="csv">CSV</div>
        <div class="format-option" data-format="json">JSON</div>
      </div>
      <button>📊 Статистика</button>
      <button>🔍 Поиск / рекомендации</button>
    </div>
  `;

  // После рендера привязываем обработчики
  document.getElementById("exportBtn").addEventListener("click", () => {
    document.getElementById("formatMenu").classList.toggle("hidden");
  });

  document.querySelectorAll(".format-option").forEach(option => {
    option.addEventListener("click", async () => {
      const format = option.getAttribute("data-format");
      document.getElementById("formatMenu").classList.add("hidden");

      const { data, error } = await supabase
        .from("user_books")
        .select("*")
        .eq("user_id", userId);

      if (error) {
        alert("Ошибка при получении данных");
        return;
      }

      if (format === "csv") exportToCSV(data);
      if (format === "json") exportToJSON(data);
    });
  });
}

window.switchTab = function(tab) {
  currentTab = tab;
  renderMainScreen();
};

function renderBookCard(book) {
  return `
    <div class="book-card">
      <img src="${book.cover_url}" alt="${book.title}"/>
      <div class="info">
        <b>${book.title}</b><br/>
        <i>${book.author}</i><br/>
        ${book.rating ? `⭐ ${book.rating}/5` : ""} <br/>
        ${book.status === 'read' ? `Прочитана ${book.finished_at}` : ""}
      </div>
    </div>
  `;
}

window.showAddForm = function() {
  const container = document.getElementById("app");
  container.innerHTML = `
    <h2>➕ Добавление книги</h2>
    <form class="add-book-form" onsubmit="submitAddForm(event)">
      <input type="text" id="title" placeholder="Название книги" required />
      <input type="text" id="author" placeholder="Автор" required />
      <input type="url" id="cover_url" placeholder="Ссылка на обложку (необязательно)" />
      <select id="status">
        <option value="want_to_read">Хочу прочитать</option>
        <option value="reading">Читаю</option>
        <option value="read">Прочитал</option>
      </select>
      <select id="rating">
        <option value="">Без оценки</option>
        <option value="1">⭐ 1</option>
        <option value="2">⭐ 2</option>
        <option value="3">⭐ 3</option>
        <option value="4">⭐ 4</option>
        <option value="5">⭐ 5</option>
      </select>
      <button type="submit">Сохранить</button>
    </form>
    <button onclick="renderMainScreen()">← Назад</button>
  `;
};

window.submitAddForm = async function(e) {
  e.preventDefault();
  const ratingValue = document.getElementById("rating").value;
  const book = {
    id: crypto.randomUUID(),
    user_id: userId,
    title: document.getElementById("title").value,
    author: document.getElementById("author").value,
    cover_url: document.getElementById("cover_url").value,
    status: document.getElementById("status").value,
    rating: ratingValue ? Number(ratingValue) : null,
    comment: "",
    added_at: new Date().toISOString().split("T")[0],
    finished_at: document.getElementById("status").value === 'read' ? new Date().toISOString().split("T")[0] : null
  };
  await addBook(book);
  currentTab = book.status;
  renderMainScreen();
};

function exportToCSV(data) {
  if (!data || !data.length) return;

  const header = Object.keys(data[0]);
  const rows = data.map(row =>
    header.map(field => `"${(row[field] || "").toString().replace(/"/g, '""')}"`)
  );
  const csvContent = [header.join(","), ...rows.map(r => r.join(","))].join("\n");

  uploadAndShare(csvContent, `books-${userId}.csv`, "text/csv");
}

function exportToJSON(data) {
  const jsonContent = JSON.stringify(data, null, 2);
  uploadAndShare(jsonContent, `books-${userId}.json`, "application/json");
}

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

