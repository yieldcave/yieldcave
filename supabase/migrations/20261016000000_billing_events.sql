create table if not exists public.billing_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event_id text,
  type text not null,
  subscription_id text,
  payload_status text,
  outcome jsonb not null
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;
