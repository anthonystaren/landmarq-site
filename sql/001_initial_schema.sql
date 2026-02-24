-- ══════════════════════════════════════════════════════════════════
-- LandMarq — Initial Database Schema
-- Run this in Supabase SQL Editor (supabase.com → SQL Editor)
-- ══════════════════════════════════════════════════════════════════

-- 1. User Profiles (extends Supabase auth.users)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  full_name text,
  company text,
  title text,
  plan text default 'trial' check (plan in ('trial', 'solo', 'pro', 'enterprise')),
  avatar_url text,
  onboarding_complete boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Users can only read/update their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. User Preferences (dashboard settings, watched markets, etc.)
create table if not exists public.user_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  preference_key text not null,
  preference_value jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, preference_key)
);

alter table public.user_preferences enable row level security;

create policy "Users can manage own preferences"
  on public.user_preferences for all
  using (auth.uid() = user_id);

-- 3. Intelligence Watches (user-created monitoring rules)
create table if not exists public.intelligence_watches (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text,
  agent_type text not null check (agent_type in (
    'market_intelligence', 'tenant_lead', 'loi_review',
    'outreach', 'portfolio_strategist', 'zoning_monitor'
  )),
  parameters jsonb default '{}',
  frequency text default 'daily' check (frequency in ('hourly', 'daily', 'weekly')),
  is_active boolean default true,
  last_run_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.intelligence_watches enable row level security;

create policy "Users can manage own watches"
  on public.intelligence_watches for all
  using (auth.uid() = user_id);

-- 4. Agent Alerts / Intelligence Feed
create table if not exists public.alerts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  agent_type text not null,
  title text not null,
  body text,
  priority text default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  data jsonb default '{}',
  is_read boolean default false,
  created_at timestamptz default now()
);

alter table public.alerts enable row level security;

create policy "Users can view own alerts"
  on public.alerts for select
  using (auth.uid() = user_id);

create policy "Users can update own alerts"
  on public.alerts for update
  using (auth.uid() = user_id);

-- Index for fast alert queries
create index idx_alerts_user_created on public.alerts (user_id, created_at desc);
create index idx_alerts_user_unread on public.alerts (user_id, is_read) where is_read = false;

-- 5. Updated_at trigger function (reusable)
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at();
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.update_updated_at();
create trigger intelligence_watches_updated_at before update on public.intelligence_watches
  for each row execute function public.update_updated_at();
