import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.warn('Supabase service key not set; server-side writes will be disabled.');
}

export const supabaseService =
  url && serviceKey ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
