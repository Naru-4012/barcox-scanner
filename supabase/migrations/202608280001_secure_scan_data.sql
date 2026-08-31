-- Supabase already provides the PostgreSQL database for this project.
-- This schema contains the application's tables.
-- These cleanup statements remove tables from the earlier default-schema query.
drop table if exists public.scan_items cascade;
drop table if exists public.scan_sessions cascade;

create schema if not exists barcox;

create table barcox.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  business_name text not null check (char_length(business_name) between 1 and 120),
  session_number text not null unique,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table barcox.scan_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references barcox.scan_sessions(id) on delete cascade,
  item_number integer not null check (item_number > 0),
  raw_payload text not null check (char_length(raw_payload) between 1 and 2048),
  product text,
  weight numeric(12,3) not null check (weight > 0),
  unit text not null default 'g' check (char_length(unit) between 1 and 12),
  size text,
  scan_type text not null check (scan_type in ('qr', 'manual')),
  scanned_at timestamptz not null default now(),
  unique (session_id, item_number)
);

grant usage on schema barcox to authenticated;
grant select, insert, update, delete on barcox.scan_sessions to authenticated;
grant select, insert, update, delete on barcox.scan_items to authenticated;

alter table barcox.scan_sessions enable row level security;
alter table barcox.scan_items enable row level security;

create policy "Users read their sessions" on barcox.scan_sessions
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "Users create their sessions" on barcox.scan_sessions
  for insert to authenticated with check (owner_id = (select auth.uid()));

create policy "Users update their sessions" on barcox.scan_sessions
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Users read items in their sessions" on barcox.scan_items
  for select to authenticated using (exists (
    select 1 from barcox.scan_sessions s
    where s.id = session_id and s.owner_id = (select auth.uid())
  ));

create policy "Users create items in their sessions" on barcox.scan_items
  for insert to authenticated with check (exists (
    select 1 from barcox.scan_sessions s
    where s.id = session_id and s.owner_id = (select auth.uid())
  ));

create policy "Users update items in their sessions" on barcox.scan_items
  for update to authenticated using (exists (
    select 1 from barcox.scan_sessions s
    where s.id = session_id and s.owner_id = (select auth.uid())
  )) with check (exists (
    select 1 from barcox.scan_sessions s
    where s.id = session_id and s.owner_id = (select auth.uid())
  ));

create policy "Users delete items in their sessions" on barcox.scan_items
  for delete to authenticated using (exists (
    select 1 from barcox.scan_sessions s
    where s.id = session_id and s.owner_id = (select auth.uid())
  ));

