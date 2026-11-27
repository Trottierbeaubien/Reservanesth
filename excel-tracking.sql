begin;
create table ra.excel_tracking(
 room_id uuid primary key references ra.rooms(id), version bigint not null default 1,
 recorded_version bigint not null default 0, kind text not null check(kind in('new','modified','cancelled')),
 current_data jsonb not null, recorded_data jsonb, changed_at timestamptz not null default now(),
 recorded_at timestamptz, recorded_by uuid references ra.people(id),
 check(recorded_version>=0 and recorded_version<=version)
);
alter table ra.excel_tracking enable row level security;
revoke all on ra.excel_tracking from public,anon,authenticated;
create index excel_tracking_pending on ra.excel_tracking(changed_at) where version>recorded_version;
create index excel_tracking_recorded_by on ra.excel_tracking(recorded_by) where recorded_by is not null;

create function ra.excel_row(r ra.rooms) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('day',r.day,'site',r.site,'site_label',(select label from ra.choices where id=r.site),
 'discipline',r.discipline,'discipline_label',(select label from ra.choices where id=r.discipline),
 'doctor',coalesce((select name from ra.people where id=r.doctor),r.ate_name,'ATE — nom à venir'),
 'category',case when r.ate_name is not null or (select category from ra.people where id=r.doctor)='external' then 'ATE' else 'Membre' end,'booked',r.booked)
$$;
create function ra.track_excel_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare prior ra.excel_tracking; content jsonb;
begin
 if TG_OP='INSERT' then if not new.booked then return new; end if;
 elsif not old.booked and not new.booked then return new;
 end if;
 select * into prior from ra.excel_tracking where room_id=new.id for update;
 if new.booked then content:=ra.excel_row(new);
 else content:=coalesce(prior.current_data,ra.excel_row(old))||jsonb_build_object('booked',false);
 end if;
 if prior.room_id is not null and prior.current_data=content then return new; end if;
 insert into ra.excel_tracking as t(room_id,kind,current_data)
 values(new.id,case when not new.booked then 'cancelled' else 'new' end,content)
 on conflict(room_id) do update set version=t.version+1,current_data=excluded.current_data,changed_at=now(),
 kind=case when not new.booked then 'cancelled' when (t.recorded_data->>'booked')::boolean then 'modified' else 'new' end;
 return new;
end$$;
create trigger track_excel_booking after insert or update of booked,day,site,discipline,doctor,ate_name on ra.rooms for each row execute function ra.track_excel_booking();
-- Name/category corrections affect what must be entered into Excel too.
create function ra.track_excel_person() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.name is distinct from old.name or new.category is distinct from old.category then
 update ra.rooms set doctor=doctor where doctor=new.id and booked and deleted_at is null;
 end if; return new;
end$$;
create trigger track_excel_person after update of name,category on ra.people for each row execute function ra.track_excel_person();
-- Existing future reservations need review: never assume they have already been copied.
insert into ra.excel_tracking(room_id,kind,current_data)
 select id,'new',ra.excel_row(r) from ra.rooms r where booked and deleted_at is null and day>=(now() at time zone 'America/Toronto')::date;

create function public.ra_mark_excel(items jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; entry ra.excel_tracking;
begin
 if not ra.is_admin() then raise exception 'Administration requise'; end if;
 if jsonb_typeof(items) is distinct from 'array' then raise exception 'Sélection requise'; end if;
 if jsonb_array_length(items) not between 1 and 100 then raise exception 'Sélection de 1 à 100 réservations'; end if;
 for item in select value from jsonb_array_elements(items) order by value->>'room_id' loop
  select * into entry from ra.excel_tracking where room_id=(item->>'room_id')::uuid for update;
  if entry.room_id is null then raise exception 'Réservation inconnue'; end if;
  if (item->>'version')::bigint is distinct from entry.version then raise exception 'Une réservation a changé. Actualisez la liste avant de confirmer la saisie dans Excel'; end if;
  update ra.excel_tracking set recorded_version=version,recorded_data=current_data,recorded_at=now(),recorded_by=(ra.me()).id where room_id=entry.room_id;
 end loop;
 perform ra.touch('excel_recorded',jsonb_build_object('items',items));
end$$;
revoke all on function ra.excel_row(ra.rooms),ra.track_excel_booking(),ra.track_excel_person() from public,anon,authenticated;
revoke all on function public.ra_mark_excel(jsonb) from public,anon,authenticated;
grant execute on function public.ra_mark_excel(jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.ra_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare p ra.people; result jsonb;begin
 p:=ra.me(); if p.id is null then return jsonb_build_object('profile',null); end if;
 result:=jsonb_build_object('profile',to_jsonb(p)||jsonb_build_object('emails',ra.person_emails(p.id)));
 if p.state<>'active' then return result; end if;
 return result || (case when p.admin then jsonb_build_object('excel',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('handled',e.recorded_version=e.version) order by e.changed_at desc,e.room_id),'[]'::jsonb) from ra.excel_tracking e)) else '{}'::jsonb end) || jsonb_build_object(
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
commit;
