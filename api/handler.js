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

  const { data: inv, error: e1 } = await supabase
    .from('friend_invites').select('*')
    .eq('code', code.toUpperCase()).maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!inv) return res.status(404).json({ error: 'Код не найден' });
  if (inv.used_by) return res.status(400).json({ error: 'Код уже использован' });
  if (String(inv.inviter_id) === String(user_id))
    return res.status(400).json({ error: 'Нельзя добавить себя' });

  // создаём дружбу (упорядочиваем пары)
  const a = String(inv.inviter_id) < String(user_id) ? String(inv.inviter_id) : String(user_id);
  const b = String(inv.inviter_id) < String(user_id) ? String(user_id) : String(inv.inviter_id);
  await supabase.from('friendships').upsert([{ user_a: a, user_b: b }], { onConflict: 'user_a,user_b' });

  await supabase.from('friend_invites')
    .update({ used_by: user_id, used_at: new Date().toISOString() })
    .eq('code', inv.code);

  res.json({ success: true });
};


