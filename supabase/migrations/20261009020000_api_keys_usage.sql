create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  key_hash text not null unique,
  prefix text not null,
  email text not null unique,
  tier text not null default 'free' check (tier in ('free', 'pro')),
  stripe_customer_id text,
  stripe_subscription_id text,
  revoked_at timestamptz
);
create table if not exists public.usage_daily (
  day date not null,
  subject text not null,
  tool text not null,
  calls integer not null default 0,
  primary key (day, subject, tool)
);
alter table public.alerts add column if not exists key_id uuid references public.api_keys(id) on delete cascade;
create index if not exists alerts_key_id_idx on public.alerts(key_id);
alter table public.api_keys enable row level security;
alter table public.usage_daily enable row level security;
revoke all on public.api_keys from anon, authenticated;
revoke all on public.usage_daily from anon, authenticated;

create or replace function public.increment_usage(p_subject text, p_tool text)
returns void language sql security invoker as $$
  insert into public.usage_daily (day, subject, tool, calls) values (current_date, p_subject, p_tool, 1)
  on conflict (day, subject, tool) do update set calls = usage_daily.calls + 1;
$$;
revoke execute on function public.increment_usage(text, text) from public, anon, authenticated;

-- Public static site (landing page) served from Storage.
insert into storage.buckets (id, name, public) values ('site', 'site', true) on conflict (id) do nothing;
