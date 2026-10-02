-- =========================================================
-- Klamottengeld-App
-- Datenbank, Familienzugang und Zugriffsrechte
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.budget_settings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category text not null check (category in ('clothes','sports','shoes')),
  quarterly_budget numeric(10,2) not null default 50,
  opening_balance numeric(10,2) not null default 0,
  start_year int not null default 2026,
  start_quarter int not null default 1 check (start_quarter between 1 and 4),
  unique (household_id, category)
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  purchase_date date not null,
  merchant text,
  invoice_number text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  category text not null check (category in ('clothes','sports','shoes')),
  amount numeric(10,2) not null check (amount >= 0),
  own_share numeric(10,2) not null default 0 check (own_share >= 0 and own_share <= amount)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists purchases_updated_at on public.purchases;
create trigger purchases_updated_at
before update on public.purchases
for each row execute function public.set_updated_at();

create or replace function public.random_join_code()
returns text
language sql
volatile
as $$
  select upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 12));
$$;

create or replace function public.create_household(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;

  loop
    v_code := public.random_join_code();
    exit when not exists (select 1 from public.households where join_code = v_code);
  end loop;

  insert into public.households (name, join_code, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Klamottengeld'), v_code, auth.uid())
  returning id into v_household;

  insert into public.household_members (household_id, user_id, role)
  values (v_household, auth.uid(), 'owner');

  insert into public.budget_settings (household_id, category, quarterly_budget, opening_balance, start_year, start_quarter)
  values
    (v_household, 'clothes', 50, 0, 2026, 1),
    (v_household, 'sports', 50, 0, 2026, 1),
    (v_household, 'shoes', 50, 0, 2026, 1);

  return v_code;
end;
$$;

create or replace function public.join_household(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;

  select id into v_household
  from public.households
  where join_code = upper(trim(p_code));

  if v_household is null then
    raise exception 'Familiencode nicht gefunden';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household, auth.uid(), 'member')
  on conflict do nothing;
end;
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.budget_settings enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;

drop policy if exists "members view households" on public.households;
drop policy if exists "users view own memberships" on public.household_members;
drop policy if exists "members view settings" on public.budget_settings;
drop policy if exists "members update settings" on public.budget_settings;
drop policy if exists "members view purchases" on public.purchases;
drop policy if exists "members insert purchases" on public.purchases;
drop policy if exists "members update purchases" on public.purchases;
drop policy if exists "members delete purchases" on public.purchases;
drop policy if exists "members view items" on public.purchase_items;
drop policy if exists "members insert items" on public.purchase_items;
drop policy if exists "members update items" on public.purchase_items;
drop policy if exists "members delete items" on public.purchase_items;

create policy "members view households" on public.households
for select to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = households.id and hm.user_id = auth.uid()
));

create policy "users view own memberships" on public.household_members
for select to authenticated
using (user_id = auth.uid());

create policy "members view settings" on public.budget_settings
for select to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = budget_settings.household_id and hm.user_id = auth.uid()
));

create policy "members update settings" on public.budget_settings
for update to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = budget_settings.household_id and hm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.household_members hm
  where hm.household_id = budget_settings.household_id and hm.user_id = auth.uid()
));

create policy "members view purchases" on public.purchases
for select to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = purchases.household_id and hm.user_id = auth.uid()
));

create policy "members insert purchases" on public.purchases
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.household_members hm
    where hm.household_id = purchases.household_id and hm.user_id = auth.uid()
  )
);

create policy "members update purchases" on public.purchases
for update to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = purchases.household_id and hm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.household_members hm
  where hm.household_id = purchases.household_id and hm.user_id = auth.uid()
));

create policy "members delete purchases" on public.purchases
for delete to authenticated
using (exists (
  select 1 from public.household_members hm
  where hm.household_id = purchases.household_id and hm.user_id = auth.uid()
));

create policy "members view items" on public.purchase_items
for select to authenticated
using (exists (
  select 1 from public.purchases p
  join public.household_members hm on hm.household_id = p.household_id
  where p.id = purchase_items.purchase_id and hm.user_id = auth.uid()
));

create policy "members insert items" on public.purchase_items
for insert to authenticated
with check (exists (
  select 1 from public.purchases p
  join public.household_members hm on hm.household_id = p.household_id
  where p.id = purchase_items.purchase_id and hm.user_id = auth.uid()
));

create policy "members update items" on public.purchase_items
for update to authenticated
using (exists (
  select 1 from public.purchases p
  join public.household_members hm on hm.household_id = p.household_id
  where p.id = purchase_items.purchase_id and hm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.purchases p
  join public.household_members hm on hm.household_id = p.household_id
  where p.id = purchase_items.purchase_id and hm.user_id = auth.uid()
));

create policy "members delete items" on public.purchase_items
for delete to authenticated
using (exists (
  select 1 from public.purchases p
  join public.household_members hm on hm.household_id = p.household_id
  where p.id = purchase_items.purchase_id and hm.user_id = auth.uid()
));

grant usage on schema public to authenticated;

revoke all on table public.households from anon;
revoke all on table public.household_members from anon;
revoke all on table public.budget_settings from anon;
revoke all on table public.purchases from anon;
revoke all on table public.purchase_items from anon;

revoke all on table public.households from authenticated;
revoke all on table public.household_members from authenticated;
revoke all on table public.budget_settings from authenticated;
revoke all on table public.purchases from authenticated;
revoke all on table public.purchase_items from authenticated;

grant select on table public.households to authenticated;
grant select on table public.household_members to authenticated;
grant select, update on table public.budget_settings to authenticated;
grant select, insert, update, delete on table public.purchases to authenticated;
grant select, insert, update, delete on table public.purchase_items to authenticated;

revoke execute on function public.create_household(text) from public, anon;
revoke execute on function public.join_household(text) from public, anon;
revoke execute on function public.random_join_code() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;
