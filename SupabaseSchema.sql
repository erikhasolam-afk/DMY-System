-- ═══════════════════════════════════════════════════════════════════════
-- DMY Dental Clinic — Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- 1. PATIENTS
--    Core table. pid is the app-generated ID like "#DMY-001".
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.patients (
  id               uuid primary key default gen_random_uuid(),
  pid              text unique not null,          -- e.g. "#DMY-001"
  name             text not null,
  last_name        text,
  first_name       text,
  middle_name      text,
  nickname         text,
  birthdate        date,
  age              integer,
  sex              text check (sex in ('Male','Female','Other')),
  religion         text,
  nationality      text default 'Filipino',
  address          text,
  occupation       text,
  mobile           text,
  email            text,
  dental_insurance text,
  guardian         text,
  referrer         text,
  reason           text,
  previous_dentist text,
  last_visit       date,
  physician        text,
  specialty        text,
  signature        text,
  health           jsonb,                         -- full health questionnaire answers
  registered_date  date not null default current_date,
  status           text default 'New',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Keep updated_at current automatically
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_patients_updated_at on public.patients;
create trigger trg_patients_updated_at
  before update on public.patients
  for each row execute procedure public.set_updated_at();

-- Indexes for common lookups
create index if not exists idx_patients_name            on public.patients (lower(name));
create index if not exists idx_patients_registered_date on public.patients (registered_date desc);
create index if not exists idx_patients_status          on public.patients (status);


-- ────────────────────────────────────────────────────────────────────────
-- 2. TREATMENTS
--    One row per treatment visit entry (the ledger rows).
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.treatments (
  id           uuid primary key default gen_random_uuid(),
  patient_name text not null,                    -- denormalized for fast lookup
  date         date not null,
  tooth        text,                             -- comma-separated tooth numbers e.g. "14,15"
  procedure    text not null,
  dentist      text default 'Dr. Santos',
  charged      numeric(10,2) default 0,
  paid         numeric(10,2) default 0,
  balance      numeric(10,2) generated always as (charged - paid) stored,
  next_appt    date,
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists idx_treatments_patient on public.treatments (lower(patient_name));
create index if not exists idx_treatments_date    on public.treatments (date desc);


-- ────────────────────────────────────────────────────────────────────────
-- 3. DENTAL CHARTS
--    One row per patient (upsert on patient_name).
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.dental_charts (
  id           uuid primary key default gen_random_uuid(),
  patient_name text unique not null,
  tooth_state  jsonb,                            -- { "14": "D", "15": "F", ... }
  conditions   jsonb,                            -- { perio: [], occl: [], appl: [], tmd: [] }
  updated_at   timestamptz default now()
);

drop trigger if exists trg_charts_updated_at on public.dental_charts;
create trigger trg_charts_updated_at
  before update on public.dental_charts
  for each row execute procedure public.set_updated_at();

create index if not exists idx_charts_patient on public.dental_charts (lower(patient_name));


-- ────────────────────────────────────────────────────────────────────────
-- 4. PATIENT IMAGES
--    X-rays and photos. src stores base64 data-URI.
--    NOTE: base64 images can be large — consider Supabase Storage for
--    production; swap src for a storage path and fetch the URL client-side.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.patient_images (
  id           uuid primary key default gen_random_uuid(),
  patient_name text not null,
  src          text not null,                    -- base64 data-URI OR storage path
  type         text default 'X-ray',             -- e.g. "X-ray", "Periapical", "Photo"
  note         text,
  filename     text,
  uploaded_at  timestamptz default now()
);

create index if not exists idx_images_patient on public.patient_images (lower(patient_name));
create index if not exists idx_images_date    on public.patient_images (uploaded_at desc);


-- ════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS on every table, then allow authenticated users full access.
-- Adjust these policies to match your access model.
-- ════════════════════════════════════════════════════════════════════════

alter table public.patients       enable row level security;
alter table public.treatments     enable row level security;
alter table public.dental_charts  enable row level security;
alter table public.patient_images enable row level security;

-- Authenticated users (logged-in clinic staff) can do everything
create policy "auth users — patients all"
  on public.patients for all
  to authenticated
  using (true) with check (true);

create policy "auth users — treatments all"
  on public.treatments for all
  to authenticated
  using (true) with check (true);

create policy "auth users — dental_charts all"
  on public.dental_charts for all
  to authenticated
  using (true) with check (true);

create policy "auth users — patient_images all"
  on public.patient_images for all
  to authenticated
  using (true) with check (true);

-- ════════════════════════════════════════════════════════════════════════
-- USEFUL VIEWS (optional but handy in Supabase Table Editor)
-- ════════════════════════════════════════════════════════════════════════

-- Quick patient summary with outstanding balance
create or replace view public.v_patient_summary as
select
  p.pid,
  p.name,
  p.age,
  p.sex,
  p.mobile,
  p.status,
  p.registered_date,
  coalesce(sum(t.charged), 0)                  as total_charged,
  coalesce(sum(t.paid), 0)                     as total_paid,
  coalesce(sum(t.balance), 0)                  as outstanding_balance,
  count(t.id)                                  as visit_count,
  max(t.date)                                  as last_visit_date
from public.patients p
left join public.treatments t on lower(t.patient_name) = lower(p.name)
group by p.id, p.pid, p.name, p.age, p.sex, p.mobile, p.status, p.registered_date;


-- Monthly income summary (used by the Reports page)
create or replace view public.v_monthly_income as
select
  extract(year  from date)::int as year,
  extract(month from date)::int as month,
  sum(charged)  as total_charged,
  sum(paid)     as total_paid,
  sum(balance)  as total_balance,
  count(*)      as procedure_count
from public.treatments
group by 1, 2
order by 1 desc, 2 desc;