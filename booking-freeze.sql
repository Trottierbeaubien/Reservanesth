-- Pending change: reservation freeze, off by default.
begin;
create table ra.booking_control (
 singleton boolean primary key default true check(singleton),
 frozen boolean not null default false
);
insert into ra.booking_control values (true,false);
alter table ra.booking_control enable row level security;
revoke all on ra.booking_control from public,anon,authenticated;

create function ra.enforce_booking_freeze() returns trigger
language plpgsql security definer set search_path='' as $$
declare locked boolean;
begin
 if new.booked then
  if TG_OP='UPDATE' then
   if old.booked then return new; end if;
  end if;
  -- Held until commit: freezing waits for earlier bookings; later bookings fail.
  select frozen into strict locked from ra.booking_control where singleton for share;
  if locked then raise exception 'Les réservations sont temporairement gelées par l’administrateur.'; end if;
 end if;
 return new;
end$$;
revoke all on function ra.enforce_booking_freeze() from public,anon,authenticated;
create trigger enforce_booking_freeze before insert or update on ra.rooms
for each row execute function ra.enforce_booking_freeze();

create function public.ra_set_booking_freeze(p_freeze boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not ra.is_admin() then raise exception 'Administration requise'; end if;
 if p_freeze is null then raise exception 'État du gel requis'; end if;
 update ra.booking_control set frozen=p_freeze where singleton;
 perform ra.touch('booking_freeze',jsonb_build_object('frozen',p_freeze));
end$$;
revoke all on function public.ra_set_booking_freeze(boolean) from public,anon,authenticated;
grant execute on function public.ra_set_booking_freeze(boolean) to authenticated;

-- Preserve the installed snapshot, including existing visibility restrictions.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.ra_snapshot()'::regprocedure);
 if position('''choices'',' in definition)=0 then raise exception 'Snapshot incompatible'; end if;
 definition:=replace(definition,'''choices'',','''bookings_frozen'',(select frozen from ra.booking_control where singleton), ''choices'',');
 execute definition;
end$$;
commit;
