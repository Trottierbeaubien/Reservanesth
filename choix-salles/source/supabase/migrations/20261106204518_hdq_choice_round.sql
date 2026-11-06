-- HDQ is independent of the existing ra_* application. Server access only.
create table public.hdq_members(email text primary key check(email=lower(email)),active boolean not null default true,is_owner boolean not null default false);
create table public.hdq_state(id integer primary key check(id=1),revision bigint not null default 0,payload jsonb not null);
create table public.hdq_subscriptions(endpoint text primary key,email text not null,payload jsonb not null,created_at timestamptz not null default now());
create index hdq_subscriptions_email on public.hdq_subscriptions(email);
create table public.hdq_notifications(id text primary key,email text not null,kind text not null,payload jsonb not null,created_at timestamptz not null default now(),read boolean not null default false,push_status text not null default 'pending');
create index hdq_notifications_email_time on public.hdq_notifications(email,created_at desc);
create table public.hdq_runtime(id text primary key,value jsonb not null);
create table public.hdq_deliveries(id text primary key,status text not null,created_at timestamptz not null default now(),detail jsonb not null default '{}'::jsonb);
alter table public.hdq_members enable row level security;
alter table public.hdq_state enable row level security;
alter table public.hdq_subscriptions enable row level security;
alter table public.hdq_notifications enable row level security;
alter table public.hdq_runtime enable row level security;
alter table public.hdq_deliveries enable row level security;
revoke all on public.hdq_members,public.hdq_state,public.hdq_subscriptions,public.hdq_notifications,public.hdq_runtime,public.hdq_deliveries from anon,authenticated;
grant all on public.hdq_members,public.hdq_state,public.hdq_subscriptions,public.hdq_notifications,public.hdq_runtime,public.hdq_deliveries to service_role;
create function public.hdq_commit(p_revision bigint,p_payload jsonb,p_events jsonb default '[]'::jsonb,p_clear_turn boolean default false,p_reset boolean default false)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer; item jsonb;
begin
 update public.hdq_state set payload=p_payload,revision=revision+1 where id=1 and revision=p_revision;
 get diagnostics changed=row_count;
 if changed=0 then return false; end if;
 if p_reset then delete from public.hdq_notifications; delete from public.hdq_deliveries; end if;
 if p_clear_turn then update public.hdq_notifications set read=true where kind='turn' and not read; end if;
 for item in select value from jsonb_array_elements(p_events) loop
  insert into public.hdq_notifications(id,email,kind,payload) values(item->>'id',item->>'email',item->>'kind',item) on conflict do nothing;
 end loop;
 for item in select value from jsonb_array_elements(p_payload->'directory') loop
  if coalesce(item->>'email','')<>'' then
   insert into public.hdq_members(email) values(lower(item->>'email')) on conflict(email) do nothing;
  end if;
 end loop;
 return true;
end $$;
revoke all on function public.hdq_commit(bigint,jsonb,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.hdq_commit(bigint,jsonb,jsonb,boolean,boolean) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('hdq-programmes','hdq-programmes',false,15728640,array['image/jpeg','image/png']) on conflict(id) do nothing;
