begin;
-- Auth accounts remain separate and each address must complete its own OTP.
-- Only the application profile is shared; no identities, sessions or tokens are modified.
alter table ra.people add column linked_to uuid references ra.people(id);
alter table ra.people add constraint people_no_self_link check(linked_to is null or linked_to<>id);
alter table ra.people add constraint people_linked_closed check(linked_to is null or (state='closed' and not admin));
create index people_linked_to on ra.people(linked_to) where linked_to is not null;

create or replace function ra.me() returns ra.people language sql stable security definer set search_path='' as $$
 select canonical from ra.people login join ra.people canonical on canonical.id=coalesce(login.linked_to,login.id) where login.id=auth.uid()
$$;
-- Lock the current canonical profile and retry resolution if a merge finished while waiting.
create function ra.lock_me() returns ra.people language plpgsql security definer set search_path='' as $$
declare p ra.people; wanted uuid;
begin
 loop
  select coalesce(linked_to,id) into wanted from ra.people where id=auth.uid();
  if wanted is null then return null; end if;
  select * into p from ra.people where id=wanted for update;
  if p.linked_to is null then return p; end if;
 end loop;
end$$;
create function ra.person_emails(person_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(email order by (id=person_id) desc,created_at,id),'[]'::jsonb) from ra.people where id=person_id or linked_to=person_id
$$;

