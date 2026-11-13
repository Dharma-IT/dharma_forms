-- Run in the Supabase SQL Editor. Safe to rerun; existing assignments stay intact.
begin;
create table if not exists public.booking_team_members (
  team text not null check (team in ('agents','nutritionists','sellers','customer-service')),
  id text not null check (id ~ '^[0-9]+$'),
  name text not null,
  booking_url text not null default '',
  primary key (team, id)
);
create table if not exists public.booking_team_initialized (
  id integer primary key check (id = 1)
);

-- Browser clients cannot bypass the server's Bigin validation or management PIN.
alter table public.booking_team_members enable row level security;
alter table public.booking_team_initialized enable row level security;
revoke all on public.booking_team_members from anon, authenticated;
revoke all on public.booking_team_initialized from anon, authenticated;
grant select, insert, update, delete on public.booking_team_members to service_role;
grant select, insert on public.booking_team_initialized to service_role;

-- Seed the previous assignments only once, including after intentional removals.
with initialized as (
  insert into public.booking_team_initialized (id) values (1)
  on conflict do nothing returning id
)
insert into public.booking_team_members (team,id,name,booking_url)
select team, '7692472000000645001', 'Jeuz Vinci Bas',
  case when team = 'agents' then '' else 'https://us.bigin.online/org945767910/bookings/it' end
from (values ('agents'),('nutritionists'),('sellers'),('customer-service')) as teams(team)
where exists (select 1 from initialized)
on conflict do nothing;
commit;
