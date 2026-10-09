-- YieldCave: cached market + daily snapshots, refreshed hourly by pg_cron calling the `refresh` Edge Function.
create table if not exists public.market_latest (
  id integer primary key default 1 check (id = 1),
  fetched_at timestamptz not null,
  data jsonb not null
);
create table if not exists public.snapshots (
  day date primary key,
  fetched_at timestamptz not null,
  data jsonb not null
);
-- Only the service role (used by the Edge Functions) touches these tables. RLS on, no policies.
alter table public.market_latest enable row level security;
alter table public.snapshots enable row level security;
revoke all on public.market_latest from anon, authenticated;
revoke all on public.snapshots from anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Hourly at minute 7. Secrets `project_url` and `refresh_secret` live in Vault (set after deploy).
select cron.schedule(
  'yieldcave-refresh-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-refresh-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
