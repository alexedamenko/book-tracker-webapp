// 📁 api.js — Подключение к Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://sodehdbidjsroqevtglo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZGVoZGJpZGpzcm9xZXZ0Z2xvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM3OTE0MTUsImV4cCI6MjA2OTM2NzQxNX0.mjcNOakxxDIscPdzjXhJoEy5z5J3XrdNa_RdcV28xXM';
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
