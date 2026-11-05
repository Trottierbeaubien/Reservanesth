begin;
alter table ra.rooms add column draft boolean not null default false;
alter table ra.jobs add column batch bigint;
alter table ra.jobs add column room_ids uuid[];
create unique index jobs_batch_recipient on ra.jobs(person,batch,kind) where batch is not null;
create or replace function ra.announce(r ra.rooms, kind text) returns void language plpgsql set search_path='' as $$
#variable_conflict use_column
begin
 if r.booked or r.withdrawn or r.draft then return; end if;
 insert into ra.jobs(person,kind,batch,room_ids)
 select id,announce.kind,txid_current(),array[r.id] from ra.people where state='active' and (category='member' or r.external)
 on conflict(person,batch,kind) where batch is not null do update
 set room_ids=case when r.id=any(ra.jobs.room_ids) then ra.jobs.room_ids else array_append(ra.jobs.room_ids,r.id) end;
end$$;

create or replace function public.ra_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$declare p ra.people; result jsonb;begin
 p:=ra.me(); if p.id is null then return jsonb_build_object('profile',null); end if;
 result:=jsonb_build_object('profile',to_jsonb(p));
 if p.state<>'active' then return result; end if;
 return result || jsonb_build_object(
 'choices',(select coalesce(jsonb_agg(c order by kind,label),'[]') from ra.choices c),
 'rooms',(select coalesce(jsonb_agg(x order by day,created_at),'[]') from (
 select r.id,r.day,r.site,r.discipline,r.external,r.withdrawn,r.draft,r.booked,r.rev,r.created_at,
 case when p.admin then r.doctor when r.doctor=p.id then r.doctor else null end doctor,
 case when p.admin then r.ate_name else null end ate_name
 from ra.rooms r where p.admin or (not r.withdrawn and not r.draft and ((not r.booked and r.day >= (now() at time zone 'America/Toronto')::date and (p.category='member' or r.external)) or (r.booked and r.doctor=p.id)))
 )x),
 'people',case when p.admin then (select coalesce(jsonb_agg(u order by name),'[]') from ra.people u) else '[]'::jsonb end,
 'audit',case when p.admin then (select coalesce(jsonb_agg(a order by id desc),'[]') from (select * from ra.audit order by id desc limit 300)a) else '[]'::jsonb end,
 'notifications',case when p.admin then (select coalesce(jsonb_object_agg(state,n),'{}') from (select state,count(*) n from ra.jobs group by state)x) else '{}'::jsonb end);
end$$;


create or replace function public.ra_book(room_id uuid) returns void language plpgsql security definer set search_path='' as $$declare p ra.people; r ra.rooms; begin
 -- Serialize with account changes, so a concurrent exclusion cannot book afterward.
 select * into p from ra.people where id=auth.uid() for update;
 if p.id is null or p.state<>'active' then raise exception 'Compte non autorisé'; end if;
 update ra.rooms set booked=true,doctor=p.id,rev=rev+1 where id=room_id and not booked and not withdrawn and not draft
 and day >= (now() at time zone 'America/Toronto')::date and (p.category='member' or external) returning * into r;
 if not found then raise exception 'Salle déjà réservée ou non autorisée'; end if;
 perform ra.confirmation(r); perform ra.touch('booking',jsonb_build_object('room',r.id,'doctor',p.id));
end$$;


