const SUPABASE_URL  = 'https://idtwqqostbntafzfwrgs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkdHdxcW9zdGJudGFmemZ3cmdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5OTQwMzksImV4cCI6MjA5MjU3MDAzOX0.DQmoNqnOnuX9eK9Go0e0jVcF3cTJ50p_l9IBPCkaGD4';

// Initialize Supabase safely
let supabase = null;
try {
  if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  }
} catch (e) {
  console.warn('[Supabase] Initialization skipped:', e.message);
}

if (!supabase) {
  console.warn('[Supabase] SDK not available. Database operations will be skipped.');
}
