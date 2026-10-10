create table if not exists public.equity_meta (
  coingecko_id text primary key,
  chains jsonb not null default '[]'::jsonb,
  homepage text,
  updated_at timestamptz not null default now()
);
alter table public.equity_meta enable row level security;
revoke all on public.equity_meta from anon, authenticated;

-- Every 10 minutes: fill chain metadata for ~15 tokenized equities per run (CoinGecko free-tier friendly).
select cron.schedule(
  'yieldcave-enrich-equities',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/enrich',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-refresh-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
