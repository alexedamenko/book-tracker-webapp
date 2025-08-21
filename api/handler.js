// 📁 handler.js — единая серверная функция (масштабируемая)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
// Обязательно: если используешь чтение req.body от Next.js
export const config = { api: { bodyParser: true } };
// Универсальный JSON-ридер: берёт req.body (Next), иначе читает поток
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

// ==== timeouts & helpers ====
const FAST_TIMEOUT = 2500; // мс
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
// Всегда ходим наружу с понятным UA/языком
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'application/json,text/html;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
};

async function fetchWithTimeout(url, opts={}, ms=FAST_TIMEOUT){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort('timeout'), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}
async function safe(p){ try { return await p; } catch { return null; } }
const CYR = /[А-Яа-яЁё]/;
function pickBest(cands=[]){
  if(!cands.length) return null;
  for(const c of cands){
    let s = 0;
    if(c.language === 'ru') s+=4;
    if(CYR.test((c.title||''))) s+=3;
    if(CYR.test((c.authors||''))) s+=2;
    if(c.cover_url) s+=1;
    c._score = s;
  }
  cands.sort((a,b)=>(b._score||0)-(a._score||0));
  return cands[0];
}


// 📌 Маршруты API
const routes = {
  async getBooks(req, res, params) {
    const userId = params.get("user_id");
    if (!userId) return res.status(400).json({ error: "Не указан user_id" });

    const { data, error } = await supabase
      .from('user_books')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
  },

  async addBook(req, res) {
     try {
    const book = await readJsonBody(req);
    if (!book?.title || !book?.author || !book?.user_id) {
      return res.status(400).json({ error: "user_id, title и author обязательны" });
    }

    // опциональная защита от дублей по isbn13 для пользователя
    if (book.isbn13) {
      const { data: dupe } = await supabase
        .from("user_books")
        .select("id")
        .eq("user_id", book.user_id)
        .eq("isbn13", book.isbn13)
        .limit(1);
      if (dupe && dupe.length) {
        return res.status(409).json({ error: "Эта книга уже есть у тебя (ISBN совпадает)" });
      }
    }

    const { data, error } = await supabase
      .from("user_books")
      .insert([book])
      .select("id")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ id: data.id });
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
  }
  },

  async searchBooks(req, res, params) {
    const query = params.get("query") || "";
    if (!query) return res.status(400).json({ error: "Нет запроса поиска" });

    const { data, error } = await supabase
      .from("books_library")
      .select("title, author, cover_url")
      .ilike("title", `%${query}%`)
      .limit(5);

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
  }
};


// GET /api/handler?route=listCollections&user_id=...
routes.listCollections = async (req, res, params) => {
  const userId = params.get('user_id');
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const { data, error } = await supabase
    .from('collections')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

// POST JSON { user_id, name, icon?, color? }
routes.createCollection = async (req, res) => {
  const { user_id, name, icon, color } = await readJsonBody(req);
  if (!user_id || !name) return res.status(400).json({ error: 'user_id & name required' });

  const { data, error } = await supabase
    .from('collections')
    .insert([{ user_id, name, icon: icon || null, color: color || null }])
    .select('id').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ id: data.id });
};

// POST JSON { id, name?, icon?, color?, sort_order? }
routes.renameCollection = async (req, res) => {
  const { id, ...fields } = await readJsonBody(req);
  if (!id) return res.status(400).json({ error: 'id required' });

  const { error } = await supabase.from('collections').update(fields).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
};

// POST JSON { id }  (удалит и связи из-за ON DELETE CASCADE)
routes.deleteCollection = async (req, res) => {
  const { id } = await readJsonBody(req);
  if (!id) return res.status(400).json({ error: 'id required' });

  const { error } = await supabase.from('collections').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
};

// === Items (связи книга ↔ коллекция) ===

// POST JSON { user_id, book_id, collection_ids: [] }
// Полностью заменяет список полок для книги (atomic на уровне API)
routes.setBookCollections = async (req, res) => {
  const { user_id, book_id, collection_ids } = await readJsonBody(req);
  if (!user_id || !book_id || !Array.isArray(collection_ids))
    return res.status(400).json({ error: 'user_id, book_id, collection_ids required' });

  // Текущие связи
  const { data: cur, error: e1 } = await supabase
    .from('collection_items')
    .select('collection_id')
    .eq('user_id', user_id)
    .eq('book_id', book_id);
  if (e1) return res.status(500).json({ error: e1.message });

  const current = new Set((cur || []).map(r => r.collection_id));
  const wanted  = new Set(collection_ids);

  const toAdd = [...wanted].filter(id => !current.has(id));
  const toDel = [...current].filter(id => !wanted.has(id));

  if (toAdd.length) {
    const rows = toAdd.map(cid => ({ user_id, book_id, collection_id: cid }));
    const { error: e2 } = await supabase.from('collection_items').insert(rows);
    if (e2) return res.status(500).json({ error: e2.message });
  }
  if (toDel.length) {
    const { error: e3 } = await supabase
      .from('collection_items')
      .delete()
      .eq('user_id', user_id)
      .eq('book_id', book_id)
      .in('collection_id', toDel);
    if (e3) return res.status(500).json({ error: e3.message });
  }

  res.json({ success: true, added: toAdd.length, removed: toDel.length });
};

