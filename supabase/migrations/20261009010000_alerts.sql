create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  symbol text,
  chain text,
  metric text not null check (metric in ('apy', 'tvl')),
  operator text not null check (operator in ('above', 'below')),
  threshold numeric not null,
  webhook_url text not null check (webhook_url like 'https://%'),
  label text,
  last_fired_at timestamptz,
  active boolean not null default true
);
alter table public.alerts enable row level security;
revoke all on public.alerts from anon, authenticated;
