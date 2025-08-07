const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  const { data, error } = await supabase
    .from('user_books')
    .select('*')
    .eq('user_id', user_id)
    .order('added_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data);
};
