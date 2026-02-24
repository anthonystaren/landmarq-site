/**
 * LandMarq — Supabase Configuration
 *
 * Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values.
 * These are safe to expose client-side (Row Level Security enforces access).
 *
 * Get these from: https://supabase.com/dashboard → Settings → API
 */

const SUPABASE_URL = 'https://piyhzyxbnluzalqsqaot.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpeWh6eXhibmx1emFscXNxYW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MjM2ODQsImV4cCI6MjA4NzQ5OTY4NH0.f_xIyGAKZpyAD92yrQZitzsteGg5GjzIvftt5LAIXVY';

// Initialize Supabase client (loaded via CDN in HTML)
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Auth helpers for LandMarq
 */
const LandMarqAuth = {

  /** Get current session (null if not logged in) */
  async getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.error('Session error:', error.message);
    return session;
  },

  /** Get current user (null if not logged in) */
  async getUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) console.error('User error:', error.message);
    return user;
  },

  /** Send magic link to email */
  async sendMagicLink(email) {
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + '/dashboard',
      }
    });
    return { data, error };
  },

  /** Sign in with email + password */
  async signInWithPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    return { data, error };
  },

  /** Sign up with email + password */
  async signUp(email, password, metadata = {}) {
    const { data, error } = await supabase.auth.signUp({
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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/dashboard',
      }
    });
    return { data, error };
  },

  /** Sign out */
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (!error) window.location.href = '/';
    return { error };
  },

  /** Listen for auth state changes */
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },

  /**
   * Gate a page — redirect to /login if not authenticated.
   * Call this at the top of any protected page.
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