// GET /api/handler?route=listBookCollections&book_id=...
routes.listBookCollections = async (req, res, params) => {
  const bookId = params.get('book_id');
  if (!bookId) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('collection_items')
    .select('collection_id')
    .eq('book_id', bookId);

  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(r => r.collection_id));
};

// GET /api/handler?route=listAllBookCollections&user_id=...
// Вернёт пары {book_id, collection_id} для быстрого фильтра на клиенте
routes.listAllBookCollections = async (req, res, params) => {
  const userId = params.get('user_id');
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const { data, error } = await supabase
    .from('collection_items')
    .select('book_id, collection_id')
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
};

// (опционально) GET /api/handler?route=getBooksByCollection&user_id=...&collection_id=...&status=read|reading|want
routes.getBooksByCollection = async (req, res, params) => {
  const userId = params.get('user_id');
  const collectionId = params.get('collection_id');
  const status = params.get('status');
  if (!userId || !collectionId) return res.status(400).json({ error: 'user_id & collection_id required' });

  // сначала id книг
  const { data: ids, error: e1 } = await supabase
    .from('collection_items')
    .select('book_id')
    .eq('user_id', userId)
    .eq('collection_id', collectionId);
  if (e1) return res.status(500).json({ error: e1.message });

  const bookIds = (ids || []).map(r => r.book_id);
  if (!bookIds.length) return res.json([]);

  let q = supabase.from('user_books').select('*').in('id', bookIds);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

// === ISBN LOOKUP (кэш + Google/OpenLibrary) ===
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

async function getFromCacheByIsbn13(isbn13, supabase) {
  const { data } = await supabase
    .from('books_cache')
    .select('*')
    .eq('isbn13', isbn13)
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function saveToCache(meta, supabase) {
  await supabase.from('books_cache').upsert({
    isbn13: meta.isbn13,
    isbn10: meta.isbn10 || null,
    title: meta.title || '',
    authors: meta.authors || '',
    publisher: meta.publisher || '',
    published_year: meta.published_year || null,
    language: meta.language || null,
    page_count: meta.page_count || null,
    description: meta.description || '',
    cover_url: meta.cover_url || null,
    raw: meta._raw || null
  }, { onConflict: 'isbn13' });
}

async function fetchGoogle(isbn13){
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.items || !j.items.length) return null;
  const v = j.items[0].volumeInfo;
  const ids = (v.industryIdentifiers||[]);
  const isbn10 = ids.find(i=>i.type==='ISBN_10')?.identifier || null;
  const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
  return {
    source: 'google',
    isbn13,
    isbn10,
    title: v.title || '',
    authors: v.authors?.join(', ') || '',
    publisher: v.publisher || '',
    published_year: (v.publishedDate||'').slice(0,4) || null,
    language: v.language || null,
    page_count: v.pageCount || null,
    description: v.description || '',
    cover_url: thumb ? thumb.replace('http://','https://') : null,
    _raw: j
  };
}

async function fetchOpenLibrary(isbn13){
  const r = await fetch(`https://openlibrary.org/isbn/${isbn13}.json`);
  if (!r.ok) return null;
  const j = await r.json();
  const publish_date = (Array.isArray(j.publish_date)? j.publish_date[0]: j.publish_date) || '';
  const published_year = publish_date ? publish_date.slice(-4) : null;
  const authors = Array.isArray(j.authors) ? j.authors.map(a=>a.name||a.key).join(', ') : '';
  const cover = `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`;
  return {
    source: 'openlibrary',
    isbn13,
    isbn10: null,
    title: j.title || '',
    authors,
    publisher: Array.isArray(j.publishers)? j.publishers[0] : (j.publishers||''),
    published_year,
    language: (Array.isArray(j.languages)&&j.languages[0]?.key?.split('/').pop()) || null,
    page_count: j.number_of_pages || null,
    description: typeof j.description === 'string' ? j.description : (j.description?.value || ''),
    cover_url: cover,
    _raw: j
  };
}

// --- OpenLibrary helpers для русских изданий ---
async function fetchOL_IsbnJson(isbn) {
  const r = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!r.ok) return null;
  const j = await r.json();
  const publish_date = (Array.isArray(j.publish_date)? j.publish_date[0]: j.publish_date) || '';
  const published_year = publish_date ? publish_date.slice(-4) : null;
  const authors = Array.isArray(j.authors) ? j.authors.map(a=>a.name||a.key).join(', ') : '';
  const cover = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  return {
    source: 'openlibrary:isbn',
    isbn13: /^\d{13}$/.test(isbn) ? isbn : null,
    isbn10: /^\d{10}$/.test(isbn) ? isbn : null,
    title: j.title || '',
    authors,
    publisher: Array.isArray(j.publishers)? j.publishers[0] : (j.publishers||''),
    published_year,
    language: (Array.isArray(j.languages)&&j.languages[0]?.key?.split('/').pop()) || null,
    page_count: j.number_of_pages || null,
    description: typeof j.description === 'string' ? j.description : (j.description?.value || ''),
    cover_url: cover,
    _raw: j
  };
}

