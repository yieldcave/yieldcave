alter table public.alerts add column if not exists universe text not null default 'rwa' check (universe in ('rwa', 'stablecoin'));
