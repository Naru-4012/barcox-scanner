create table if not exists barcox.product_catalog (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null check (char_length(btrim(code)) between 1 and 128),
  code_key text generated always as (lower(btrim(code))) stored,
  product text check (product is null or char_length(product) <= 2048),
  weight numeric(12,3) not null check (weight > 0),
  unit text not null default 'g' check (unit in ('g', 'kg', 'mg')),
  size text check (size is null or char_length(size) <= 200),
  purity text check (purity is null or char_length(purity) <= 40),
  created_at timestamptz not null default now(),
  unique (owner_id, code_key)
);

grant usage on schema barcox to authenticated;
grant select, insert, update, delete on barcox.product_catalog to authenticated;

alter table barcox.product_catalog enable row level security;

drop policy if exists "Users read their product catalogue" on barcox.product_catalog;
create policy "Users read their product catalogue" on barcox.product_catalog
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "Users create their product catalogue entries" on barcox.product_catalog;
create policy "Users create their product catalogue entries" on barcox.product_catalog
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "Users update their product catalogue entries" on barcox.product_catalog;
create policy "Users update their product catalogue entries" on barcox.product_catalog
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Users delete their product catalogue entries" on barcox.product_catalog;
create policy "Users delete their product catalogue entries" on barcox.product_catalog
  for delete to authenticated using (owner_id = (select auth.uid()));