async function fetchOL_Bibkeys(isbn) {
  const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!r.ok) return null;
  const j = await r.json();
  const k = `ISBN:${isbn}`;
  const d = j[k];
  if (!d) return null;
  const title = d.title || '';
  const authors = Array.isArray(d.authors) ? d.authors.map(a=>a.name).join(', ') : '';
  const cover = d.cover?.large || d.cover?.medium || d.cover?.small || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  const pub = Array.isArray(d.publishers) ? d.publishers[0]?.name : (d.publishers?.name || '');
  const year = (d.publish_date || '').slice(-4) || null;
  return {
    source: 'openlibrary:api_books',
    isbn13: /^\d{13}$/.test(isbn) ? isbn : null,
    isbn10: /^\d{10}$/.test(isbn) ? isbn : null,
    title,
    authors,
    publisher: pub || '',
    published_year: year,
    language: (Array.isArray(d.languages) && d.languages[0]?.key?.split('/').pop()) || null,
    page_count: d.number_of_pages || null,
    description: '',
    cover_url: cover,
    _raw: d
  };
}

async function fetchOL_SearchByIsbn(isbn) {
  const r = await fetch(`https://openlibrary.org/search.json?isbn=${isbn}`);
  if (!r.ok) return null;
  const j = await r.json();
  const doc = Array.isArray(j.docs) && j.docs[0];
  if (!doc) return null;
  const title = doc.title || doc.title_suggest || '';
  const authors = Array.isArray(doc.author_name) ? doc.author_name.join(', ') : '';
  const year = doc.first_publish_year ? String(doc.first_publish_year) : null;
  const cover = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  return {
    source: 'openlibrary:search',
    isbn13: /^\d{13}$/.test(isbn) ? isbn : null,
    isbn10: /^\d{10}$/.test(isbn) ? isbn : null,
    title,
    authors,
    publisher: '',
    published_year: year,
    language: (Array.isArray(doc.language) && doc.language[0]) || null,
    page_count: null,
    description: '',
    cover_url: cover,
    _raw: doc
  };
}

// ISBN-13 → ISBN-10 (только для префикса 978)
function isbn13to10(isbn13) {
  const s = (isbn13||'').replace(/\D/g,'');
  if (!/^978\d{10}$/.test(s)) return null;
  const core9 = s.slice(3,12);
  let sum = 0;
  for (let i=0;i<9;i++) sum += (10 - i) * parseInt(core9[i],10);
  let check10 = (11 - (sum % 11)) % 11;
  return core9 + (check10 === 10 ? 'X' : String(check10));
}

