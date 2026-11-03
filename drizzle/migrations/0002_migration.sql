do $$ begin if not exists (select 1 from pg_type where typname='app_role' and typnamespace='public'::regnamespace) then create type public.app_role as enum ('admin','user'); end if; end $$;

create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text, created_at timestamptz not null default now());
alter table public.profiles add column if not exists avatar_url text, add column if not exists plan text not null default 'free', add column if not exists credits numeric not null default 0, add column if not exists suspended boolean not null default false;
create table if not exists public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, role public.app_role not null, unique (user_id, role));
create table if not exists public.projects (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null, kind text not null default 'video', status text not null default 'draft', data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.assets (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), project_id uuid not null references public.projects(id) on delete cascade, kind text not null, mime text not null, size bigint not null default 0, source text not null default 'upload', storage_path text not null, meta jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table if not exists public.generation_jobs (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), project_id uuid references public.projects(id) on delete cascade, kind text not null, model text, status text not null default 'queued', input jsonb not null default '{}'::jsonb, provider_job_id text, output_asset_id uuid references public.assets(id) on delete set null, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.usage_events (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), job_id uuid unique references public.generation_jobs(id) on delete cascade, service text not null, model text not null, status text not null default 'success', unit text not null default 'request', units numeric not null default 1, created_at timestamptz not null default now());
create table if not exists public.chat_messages (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), role text not null, content text not null, action jsonb, created_at timestamptz not null default now());
create table if not exists public.support_tickets (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), subject text not null, body text not null, status text not null default 'open', admin_reply text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

grant select, insert, update, delete on public.profiles, public.projects, public.assets, public.generation_jobs, public.usage_events, public.chat_messages, public.support_tickets to authenticated;
grant select on public.user_roles to authenticated;
grant all on public.profiles, public.user_roles, public.projects, public.assets, public.generation_jobs, public.usage_events, public.chat_messages, public.support_tickets to service_role;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.usage_events enable row level security;
alter table public.chat_messages enable row level security;
alter table public.support_tickets enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

do $$ declare r record; begin
  for r in select polname, c.relname from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace and c.relname in ('profiles','user_roles','projects','assets','generation_jobs','usage_events','chat_messages','support_tickets') loop
    execute format('drop policy %I on public.%I', r.polname, r.relname);
  end loop;
end $$;

create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "own roles read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

do $$ declare t text; begin
  foreach t in array array['projects','assets','generation_jobs','usage_events','chat_messages','support_tickets'] loop
    execute format('create policy "own select" on public.%I for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),''admin''))', t);
    execute format('create policy "own insert" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy "own update" on public.%I for update to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),''admin''))', t);
    execute format('create policy "own delete" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

create or replace function public.protect_profile_fields() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(),'admin') then
    new.id := old.id; new.plan := old.plan; new.credits := old.credits; new.suspended := old.suspended;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile_fields();

create or replace function public.protect_ticket_fields() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(),'admin') then
    new.admin_reply := old.admin_reply; new.status := old.status; new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists protect_ticket on public.support_tickets;
create trigger protect_ticket before update on public.support_tickets for each row execute function public.protect_ticket_fields();

create or replace function public.grant_roles_for(_id uuid, _email text, _confirmed timestamptz) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_roles(user_id, role) values (_id, 'user') on conflict do nothing;
  if lower(_email) = 'dryf090@gmail.com' and _confirmed is not null then
    insert into public.user_roles(user_id, role) values (_id, 'admin') on conflict do nothing;
  end if;
end $$;
revoke execute on function public.grant_roles_for(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1))) on conflict do nothing;
  perform public.grant_roles_for(new.id, new.email, new.email_confirmed_at);
  return new;
end $$;
create or replace function public.handle_user_confirmed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.grant_roles_for(new.id, new.email, new.email_confirmed_at);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users for each row execute function public.handle_user_confirmed();

insert into public.profiles(id, display_name) select id, split_part(email,'@',1) from auth.users on conflict do nothing;
select public.grant_roles_for(id, email, email_confirmed_at) from auth.users;

drop policy if exists "studio own read" on storage.objects;
drop policy if exists "studio own write" on storage.objects;
drop policy if exists "studio own update" on storage.objects;
drop policy if exists "studio own delete" on storage.objects;
create policy "studio own read" on storage.objects for select to authenticated using (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "studio own write" on storage.objects for insert to authenticated with check (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "studio own update" on storage.objects for update to authenticated using (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "studio own delete" on storage.objects for delete to authenticated using (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);