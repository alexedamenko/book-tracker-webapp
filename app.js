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

window.renderMainScreen = async function() {
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
      <button id="exportBtn">📤Export</button>
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
      <img src="${book.cover_url}" alt="${book.title}" onclick="showZoom('${book.cover_url}')" />
      
      <div class="info">
        <div class="main-block">
          <b class="book-title">${book.title}</b>
          <i class="book-author">${book.author}</i>
          ${book.rating ? `<div class="stars">${renderStars(book.rating)}</div>` : ""}
          ${book.started_at ? `<div>📖 ${book.started_at}</div>` : ""}
          ${book.finished_at ? `<div>🏁 ${book.finished_at}</div>` : ""}
          ${book.comment ? `<div class="comment-preview"><button onclick="openComment('${book.id}')">💬 Заметки/Выводы</button></div>` : ""}

        </div>

        <div class="card-actions">
          <button class="icon-btn" onclick="editBook('${book.id}')">✏️</button>
          <button class="icon-btn" onclick="deleteBook('${book.id}')">🗑️</button>
        </div>

         </div>
    </div>
  `;
}

function renderStars(rating = 0) {
  const fullStar = '★';
  const emptyStar = '☆';
  return [...Array(5)].map((_, i) => i < rating ? fullStar : emptyStar).join('');
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

      <input type="date" id="started_at" placeholder="Дата начала (необязательно)" />
      <input type="date" id="finished_at" placeholder="Дата окончания (необязательно)" />

      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>

    <button class="back-btn" onclick="renderMainScreen()">← Назад</button>
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
    comment: document.getElementById("comment").value.trim(),
    added_at: new Date().toISOString().split("T")[0],
    finished_at: document.getElementById("status").value === 'read' ? new Date().toISOString().split("T")[0] : null
  };
  await addBook(book);
  currentTab = book.status;
  renderMainScreen();
};

window.editBook = function(id) {
  const book = books.find(b => b.id === id);
  const container = document.getElementById("app");

  container.innerHTML = `
    <h2>✏️ Редактирование книги</h2>
    <form id="editForm">
      <input type="text" id="title" value="${book.title}" required />
      <input type="text" id="author" value="${book.author}" required />
      <input type="url" id="cover_url" value="${book.cover_url}" />
      <input type="date" id="added_at" value="${book.added_at || ""}" />
      <input type="date" id="started_at" value="${book.started_at || ""}" />
      <input type="date" id="finished_at" value="${book.finished_at || ""}" />
      <select id="status">
        <option value="want_to_read" ${book.status === 'want_to_read' ? 'selected' : ''}>Хочу прочитать</option>
        <option value="reading" ${book.status === 'reading' ? 'selected' : ''}>Читаю</option>
        <option value="read" ${book.status === 'read' ? 'selected' : ''}>Прочитал</option>
      </select>
      <select id="rating">
        <option value="">Без оценки</option>
        ${[1,2,3,4,5].map(n => `<option value="${n}" ${book.rating === n ? 'selected' : ''}>⭐ ${n}</option>`).join("")}
      </select>
      <button type="submit">💾 Сохранить</button>
    </form>
    <button id="backBtn">← Назад</button>
  `;

  document.getElementById("backBtn").addEventListener("click", renderMainScreen);

  document.getElementById("editForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    
    const updated = {
      title: document.getElementById("title").value.trim(),
      author: document.getElementById("author").value.trim(),
      cover_url: document.getElementById("cover_url").value.trim(),
      status: document.getElementById("status").value,
      rating: document.getElementById("rating").value ? Number(document.getElementById("rating").value) : null,
      comment: document.getElementById("comment").value.trim(),
      added_at: document.getElementById("added_at").value || null,
      started_at: document.getElementById("started_at").value || null,
      finished_at: document.getElementById("finished_at").value || null
    };

    const { error } = await supabase
      .from("user_books")
      .update(updated)
      .eq("id", id);

    if (error) {
      console.error("Ошибка при обновлении:", error);
      alert("❌ Не удалось сохранить изменения");
    } else {
      alert("✅ Сохранено");
      renderMainScreen();
    }
  });
};


window.submitEditForm = async function(e, id) {
  e.preventDefault();

  const ratingValue = document.getElementById("rating").value;
  const updated = {
    title: document.getElementById("title").value.trim(),
    author: document.getElementById("author").value.trim(),
    cover_url: document.getElementById("cover_url").value.trim(),
    status: document.getElementById("status").value,
    rating: ratingValue ? Number(ratingValue) : null,
    comment: document.getElementById("comment").value.trim(),
    added_at: document.getElementById("added_at").value || null,
    started_at: document.getElementById("started_at").value || null,
    finished_at: document.getElementById("finished_at").value || null
  };

  const { error } = await supabase
    .from('user_books')
    .update(updated)
    .eq("id", id);

  if (error) {
    console.error(error);
    alert("❌ Ошибка при обновлении книги");
    return;
  }

  alert("✅ Сохранено");
  renderMainScreen(); // перерисовываем
};
window.deleteBook = async function(id) {
  const confirmDelete = confirm("Удалить эту книгу? Это действие нельзя отменить.");
  if (!confirmDelete) return;

  const { error } = await supabase.from("user_books").delete().eq("id", id);
  if (error) {
    alert("❌ Ошибка при удалении");
    return;
  }

  alert("🗑 Книга удалена");
  await renderMainScreen();
};



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

window.zoomImage = function (url) {
  const overlay = document.getElementById("zoom-overlay");
  const img = document.getElementById("zoom-image");
  img.src = url;
  overlay.classList.remove("hidden");
};

window.closeZoom = function () {
  document.getElementById("zoom-overlay").classList.add("hidden");
};
window.showZoom = function (url) {
  const overlay = document.getElementById("zoom-overlay");
  const img = document.getElementById("zoom-image");
  img.src = url;
  overlay.classList.remove("hidden");
};

window.closeZoom = function () {
  document.getElementById("zoom-overlay").classList.add("hidden");
};

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



window.saveComment = async function(bookId) {
  const newComment = toastEditor.getMarkdown(); // Или .getHTML() — как тебе удобнее

  const { error } = await supabase
    .from("user_books")
    .update({ comment: newComment })
    .eq("id", bookId)
    .eq("user_id", userId);

  if (error) {
    alert("Ошибка при сохранении");
    return;
  }

  renderMainScreen();
};

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