create function public.ra_link_accounts(source_id uuid,target_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare src ra.people; dest ra.people; sources uuid[]; moved_rooms uuid[]; moved_devices integer; job ra.jobs;
begin
 if not ra.is_admin() then raise exception 'Administration requise'; end if;
 if source_id is null or target_id is null or source_id=target_id then raise exception 'Choisissez deux fiches différentes'; end if;
 -- Match the booking lock order: profiles before rooms. Ordered group locks serialize merges.
 perform 1 from ra.people where id in(source_id,target_id) or linked_to in(source_id,target_id) order by id for update;
 select * into src from ra.people where id=source_id;
 select * into dest from ra.people where id=target_id;
 if src.id is null or dest.id is null then raise exception 'Compte inconnu'; end if;
 if src.linked_to is not null or dest.linked_to is not null then raise exception 'Choisissez les fiches principales et actualisez la liste'; end if;
 if src.admin or dest.admin or src.is_test or dest.is_test then raise exception 'Rattachement réservé aux comptes médecins'; end if;
 if dest.state<>'active' or src.state not in('active','pending') then raise exception 'Compte exclu, désactivé ou non autorisé au rattachement'; end if;
 if src.category<>dest.category then raise exception 'Vérifiez les catégories avant le rattachement'; end if;
 select array_agg(id order by id) into sources from ra.people where id=source_id or linked_to=source_id;
 if exists(select 1 from ra.people p left join auth.users u on u.id=p.id where (p.id=any(sources) or p.id=target_id or p.linked_to=target_id) and (u.id is null or u.email_confirmed_at is null or lower(trim(u.email))<>p.email)) then
  raise exception 'Chaque adresse doit être vérifiée par son code avant le rattachement';
 end if;
 if (select count(*) from ra.subscriptions where person=any(sources) or person=target_id)>8 then raise exception 'Maximum 8 appareils pour la fiche regroupée'; end if;
 perform 1 from ra.jobs where person=any(sources) or person=target_id or registration_person=any(sources) order by id for update;
 if exists(select 1 from ra.jobs where (person=any(sources) or person=target_id or registration_person=any(sources)) and state='working' and lease>now()) then
  raise exception 'Une notification est en cours d’envoi. Réessayez dans deux minutes';
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into moved_rooms from ra.rooms where doctor=any(sources);
 update ra.rooms set doctor=target_id where doctor=any(sources);
 update ra.subscriptions set person=target_id where person=any(sources);
 get diagnostics moved_devices=row_count;
 -- Preserve each unsent notification, unless that notification already exists on the destination.
 -- Keep duplicate historical jobs under their original identity and cancel their delivery.
 for job in select * from ra.jobs where person=any(sources) and state in('pending','working') order by due,id loop
  if exists(select 1 from ra.jobs j where j.person=target_id and j.kind=job.kind and
   ((job.room is not null and j.room=job.room and j.rev=job.rev) or
    (job.batch is not null and j.batch=job.batch) or
    (job.registration_person is not null and j.registration_person=job.registration_person))) then
   update ra.jobs set state='cancelled',lease=null,error='Doublon regroupé sur la fiche principale' where id=job.id;
  else
   update ra.jobs set person=target_id,state='pending',lease=null where id=job.id;
  end if;
 end loop;
 update ra.jobs set state='cancelled',lease=null where registration_person=any(sources) and state in('pending','working');
 update ra.people set closure_requested=closure_requested or exists(select 1 from ra.people where id=any(sources) and closure_requested) where id=target_id;
 update ra.people set linked_to=target_id,state='closed',admin=false where id=any(sources);
 perform ra.touch('link_accounts',jsonb_build_object('source',source_id,'target',target_id,'linked_accounts',sources,'rooms',moved_rooms,'devices',moved_devices));
end$$;

revoke all on function ra.lock_me(),ra.person_emails(uuid) from public,anon,authenticated;
revoke all on function public.ra_link_accounts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ra_link_accounts(uuid,uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.ra_admin(command text, data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r ra.rooms; old ra.rooms; target ra.people; cid uuid; rid uuid; n int; choice ra.choices;
begin
 if not ra.is_admin() then raise exception 'Administration requise'; end if;
 if command='user' then
 select * into target from ra.people where id=(data->>'id')::uuid for update;
 if not found then raise exception 'Utilisateur inconnu'; end if;
 if target.linked_to is not null then raise exception 'Modifiez la fiche principale de ce médecin'; end if;
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
end$function$
;

CREATE OR REPLACE FUNCTION public.ra_book(room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare p ra.people; r ra.rooms; begin
 -- Serialize with account changes, so a concurrent exclusion cannot book afterward.
 p:=ra.lock_me();
 if p.id is null or p.state<>'active' then raise exception 'Compte non autorisé'; end if;
 update ra.rooms set booked=true,doctor=p.id,rev=rev+1 where id=room_id and not booked and not withdrawn and not draft
 and day >= (now() at time zone 'America/Toronto')::date and (p.category='member' or external) returning * into r;
 if not found then raise exception 'Salle déjà réservée ou non autorisée'; end if;
 perform ra.confirmation(r); perform ra.touch('booking',jsonb_build_object('room',r.id,'doctor',p.id));
end$function$
;

CREATE OR REPLACE FUNCTION public.ra_close_request()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare p ra.people;begin
 p:=ra.lock_me(); if p.id is null then raise exception 'Connexion requise'; end if;
 update ra.people set closure_requested=true where id=p.id;
 perform ra.touch('closure_request',jsonb_build_object('user',p.id));
end$function$
;

CREATE OR REPLACE FUNCTION public.ra_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare p ra.people; result jsonb;begin
 p:=ra.me(); if p.id is null then return jsonb_build_object('profile',null); end if;
 result:=jsonb_build_object('profile',to_jsonb(p)||jsonb_build_object('emails',ra.person_emails(p.id)));
 if p.state<>'active' then return result; end if;
 return result || jsonb_build_object(
 'bookings_frozen',(select frozen from ra.booking_control where singleton), 'choices',(select coalesce(jsonb_agg(c order by kind,label),'[]') from ra.choices c),
 'rooms',(select coalesce(jsonb_agg(x order by day,created_at),'[]') from (
 select r.id,r.day,r.site,r.discipline,r.external,r.withdrawn,r.draft,r.booked,r.rev,r.created_at,
 case when p.admin then r.doctor when r.doctor=p.id then r.doctor else null end doctor,
 case when p.admin then r.ate_name else null end ate_name
 from ra.rooms r where r.deleted_at is null and (p.admin or (not r.withdrawn and not r.draft and ((not r.booked and r.day >= (now() at time zone 'America/Toronto')::date and (p.category='member' or r.external)) or (r.booked and r.doctor=p.id))))
 )x),
 'people',case when p.admin then (select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('emails',ra.person_emails(u.id)) order by name),'[]') from ra.people u where not u.is_test and u.linked_to is null) else '[]'::jsonb end,
 'audit',case when p.admin then (select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('actor_name',(select name from ra.people where id=a.actor)) order by id desc),'[]') from (select * from ra.audit order by id desc limit 300)a) else '[]'::jsonb end,
 'notifications',case when p.admin then (select coalesce(jsonb_object_agg(state,n),'{}') from (select state,count(*) n from ra.jobs group by state)x) else '{}'::jsonb end);
end$function$
;

CREATE OR REPLACE FUNCTION public.ra_subscribe(subscription jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare p ra.people;begin
 p:=ra.lock_me(); if p.state is distinct from 'active' then raise exception 'Compte non autorisé'; end if;
 if subscription->>'endpoint' !~ '^https://[^/]+/' or length(subscription->'keys'->>'p256dh') not between 80 and 100 or length(subscription->'keys'->>'auth') not between 20 and 30 then raise exception 'Abonnement invalide'; end if;
 if (select count(*) from ra.subscriptions where person=p.id)>=8 and not exists(select 1 from ra.subscriptions where endpoint=subscription->>'endpoint' and person=p.id) then raise exception 'Maximum 8 appareils'; end if;
 insert into ra.subscriptions(person,endpoint,keys) values(p.id,subscription->>'endpoint',subscription->'keys') on conflict(endpoint) do update set person=excluded.person,keys=excluded.keys;
end$function$
;

CREATE OR REPLACE FUNCTION public.ra_unsubscribe(endpoint_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare p ra.people;begin
 p:=ra.lock_me();
 delete from ra.subscriptions where person=p.id and endpoint=endpoint_url;
end$function$
;

commit;
