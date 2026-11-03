create table if not exists public.app_icons (
  slug text primary key,
  name_ar text not null,
  app_name text not null,
  seller text not null,
  store_url text not null,
  artwork_url text not null,
  bundle_id text not null,
  version text,
  updated_at timestamptz not null default now()
);
grant select on public.app_icons to authenticated;
grant all on public.app_icons to service_role;
alter table public.app_icons enable row level security;
drop policy if exists "icons readable" on public.app_icons;
create policy "icons readable" on public.app_icons for select to authenticated using (true);