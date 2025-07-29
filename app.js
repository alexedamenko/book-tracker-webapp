// 📁 app.js — Основная логика WebApp
import { supabase, getBooks, addBook } from './api.js';

Telegram.WebApp.ready();
const userId = Telegram.WebApp.initDataUnsafe.user?.id || 'demo_user';

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
      <button>📊 Статистика</button>
      <button>🔍 Поиск / рекомендации</button>
    </div>
  `;
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
      <button type="submit">Сохранить</button>
    </form>
    <button onclick="renderMainScreen()">← Назад</button>
  `;
};

window.submitAddForm = async function(e) {
  e.preventDefault();
  const book = {
    id: crypto.randomUUID(),
    user_id: userId,
    title: document.getElementById("title").value,
    author: document.getElementById("author").value,
    cover_url: document.getElementById("cover_url").value,
    status: document.getElementById("status").value,
    rating: null,
 
    comment: "",
    added_at: new Date().toISOString().split("T")[0],
    finished_at: book.status === 'read' ? new Date().toISOString().split("T")[0] : null
  };
  await addBook(book);
  currentTab = book.status;
  renderMainScreen();
};

renderMainScreen();
