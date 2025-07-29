// 📁 app.js — Основная логика WebApp
Telegram.WebApp.ready();
const userId = Telegram.WebApp.initDataUnsafe.user?.id;

const books = [
  {
    id: "bart",
    title: "Мифообразование в современном мире",
    author: "Ролан Барт",
    cover_url: "https://upload.wikimedia.org/wikipedia/ru/thumb/1/1f/Roland_Barthes.jpg/200px-Roland_Barthes.jpg",
    status: "read",
    rating: 5,
    comment: "",
    added_at: "2024-04-12",
    finished_at: "2024-04-12"
  },
  {
    id: "wilde",
    title: "Портрет Дориана Грея",
    author: "Оскар Уайльд",
    cover_url: "https://upload.wikimedia.org/wikipedia/ru/e/e7/Portret_doriana.jpg",
    status: "read",
    rating: 4.5,
    comment: "",
    added_at: "2024-03-02",
    finished_at: "2024-03-02"
  },
  {
    id: "atwood",
    title: "Слепой убийца",
    author: "Маргарет Этвуд",
    cover_url: "https://upload.wikimedia.org/wikipedia/ru/5/56/The_Blind_Assassin.jpg",
    status: "read",
    rating: 5,
    comment: "",
    added_at: "2024-01-15",
    finished_at: "2024-01-15"
  }
];

let currentTab = "read";

function renderMainScreen() {
  const container = document.getElementById("app");
  const filtered = books.filter(b => b.status === currentTab);

  container.innerHTML = `
    <h2>📘 Мой книжный трекер</h2>

    <div class="nav-tabs">
      <div class="nav-tab ${currentTab === 'reading' ? 'active' : ''}" onclick="switchTab('reading')">Читаю</div>
      <div class="nav-tab ${currentTab === 'read' ? 'active' : ''}" onclick="switchTab('read')">Прочитал</div>
      <div class="nav-tab ${currentTab === 'want_to_read' ? 'active' : ''}" onclick="switchTab('want_to_read')">Хочу прочитать</div>
    </div>

    <button onclick="addBookManually()">+ Добавить книгу</button>

    <div id="book-list">
      ${filtered.map(renderBookCard).join("")}
    </div>

    <div class="footer-buttons">
      <button>📊 Статистика</button>
      <button>🔍 Поиск / рекомендации</button>
    </div>
  `;
}

function switchTab(tab) {
  currentTab = tab;
  renderMainScreen();
}

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

function addBookManually() {
  alert("Форма добавления книги — в разработке...");
}

renderMainScreen();
