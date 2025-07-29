// 📁 app.js — Основная логика WebApp
Telegram.WebApp.ready();
const userId = Telegram.WebApp.initDataUnsafe.user?.id;

const exampleBook = {
  id: "hulinomika",
  title: "Хулиномика",
  author: "Алексей Марков",
  cover_url: "https://example.com/cover.jpg",
  status: "want_to_read",
  rating: null,
  comment: "",
  added_at: "2025-07-29",
  finished_at: null
};

function renderMainScreen(bookList) {
  const container = document.getElementById("app");
  container.innerHTML = `
    <h2>📚 Мои книги</h2>
    <button onclick="addBookManually()">+ Добавить книгу</button>
    <div id="book-list">
      ${bookList.map(renderBookCard).join("")}
    </div>
  `;
}

function renderBookCard(book) {
  return `
    <div class="book-card">
      <img src="${book.cover_url}" alt="${book.title}"/>
      <div class="info">
        <b>${book.title}</b><br/>
        <i>${book.author}</i><br/>
        Статус: ${translateStatus(book.status)}<br/>
        ${book.rating ? `Оценка: ⭐ ${book.rating}/5` : ""}
      </div>
    </div>
  `;
}

function translateStatus(status) {
  return status === "read" ? "Прочитано" :
         status === "reading" ? "Читаю" :
         status === "dropped" ? "Заброшено" :
         "Хочу прочитать";
}

function addBookManually() {
  alert("Форма добавления книги в разработке...");
}

const mockBooks = [exampleBook];
renderMainScreen(mockBooks);