create or replace function public.ra_admin(command text, data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r ra.rooms; old ra.rooms; target ra.people; cid uuid; rid uuid; n int; choice ra.choices;
begin
 if not ra.is_admin() then raise exception 'Administration requise'; end if;
 if command='user' then
 select * into target from ra.people where id=(data->>'id')::uuid for update;
 if not found then raise exception 'Utilisateur inconnu'; end if;
 if target.admin and data->>'state'<>'active' then raise exception 'Un administrateur doit rester actif'; end if;
 update ra.people set state=coalesce(data->>'state',state),category=coalesce(data->>'category',category),
 name=coalesce(nullif(trim(data->>'name'),''),name) where id=target.id;
 -- Identity preserved, including excluded emails. Never delete auth.users to unblock an exclusion.
 elsif command='choice' then
 cid:=coalesce(nullif(data->>'id','')::uuid,gen_random_uuid());
 insert into ra.choices(id,kind,label,color,active) values(cid,data->>'kind',trim(data->>'label'),data->>'color',coalesce((data->>'active')::boolean,true))
 on conflict(id) do update set label=excluded.label,color=excluded.color,active=excluded.active;
 elsif command='delete_choice' then
 delete from ra.choices where id=(data->>'id')::uuid; -- FK protects historical references; deactivate instead if used.
 elsif command='create' then
 n:=(data->>'count')::int; if n is null or n<1 or n>100 then raise exception 'Quantité de 1 à 100'; end if;
 select * into choice from ra.choices where id=(data->>'site')::uuid and kind='site' and active;
 if not found then raise exception 'Site inactif'; end if;
 select * into choice from ra.choices where id=(data->>'discipline')::uuid and kind='discipline' and active;
 if not found then raise exception 'Discipline inactive'; end if;
 if nullif(data->>'doctor','') is not null then
 select * into target from ra.people where id=(data->>'doctor')::uuid and state='active' for update;
 if not found then raise exception 'Médecin inactif'; end if;
 end if;
 for i in 1..n loop
 insert into ra.rooms(day,site,discipline,external,draft,booked,doctor,ate_name)
 values((data->>'day')::date,(data->>'site')::uuid,(data->>'discipline')::uuid,coalesce((data->>'external')::boolean,false),not coalesce((data->>'booked')::boolean,false),
 coalesce((data->>'booked')::boolean,false),target.id,case when target.id is null and coalesce((data->>'booked')::boolean,false) then coalesce(nullif(trim(data->>'ate_name'),''),'ATE — nom à venir') else null end) returning * into r;
 if r.booked then perform ra.confirmation(r); else perform ra.announce(r,'available'); end if;
 end loop;
 elsif command in ('publish','open','close','relaunch','withdraw','restore','cancel','assign','edit') then
 if jsonb_typeof(data->'ids') is distinct from 'array' then raise exception 'Sélection requise'; end if;
 if jsonb_array_length(data->'ids') not between 1 and 100 then raise exception 'Sélection de 1 à 100 salles'; end if;
 -- Lock chosen physician before rooms, matching ra_book lock order.
 if command='assign' and nullif(data->>'doctor','') is not null then
 select * into target from ra.people where id=(data->>'doctor')::uuid and state='active' for update;
 if not found then raise exception 'Médecin inactif'; end if;
 end if;
 for rid in select value::uuid from jsonb_array_elements_text(data->'ids') order by value loop
 select * into r from ra.rooms where id=rid for update; if not found then raise exception 'Salle inconnue'; end if; old:=r;
 if command='publish' then
 if r.draft and not r.booked and not r.withdrawn then
 if r.day < (now() at time zone 'America/Toronto')::date then raise exception 'Impossible de publier une date passée'; end if;
 update ra.rooms set draft=false,rev=rev+1 where id=rid returning * into r; perform ra.announce(r,'available');
 end if;
 elsif command='relaunch' then
 if not r.booked and not r.withdrawn then update ra.rooms set rev=rev+1 where id=rid returning * into r; perform ra.announce(r,'relaunch'); end if;
 elsif command in ('open','close') then
 update ra.rooms set external=(command='open'),rev=rev+1 where id=rid returning * into r;
 if command='open' and not old.external then perform ra.announce(r,'opened'); end if;
 elsif command in ('withdraw','restore') then
 if r.booked then raise exception 'Annulez la réservation avant le retrait'; end if;
 update ra.rooms set withdrawn=(command='withdraw'),rev=rev+1 where id=rid returning * into r;
 if command='restore' then perform ra.announce(r,'available'); end if;
 elsif command='cancel' then
 update ra.rooms set booked=false,doctor=null,ate_name=null,rev=rev+1 where id=rid returning * into r;
 perform ra.announce(r,'available');
 elsif command='assign' then
 update ra.rooms set booked=true,withdrawn=false,draft=false,doctor=target.id,
 ate_name=case when target.id is null then coalesce(nullif(trim(data->>'ate_name'),''),'ATE — nom à venir') else null end,rev=rev+1 where id=rid returning * into r;
 perform ra.confirmation(r);
 elsif command='edit' then
 if not exists(select 1 from ra.choices where id=(data->>'site')::uuid and kind='site' and active) or not exists(select 1 from ra.choices where id=(data->>'discipline')::uuid and kind='discipline' and active) then raise exception 'Choix inactif'; end if;
 update ra.rooms set day=(data->>'day')::date,site=(data->>'site')::uuid,discipline=(data->>'discipline')::uuid,rev=rev+1 where id=rid returning * into r;
 if r.booked then perform ra.confirmation(r); else perform ra.announce(r,'available'); end if;
 end if;
 -- Permissions-only changes must not remove the reminder for a booked room.
 if r.booked and command in ('open','close') then perform ra.confirmation(r); end if;
 end loop;
 else raise exception 'Commande inconnue'; end if;
 perform ra.touch(command,data);
end$$;


create or replace function public.ra_claim_jobs() returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 update ra.jobs set state='failed',error='Nombre maximal de tentatives atteint' where state='working' and lease<now() and attempts>=5;
 update ra.jobs j set state='cancelled' where state in ('pending','working') and (
 not exists(select 1 from ra.people p where p.id=j.person and p.state='active') or
 not exists(select 1 from ra.rooms r join ra.people p on p.id=j.person where (case when j.batch is not null then r.id=any(j.room_ids) else r.id=j.room end) and not r.withdrawn and not r.draft and
 ((j.kind in ('available','relaunch','opened') and not r.booked and r.day >= (now() at time zone 'America/Toronto')::date and (p.category='member' or r.external))
 or (j.kind in ('confirmation','reminder') and r.booked and r.doctor=p.id and r.rev=j.rev)
 or (j.kind='admin_booking' and p.admin and r.booked and r.rev=j.rev))));
 with picked as (select id from ra.jobs where due<=now() and attempts<5 and (state='pending' or (state='working' and lease<now())) order by due for update skip locked limit 20),
 claimed as (update ra.jobs set state='working',lease=now()+interval '2 minutes',attempts=attempts+1 where id in(select id from picked) returning *)
 select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object('subscriptions',(select coalesce(jsonb_agg(s),'[]') from ra.subscriptions s where person=j.person))),'[]') into result from claimed j;
 return result;
end$$;

commit;
