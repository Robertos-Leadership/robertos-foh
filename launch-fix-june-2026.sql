-- Roberto's Leadership Hub - Launch fix (June 2026)
-- Run once in Supabase SQL Editor. Safe to re-run.

-- 1) Restore write access (anon role) - tables are currently read-only
drop policy if exists "Allow all events"  on events;
drop policy if exists "Allow all weeks"   on weeks;
drop policy if exists "Allow all tasks"   on tasks;
drop policy if exists "Allow all finance" on finance;
create policy "Allow all events"  on events  for all using (true) with check (true);
create policy "Allow all weeks"   on weeks   for all using (true) with check (true);
create policy "Allow all tasks"   on tasks   for all using (true) with check (true);
create policy "Allow all finance" on finance for all using (true) with check (true);

-- 2) Pause/resume support for recurring events
alter table events add column if not exists status text default 'active'; -- active | paused

-- 3) Seed the weekly recurring programme (only if not already present)
insert into events (name, day_of_week, description, time_start, capacity, avg_spend_target, entertainment_cost)
select * from (values
  ('The Listening Bar','Monday','Vinyl only. Proper pours. Long conversations.','20:00',50,250::numeric,2500::numeric),
  ('Jazz Tuesdays','Tuesday','Live jazz. Every Tuesday. Three resident artists. One stage. Rotating weekly.','20:20',50,350::numeric,4500::numeric),
  ('Comedy Night','Wednesday','Stand-up comedy. Midweek laughter, full bar.','21:00',50,0::numeric,0::numeric),
  ('Cigar Night','Saturday','Cigar lounge evening. Slow pours, premium selection.','21:00',50,0::numeric,0::numeric)
) as v(name, day_of_week, description, time_start, capacity, avg_spend_target, entertainment_cost)
where not exists (select 1 from events e where e.name = v.name);
