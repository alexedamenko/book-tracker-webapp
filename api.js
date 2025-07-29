// 📁 api.js — Подключение к Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://sodehdbidjsroqevtglo.supabase.co';
const supabaseKey = 'ey_fake_anon_key_for_demo';
export const supabase = createClient(supabaseUrl, supabaseKey);

export async function getBooks(userId) {
  const { data, error } = await supabase
    .from('user_books')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });
  if (error) console.error(error);
  return data || [];
}

export async function addBook(book) {
  const { error } = await supabase.from('user_books').insert([book]);
  if (error) console.error(error);
}