// Зеркалим обложку в Supabase Storage (bucket: 'covers')
async function mirrorCoverToSupabase(url) {
  try {
    if (!url) return null;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const ext = (url.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
    const key = `isbn_covers/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    const { data, error } = await supabase.storage.from('covers').upload(key, buf, {
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      upsert: false
    });
    if (error) return null;

    const { data: pub } = supabase.storage.from('covers').getPublicUrl(key);
    return pub?.publicUrl || null;
  } catch { return null; }
}

// Ритейлеры: вытаскиваем JSON-LD (книга + картинка), часто лучше по RU
// Лабиринт: ищем → переходим на первую карточку → парсим JSON-LD/og
async function fetchLabirint(isbn){
  try{
    const headers = {
      'User-Agent':'Mozilla/5.0',
      'Accept-Language':'ru-RU,ru;q=0.9,en-US;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer':'https://www.labirint.ru/'
    };
    const searchUrl = `https://www.labirint.ru/search/${isbn}/?stype=0`;
    const r = await fetchWithTimeout(searchUrl, { headers }, FAST_TIMEOUT);
    if(!r?.ok) return null;
    const html = await r.text();

    let m = html.match(/href="(\/books\/\d+\/)"/i);
    let detailUrl = m ? `https://www.labirint.ru${m[1]}` : null;
    if(!detailUrl){
      const m2 = html.match(/data-product-id="(\d+)"/i);
      if(m2) detailUrl = `https://www.labirint.ru/books/${m2[1]}/`;
    }
    if(!detailUrl) return null;

    const r2 = await fetchWithTimeout(detailUrl, { headers }, FAST_TIMEOUT);
    if(!r2?.ok) return null;
    const html2 = await r2.text();

    const blocks = html2.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if(blocks){
      for(const block of blocks){
        try{
          const json = JSON.parse(block.replace(/^[\s\S]*?<script[^>]*>/,'').replace(/<\/script>[\s\S]*$/,''));
          const item = Array.isArray(json)
            ? json.find(x => x && (x['@type']==='Book' || (Array.isArray(x['@type']) && x['@type'].includes('Book'))))
            : (json && (json['@type']==='Book' || (Array.isArray(json['@type']) && json['@type'].includes('Book'))) ? json : null);
          if(item){
            const title = item.name || item.headline || '';
            const authors = Array.isArray(item.author) ? item.author.map(a=>a?.name).filter(Boolean).join(', ') : (item.author?.name||'');
            let cover = null;
            if(typeof item.image === 'string') cover = item.image;
            else if(Array.isArray(item.image)) cover = item.image.find(Boolean) || null;

            return {
              source:'labirint',
              isbn13:/^\d{13}$/.test(isbn)?isbn:null,
              isbn10:/^\d{10}$/.test(isbn)?isbn:null,
              title, authors,
              publisher:'', published_year:null,
              language: CYR.test(title+' '+authors)?'ru':null,
              page_count:null, description:'',
              cover_url: cover || null,
              _raw:{ detail: detailUrl }
            };
          }
        }catch{}
      }
    }
    const ogTitle = html2.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]||'';
    const ogImg   = html2.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1]||'';
    if(ogTitle){
      return {
        source:'labirint:og',
        isbn13:/^\d{13}$/.test(isbn)?isbn:null,
        isbn10:/^\d{10}$/.test(isbn)?isbn:null,
        title: ogTitle, authors:'', publisher:'', published_year:null,
        language: CYR.test(ogTitle)?'ru':null,
        page_count:null, description:'',
        cover_url: ogImg || null,
        _raw:{ detail: detailUrl, og:true }
      };
    }
    return null;
  }catch{ return null; }
}

// Литрес: то же самое
async function fetchLitres(isbn){
  try{
    const headers = {
      'User-Agent':'Mozilla/5.0',
      'Accept-Language':'ru-RU,ru;q=0.9,en-US;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer':'https://www.litres.ru/'
    };
    const r = await fetchWithTimeout(`https://www.litres.ru/search/?q=${encodeURIComponent(isbn)}`, { headers }, FAST_TIMEOUT);
    if(!r?.ok) return null;
    const html = await r.text();

    const m = html.match(/href="(\/book\/[^"?#]+\/)"/i);
    if(!m) return null;
    const detailUrl = `https://www.litres.ru${m[1]}`;

    const r2 = await fetchWithTimeout(detailUrl, { headers }, FAST_TIMEOUT);
    if(!r2?.ok) return null;
    const html2 = await r2.text();

    const blocks = html2.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if(blocks){
      for(const block of blocks){
        try{
          const json = JSON.parse(block.replace(/^[\s\S]*?<script[^>]*>/,'').replace(/<\/script>[\s\S]*$/,''));
          const item = Array.isArray(json)
            ? json.find(x => x && (x['@type']==='Book' || (Array.isArray(x['@type']) && x['@type'].includes('Book'))))
            : (json && (json['@type']==='Book' || (Array.isArray(json['@type']) && json['@type'].includes('Book'))) ? json : null);
          if(item){
            const title = item.name || item.headline || '';
            const authors = Array.isArray(item.author) ? item.author.map(a=>a?.name).filter(Boolean).join(', ') : (item.author?.name||'');
            let cover = null;
            if(typeof item.image === 'string') cover = item.image;
            else if(Array.isArray(item.image)) cover = item.image.find(Boolean) || null;
            return {
              source:'litres',
              isbn13:/^\d{13}$/.test(isbn)?isbn:null,
              isbn10:/^\d{10}$/.test(isbn)?isbn:null,
              title: title||'', authors: authors||'',
              publisher:'', published_year:null,
              language: CYR.test(title+' '+authors)?'ru':null,
              page_count:null, description:'',
              cover_url: cover || null,
              _raw:{ detail: detailUrl, jsonld:true }
            };
          }
        }catch{}
      }
    }
    const ogTitle = html2.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]||'';
    const ogImg   = html2.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1]||'';
    if(ogTitle){
      return {
        source:'litres:og',
        isbn13:/^\d{13}$/.test(isbn)?isbn:null,
        isbn10:/^\d{10}$/.test(isbn)?isbn:null,
        title: ogTitle, authors:'', publisher:'', published_year:null,
        language: CYR.test(ogTitle)?'ru':null,
        page_count:null, description:'',
        cover_url: ogImg || null,
        _raw:{ detail: detailUrl, og:true }
      };
    }
    return null;
  }catch{ return null; }
}


    
// --- КАНДИДАТЫ (каждый сразу возвращает нормализованный объект книги или null) ---
async function googleCandidate(isbn13) {
  const r = await fetchWithTimeout(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`
      { headers: DEFAULT_HEADERS }
  );
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  const v = j?.items?.[0]?.volumeInfo;
  if (!v) return null;
  const ids = v.industryIdentifiers || [];
  const isbn10 = ids.find(i => i.type === 'ISBN_10')?.identifier || null;
  const cover = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
  return {
    source: 'google',
    isbn13,
    isbn10,
    title: v.title || '',
    authors: Array.isArray(v.authors) ? v.authors.join(', ') : '',
    publisher: v.publisher || '',
    published_year: (v.publishedDate || '').slice(0, 4) || null,
    language: v.language || null,
    page_count: v.pageCount || null,
    description: v.description || '',
    cover_url: cover ? cover.replace('http://', 'https://') : null,
  };
}

async function olIsbnCandidate(isbn13) {
  const r = await fetchWithTimeout(`https://openlibrary.org/isbn/${isbn13}.json`);
    { headers: DEFAULT_HEADERS }
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j) return null;
  const publish_date = Array.isArray(j.publish_date) ? j.publish_date[0] : j.publish_date;
  const published_year = publish_date ? String(publish_date).slice(-4) : null;
  const authors = Array.isArray(j.authors)
    ? j.authors.map(a => a.name || a.key).join(', ')
    : '';
  return {
    source: 'openlibrary:isbn',
    isbn13,
    title: j.title || '',
    authors,
    publisher: Array.isArray(j.publishers) ? j.publishers[0] : (j.publishers || ''),
    published_year,
    language: (Array.isArray(j.languages) && j.languages[0]?.key?.split('/').pop()) || null,
    page_count: j.number_of_pages || null,
    description: typeof j.description === 'string' ? j.description : (j.description?.value || ''),
    cover_url: `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`,
  };
}

