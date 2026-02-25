/**
 * LandMarq — Supabase Configuration
 */

const SUPABASE_URL = 'https://piyhzyxbnluzalqsqaot.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpeWh6eXhibmx1emFscXNxYW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MjM2ODQsImV4cCI6MjA4NzQ5OTY4NH0.f_xIyGAKZpyAD92yrQZitzsteGg5GjzIvftt5LAIXVY';

// Initialize Supabase client — handle different CDN export formats
let _supabaseClient;
try {
  const _sb = window.supabase;
  if (_sb && typeof _sb.createClient === 'function') {
    _supabaseClient = _sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else if (_sb && _sb.supabase && typeof _sb.supabase.createClient === 'function') {
    _supabaseClient = _sb.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else if (typeof createClient === 'function') {
    _supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.error('LandMarq: Supabase library not found. window.supabase =', _sb);
  }
} catch (err) {
  console.error('LandMarq: Failed to init Supabase client:', err);
}

/**
 * Auth helpers for LandMarq
 */
const LandMarqAuth = {

  /** Get current session (null if not logged in) */
  async getSession() {
    if (!_supabaseClient) return null;
    const { data: { session }, error } = await _supabaseClient.auth.getSession();
    if (error) console.error('Session error:', error.message);
    return session;
  },

  /** Get current user (null if not logged in) */
  async getUser() {
    if (!_supabaseClient) return null;
    const { data: { user }, error } = await _supabaseClient.auth.getUser();
    if (error) console.error('User error:', error.message);
    return user;
  },

  /** Send magic link to email */
  async sendMagicLink(email) {
    if (!_supabaseClient) return { data: null, error: { message: 'Auth not initialized' } };
    const { data, error } = await _supabaseClient.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + '/dashboard',
      }
    });
    return { data, error };
  },

  /** Sign in with email + password */
  async signInWithPassword(email, password) {
    if (!_supabaseClient) return { data: null, error: { message: 'Auth not initialized' } };
    const { data, error } = await _supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    return { data, error };
  },

  /** Sign up with email + password */
  async signUp(email, password, metadata = {}) {
    if (!_supabaseClient) return { data: null, error: { message: 'Auth not initialized' } };
    const { data, error } = await _supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: window.location.origin + '/dashboard',
      }
    });
    return { data, error };
  },

  /** Sign in with Google OAuth */
  async signInWithGoogle() {
    if (!_supabaseClient) return { data: null, error: { message: 'Auth not initialized' } };
    const { data, error } = await _supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/dashboard',
      }
    });
    return { data, error };
  },

  /** Sign out */
  async signOut() {
    if (!_supabaseClient) { window.location.href = '/login'; return { error: null }; }
    const { error } = await _supabaseClient.auth.signOut();
    if (!error) window.location.href = '/login';
    return { error };
  },

  /** Listen for auth state changes */
  onAuthStateChange(callback) {
    if (!_supabaseClient) return;
    return _supabaseClient.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },

  /**
   * Gate a page — redirect to /login if not authenticated.
   */
  async requireAuth() {
    const session = await this.getSession();
    if (!session) {
      const returnTo = encodeURIComponent(window.location.pathname);
      window.location.href = `/login?returnTo=${returnTo}`;
      return null;
    }
    return session;
  }
};
