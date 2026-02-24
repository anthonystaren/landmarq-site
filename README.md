# LandMarq — AI Intelligence for Commercial Real Estate

**landmarq.ai** deploys a fleet of 6 AI agents that continuously monitor CRE markets, surface tenant leads, review LOIs, and deliver intelligence to an executive dashboard every morning at 6 AM.

## Architecture

```
Static HTML/CSS/JS (Vercel)
├── index.html          Landing page
├── agents.html         Agent fleet detail
├── pricing.html        Plans & pricing
├── about.html          Company info
├── dashboard.html      Executive dashboard (auth-gated)
├── login.html          Auth page (magic link / password / Google)
├── terms.html          Terms of service
├── privacy.html        Privacy policy
├── style.css           Shared styles
├── js/
│   └── supabase-config.js   Auth client + helpers
├── sql/
│   └── 001_initial_schema.sql   Database migration
└── vercel.json         Routing + security headers
```

## Quick Start (5 minutes)

### 1. Push to GitHub

```bash
cd landmarq-site
git add -A
git commit -m "Initial commit — LandMarq site + auth"
gh repo create landmarq-site --public --source=. --push
```

Or create the repo at github.com/new, then:
```bash
git remote add origin https://github.com/anthonystaren/landmarq-site.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the `landmarq-site` repo
3. Framework: **Other** (static site)
4. Click **Deploy**
5. Add custom domain: `landmarq.ai` in Project Settings → Domains

### 3. Configure Supabase Auth

1. Go to your Supabase project: [Dashboard](https://supabase.com/dashboard/project/piyhzyxbnluzalqsqaot)
2. Navigate to **Settings → API**
3. Copy the **anon/public** key
4. Paste it into `js/supabase-config.js` replacing `YOUR_SUPABASE_ANON_KEY`
5. In **Authentication → URL Configuration**, set:
   - Site URL: `https://landmarq.ai`
   - Redirect URLs: `https://landmarq.ai/dashboard`, `http://localhost:*`

### 4. Run Database Migration

1. Go to **SQL Editor** in Supabase
2. Paste contents of `sql/001_initial_schema.sql`
3. Click **Run**

This creates: profiles, user_preferences, intelligence_watches, alerts — all with Row Level Security.

### 5. Enable Google OAuth (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 Client ID (Web application)
3. Authorized redirect: `https://piyhzyxbnluzalqsqaot.supabase.co/auth/v1/callback`
4. In Supabase → Authentication → Providers → Google, paste Client ID + Secret

## Auth Flow

- **Magic Link** (default): User enters email → receives sign-in link → lands on /dashboard
- **Password**: Traditional email/password signup + login
- **Google OAuth**: One-click sign in with Google

Protected pages call `LandMarqAuth.requireAuth()` which redirects to `/login` if no session exists.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Static HTML/CSS/JS |
| Hosting | Vercel (auto-deploy from GitHub) |
| Auth | Supabase Auth (magic link + password + OAuth) |
| Database | Supabase PostgreSQL |
| DNS | Vercel (landmarq.ai) |

## Design System

- **Theme**: Dark luxury with gold accents
- **Primary**: `#C49E54` (gold)
- **Background**: `#0A0C0E`
- **Fonts**: Cormorant Garamond (serif), Syne (sans), JetBrains Mono (mono)

---

Built by [aestartx + landmarq](https://landmarq.ai)