async function olBibkeysCandidate(isbn13) {
  const r = await fetchWithTimeout(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`
      { headers: DEFAULT_HEADERS }
  );
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  const d = j && j[`ISBN:${isbn13}`];
  if (!d) return null;
  const title = d.title || '';
  const authors = Array.isArray(d.authors) ? d.authors.map(a => a.name).join(', ') : (d.authors?.name || '');
  const cover = d.cover?.large || d.cover?.medium || d.cover?.small || `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`;
  const pub = Array.isArray(d.publishers) ? d.publishers[0]?.name : (d.publishers?.name || '');
  const year = (d.publish_date || '').slice(-4) || null;
  return {
    source: 'openlibrary:api_books',
    isbn13,
    title,
    authors,
    publisher: pub || '',
    published_year: year,
    language: (Array.isArray(d.languages) && d.languages[0]?.key?.split('/').pop()) || null,
    page_count: d.number_of_pages || null,
    description: '',
    cover_url: cover,
  };
}

async function olSearchCandidate(isbn13) {
  const r = await fetchWithTimeout(`https://openlibrary.org/search.json?isbn=${isbn13}`);
    { headers: DEFAULT_HEADERS }
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  const doc = Array.isArray(j?.docs) && j.docs[0];
  if (!doc) return null;
  const title = doc.title || doc.title_suggest || '';
  const authors = Array.isArray(doc.author_name) ? doc.author_name.join(', ') : '';
  const year = doc.first_publish_year ? String(doc.first_publish_year) : null;
  return {
    source: 'openlibrary:search',
    isbn13,
    title,
    authors,
    publisher: '',
    published_year: year,
    language: (Array.isArray(doc.language) && doc.language[0]) || null,
    page_count: null,
    description: '',
    cover_url: `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`,
  };
}

   
// GET /api/handler?route=isbnLookup&isbn=...
routes.isbnLookup = async (req, res, params) => {
  const debug = params.get('debug') === '1';
  const raw = params.get('isbn') || '';
  const isbn13 = normalizeToIsbn13(raw);
  if (!isbn13) return res.status(400).json({ error: 'Некорректный ISBN' });

  // кэш
  const cached = await getFromCacheByIsbn13(isbn13, supabase);
  if (cached && !debug) return res.json(cached);

  const startedAt = Date.now();
  const steps = [];
  const mark = (name, ok, ms, err) => steps.push({ name, ok, ms, err });

  // Параллельно запускаем задачи — КАЖДАЯ возвращает уже нормализованного кандидата
  const tasks = [
    ['google',     () => googleCandidate(isbn13)],
    ['ol:isbn',    () => olIsbnCandidate(isbn13)],
    ['ol:bibkeys', () => olBibkeysCandidate(isbn13)],
    ['ol:search',  () => olSearchCandidate(isbn13)],
    ['labirint',   () => fetchLabirint(isbn13)],
    ['litres',     () => fetchLitres(isbn13)],
  ];

  const settled = await Promise.all(tasks.map(async ([name, fn]) => {
    const t = Date.now();
    try {
      const val = await fn();
      mark(name, !!val, Date.now() - t);
      return val;
    } catch (e) {
      mark(name, false, Date.now() - t, String(e));
      return null;
    }
  }));

  const candidates = settled.filter(Boolean);

  if (!candidates.length) {
    const payload = { error: 'Не найдено в источниках' };
    if (debug) payload._debug = { steps, total_ms: Date.now() - startedAt };
    return res.status(404).json(payload);
  }

  // Выбираем лучшего кандидата по «русскости» и наличию обложки
  let best = pickBest(candidates);
  if (!best.language && /^9785/.test(isbn13)) best.language = 'ru';
  if (!best.cover_url) best.cover_url = `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`;
  best.isbn13 = best.isbn13 || isbn13;

  await saveToCache(best, supabase);
  if (debug) return res.json({ ...best, _debug: { steps, total_ms: Date.now() - startedAt } });
  return res.json(best);
};






// 📌 Главный обработчик
export default async function handler(req, res) {
  // CORS (если тестируешь с фронта локально)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const fullUrl = new URL(req.url, `http://${req.headers.host}`);
  const route = fullUrl.searchParams.get("route");
  const params = fullUrl.searchParams;

  console.log(`📥 ${req.method} /api/handler?route=${route}`);

  if (!route || !routes[route]) {
    return res.status(404).json({ error: "Route not found" });
  }

  // Вызываем маршрут
  try {
    await routes[route](req, res, params);
  } catch (err) {
    console.error(`❌ Ошибка в маршруте "${route}":`, err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ====== ПРОФИЛИ / ДРУЗЬЯ ======

// POST { user_id, username?, name?, avatar_url? } — обновляем/создаём профиль
routes.upsertProfile = async (req, res) => {
  const { user_id, username, name, avatar_url } = await readJsonBody(req);
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { error } = await supabase
    .from('user_profiles')
    .upsert([{ user_id, username, name, avatar_url, updated_at: new Date().toISOString() }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
};

// GET ?user_id=... — список друзей (массив профилей)
routes.listFriends = async (req, res, params) => {
  const userId = params.get('user_id');
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  // найдём все пары, где userId участвует
  const { data: pairs, error: e1 } = await supabase
    .from('friendships')
    .select('user_a, user_b')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (e1) return res.status(500).json({ error: e1.message });

  const ids = new Set();
  for (const p of (pairs || [])) {
    ids.add(p.user_a === userId ? p.user_b : p.user_a);
  }
  if (!ids.size) return res.json([]);

  const { data: profs, error: e2 } = await supabase
    .from('user_profiles')
    .select('*')
    .in('user_id', [...ids]);
  if (e2) return res.status(500).json({ error: e2.message });

  res.json(profs || []);
};

// POST { from_user, to_username } — отправить заявку по @username
routes.sendFriendRequest = async (req, res) => {
  const { from_user, to_username } = await readJsonBody(req);
  if (!from_user || !to_username) return res.status(400).json({ error: 'from_user & to_username required' });

  const uname = to_username.replace(/^@/, '').toLowerCase();
  const { data: to, error: e1 } = await supabase
    .from('user_profiles').select('user_id, username')
    .eq('username', uname).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!to) return res.status(404).json({ error: 'Пользователь не найден' });
  if (to.user_id === from_user) return res.status(400).json({ error: 'Нельзя добавить себя' });

  const { error: e2 } = await supabase.from('friend_requests')
    .insert([{ from_user, to_user: to.user_id, status: 'pending' }]);
  if (e2) return res.status(500).json({ error: e2.message });
  res.json({ success: true });
};

// GET ?user_id=... — входящие заявки
routes.listFriendRequests = async (req, res, params) => {
  const userId = params.get('user_id');
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const { data, error } = await supabase
    .from('friend_requests')
    .select('id, from_user, created_at')
    .eq('to_user', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // подтянем профили отправителей
  const ids = data.map(d => d.from_user);
  let profs = [];
  if (ids.length) {
    const resp = await supabase.from('user_profiles').select('*').in('user_id', ids);
    profs = resp.data || [];
  }
  res.json({ requests: data, profiles: profs });
};

// POST { request_id, accept: true|false }
routes.respondFriendRequest = async (req, res) => {
  const { request_id, accept } = await readJsonBody(req);
  if (!request_id) return res.status(400).json({ error: 'request_id required' });

  const { data: reqRow, error: e1 } = await supabase
    .from('friend_requests').select('*').eq('id', request_id).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!reqRow || reqRow.status !== 'pending') return res.status(400).json({ error: 'Request not pending' });

  // обновим статус
  const { error: e2 } = await supabase
    .from('friend_requests')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', request_id);
  if (e2) return res.status(500).json({ error: e2.message });

  if (accept) {
    const a = reqRow.from_user < reqRow.to_user ? reqRow.from_user : reqRow.to_user;
    const b = reqRow.from_user < reqRow.to_user ? reqRow.to_user : reqRow.from_user;
    await supabase.from('friendships').insert([{ user_a: a, user_b: b }]);
  }
  res.json({ success: true });
};

// GET ?user_id=... — «что читают друзья сейчас» (статус reading)
routes.friendsReadingNow = async (req, res, params) => {
  const userId = params.get('user_id');
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const { data: pairs } = await supabase
    .from('friendships').select('user_a,user_b')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  const ids = new Set();
  for (const p of (pairs || [])) ids.add(p.user_a === userId ? p.user_b : p.user_a);
  if (!ids.size) return res.json([]);

  const { data: books } = await supabase
    .from('user_books')
    .select('user_id,id,title,author,cover_url,started_at,status,rating')
    .in('user_id', [...ids])
    .eq('status', 'reading');
  res.json(books || []);
};


// ====== ГРУППЫ / КНИГА НЕДЕЛИ ======

// POST { owner_id, name } -> { group_id, invite_code }
routes.createGroup = async (req, res) => {
  const { owner_id, name } = await readJsonBody(req);
  if (!owner_id || !name) return res.status(400).json({ error: 'owner_id & name required' });

  const invite = Math.random().toString(36).slice(2, 8); // простой код
  const { data, error } = await supabase
    .from('groups')
    .insert([{ owner_id, name, invite_code: invite }])
    .select('id, invite_code').single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('group_members').insert([{ group_id: data.id, user_id: owner_id, role: 'owner' }]);
  res.json({ group_id: data.id, invite_code: data.invite_code });
};

// GET ?user_id=... -> список моих групп (+кол-во участников)
routes.listGroups = async (req, res, params) => {
  try {
    const uid = params.get('user_id');
    if (!uid) return res.status(400).json({ error: 'user_id required' });

    // мои membership'ы
    const { data: memberships, error: e1 } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', uid);
    if (e1) return res.status(500).json({ error: e1.message });

    const ids = (memberships || []).map(m => m.group_id);
    if (!ids.length) return res.json([]); // нет групп — пустой массив

    // сами группы
    const { data: groups, error: e2 } = await supabase
      .from('groups')
      .select('id, name, owner_id, invite_code, created_at')
      .in('id', ids);
    if (e2) return res.status(500).json({ error: e2.message });

    // посчитаем участников простым вторым запросом и JS-редьюсом
    const { data: members, error: e3 } = await supabase
      .from('group_members')
      .select('group_id, user_id')
      .in('group_id', ids);
    if (e3) return res.status(500).json({ error: e3.message });

    const counts = (members || []).reduce((acc, m) => {
      acc[m.group_id] = (acc[m.group_id] || 0) + 1;
      return acc;
    }, {});

    const out = (groups || []).map(g => ({
      ...g,
      members_count: counts[g.id] || 1
    }));

    res.json(out);
  } catch (err) {
    console.error('listGroups failed:', err);
    res.status(500).json({ error: 'Internal error in listGroups' });
  }
};

// POST { user_id, invite_code } -> вступление по коду
routes.joinGroup = async (req, res) => {
  const { user_id, invite_code } = await readJsonBody(req);
  if (!user_id || !invite_code) return res.status(400).json({ error: 'user_id & invite_code required' });

  const { data: g, error: e1 } = await supabase
    .from('groups').select('id').eq('invite_code', invite_code).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!g) return res.status(404).json({ error: 'Группа не найдена' });

  await supabase.from('group_members').upsert([{ group_id: g.id, user_id }]);
  res.json({ group_id: g.id });
};

// POST { group_id, title, author?, cover_url?, start_at?, end_at? } -> активная книга
routes.setGroupBook = async (req, res) => {
  const { group_id, title, author, cover_url, start_at, end_at } = await readJsonBody(req);
  if (!group_id || !title) return res.status(400).json({ error: 'group_id & title required' });

  // снимаем активность со старых
  await supabase.from('group_books').update({ active: false }).eq('group_id', group_id).eq('active', true);

  const { data, error } = await supabase
    .from('group_books')
    .insert([{ group_id, title, author, cover_url, start_at, end_at, active: true }])
    .select('id').single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ group_book_id: data.id });
};

// GET ?group_id=... -> активная книга + список участников и их прогресс
routes.groupDashboard = async (req, res, params) => {
  const gid = params.get('group_id');
  if (!gid) return res.status(400).json({ error: 'group_id required' });

  const { data: gb } = await supabase
    .from('group_books').select('*')
    .eq('group_id', gid).eq('active', true).maybeSingle();

  const { data: members } = await supabase
    .from('group_members').select('user_id, role').eq('group_id', gid);

  let progress = [];
  if (gb) {
    const resp = await supabase
      .from('group_progress').select('*').eq('group_book_id', gb.id);
    progress = resp.data || [];
  }

  const ids = members?.map(m => m.user_id) || [];
  let profs = [];
  if (ids.length) {
    const r = await supabase.from('user_profiles').select('*').in('user_id', ids);
    profs = r.data || [];
  }

  res.json({ book: gb, members: members || [], progress, profiles: profs });
};

// POST { group_book_id, user_id, progress_pct?, current_page?, total_pages? }
routes.updateGroupProgress = async (req, res) => {
  const { group_book_id, user_id, progress_pct, current_page, total_pages } = await readJsonBody(req);
  if (!group_book_id || !user_id) return res.status(400).json({ error: 'group_book_id & user_id required' });

  const now = new Date().toISOString();
  const { error } = await supabase.from('group_progress').upsert([{
    group_book_id, user_id, progress_pct, current_page, total_pages, updated_at: now
  }], { onConflict: 'group_book_id,user_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
};

// GET ?group_book_id=... -> лента
routes.listGroupComments = async (req, res, params) => {
  const gb = params.get('group_book_id');
  if (!gb) return res.status(400).json({ error: 'group_book_id required' });
  const { data, error } = await supabase
    .from('group_comments').select('*')
    .eq('group_book_id', gb).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
};

// POST { group_book_id, user_id, text }
routes.postGroupComment = async (req, res) => {
  const { group_book_id, user_id, text } = await readJsonBody(req);
  if (!group_book_id || !user_id || !text) return res.status(400).json({ error: 'fields required' });

  const { error } = await supabase.from('group_comments')
    .insert([{ group_book_id, user_id, text }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
};

// POST { inviter_id } -> { code }
routes.createFriendInvite = async (req, res) => {
  const { inviter_id } = await readJsonBody(req);
  if (!inviter_id) return res.status(400).json({ error: 'inviter_id required' });

  // генерим уникальный код (6 символов base36, UPPER)
  for (let i = 0; i < 6; i++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { error } = await supabase.from('friend_invites').insert([{ code, inviter_id }]);
    if (!error) return res.json({ code });
    // 23505 = unique violation, пробуем ещё раз
    if (error.code !== '23505') return res.status(500).json({ error: error.message });
  }
  res.status(500).json({ error: 'Failed to generate code, try again' });
};

// POST { code, user_id } -> { success: true }
routes.acceptFriendInvite = async (req, res) => {
  const { code, user_id } = await readJsonBody(req);
  if (!code || !user_id) return res.status(400).json({ error: 'code & user_id required' });

  const up = String(user_id);

  const { data: inv, error: e1 } = await supabase
    .from('friend_invites').select('*')
    .eq('code', code.toUpperCase()).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!inv) return res.status(404).json({ error: 'Код не найден' });
  if (String(inv.inviter_id) === up) return res.status(400).json({ error: 'Нельзя добавить себя' });

  // уже использован этим же пользователем → считаем успехом
  if (inv.used_by && String(inv.used_by) !== up)
    return res.status(400).json({ error: 'Код уже использован' });

  // создаём дружбу (идемпотентно)
  const a = String(inv.inviter_id) < up ? String(inv.inviter_id) : up;
  const b = String(inv.inviter_id) < up ? up : String(inv.inviter_id);
  const { error: e2 } = await supabase
    .from('friendships')
    .upsert([{ user_a: a, user_b: b }], { onConflict: 'user_a,user_b' });
  if (e2) return res.status(500).json({ error: e2.message });

  // помечаем код использованным (идемпотентно)
  await supabase.from('friend_invites')
    .update({ used_by: up, used_at: new Date().toISOString() })
    .eq('code', inv.code);

  return res.json({ success: true });
};
// POST { user_id, friend_id } -> удалить дружбу с обеих сторон
routes.removeFriend = async (req, res) => {
  const { user_id, friend_id } = await readJsonBody(req);
  if (!user_id || !friend_id) return res.status(400).json({ error: 'user_id & friend_id required' });

  const a = String(user_id) < String(friend_id) ? String(user_id) : String(friend_id);
  const b = String(user_id) < String(friend_id) ? String(friend_id) : String(user_id);

  const { error } = await supabase
    .from('friendships').delete()
    .eq('user_a', a).eq('user_b', b);
  if (error) return res.status(500).json({ error: error.message });

  // подчистим незакрытые заявки между этими id (не обязательно, но полезно)
  await supabase.from('friend_requests')
    .delete()
    .or(`and(from_user.eq.${a},to_user.eq.${b}),and(from_user.eq.${b},to_user.eq.${a})`);

  res.json({ success: true });
};


