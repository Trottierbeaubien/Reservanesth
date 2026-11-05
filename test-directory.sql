begin;
alter table ra.people add column is_test boolean not null default false;
update ra.people set is_test=true
where name in ('TEST CONCURRENCE FICTIF A','TEST CONCURRENCE FICTIF B')
and email like 'ra-race-%@example.invalid' and state='excluded' and not admin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.ra_snapshot()'::regprocedure);
 if position('from ra.people u)' in definition)=0 then raise exception 'Snapshot incompatible'; end if;
 definition:=replace(definition,'from ra.people u)','from ra.people u where not u.is_test)');
 execute definition;
end$$;
commit;
