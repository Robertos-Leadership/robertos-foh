-- Roberto's Leadership Hub — Supabase Schema
-- Run this in Supabase SQL Editor

-- EVENTS table
create table if not exists events (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  day_of_week text not null,
  description text,
  time_start text,
  capacity integer default 50,
  avg_spend_target numeric default 0,
  entertainment_cost numeric default 0,
  created_at timestamptz default now()
);

-- WEEKS table (each weekly occurrence)
create table if not exists weeks (
  id uuid default gen_random_uuid() primary key,
  event_id uuid references events(id) on delete cascade,
  week_date date not null,
  week_label text,
  status text default 'upcoming', -- upcoming, active, completed
  covers_actual integer,
  revenue_actual numeric,
  avg_spend_actual numeric,
  notes text,
  created_at timestamptz default now()
);

-- TASKS table
create table if not exists tasks (
  id uuid default gen_random_uuid() primary key,
  week_id uuid references weeks(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  track text not null, -- marketing, champion, technical, guest_revenue, service, finance, documents
  title text not null,
  description text,
  assigned_to text, -- team member name
  champion text,    -- final approver
  status text default 'not_started', -- not_started, in_progress, done, blocked
  due_date date,
  notes text,
  doc_url text,
  is_template boolean default false,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- FINANCE table
create table if not exists finance (
  id uuid default gen_random_uuid() primary key,
  week_id uuid references weeks(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  supplier_name text not null,
  description text,
  amount numeric not null default 0,
  currency text default 'AED',
  contract_status text default 'not_sent', -- not_sent, sent, signed
  payment_status text default 'pending',   -- pending, approved, paid
  payment_method text,
  invoice_url text,
  approved_by text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS (allow all for now)
alter table events enable row level security;
alter table weeks enable row level security;
alter table tasks enable row level security;
alter table finance enable row level security;

create policy "Allow all events" on events for all using (true) with check (true);
create policy "Allow all weeks" on weeks for all using (true) with check (true);
create policy "Allow all tasks" on tasks for all using (true) with check (true);
create policy "Allow all finance" on finance for all using (true) with check (true);

-- Enable realtime
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table finance;
alter publication supabase_realtime add table weeks;

-- Seed events
insert into events (name, day_of_week, description, time_start, capacity, avg_spend_target, entertainment_cost) values
('The Listening Bar', 'Monday', 'Vinyl only. Proper pours. Long conversations.', '20:00', 50, 250, 2500),
('Jazz Tuesdays', 'Tuesday', 'Live jazz. Every Tuesday. Three resident artists. One stage. Rotating weekly.', '20:20', 50, 350, 4500);

-- v2 (June 2026): recurring programme controls
alter table events add column if not exists status text default 'active'; -- active | paused

-- Full weekly programme seed
insert into events (name, day_of_week, description, time_start, capacity, avg_spend_target, entertainment_cost) values
('Comedy Night', 'Wednesday', 'Stand-up comedy. Midweek laughter, full bar.', '21:00', 50, 0, 0),
('Cigar Night', 'Saturday', 'Cigar lounge evening. Slow pours, premium selection.', '21:00', 50, 0, 0);
