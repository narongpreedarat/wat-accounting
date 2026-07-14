-- ===========================================================================
--  สคริปต์ตั้งค่าฐานข้อมูลวัด — รันใน Supabase ครั้งเดียวตอนเริ่มต้น
--  วิธีรัน: เปิด Supabase > เมนู SQL Editor > New query > วางทั้งหมดนี้ > กด RUN
--  ดูรายละเอียดในไฟล์ README.md หัวข้อ "ขั้นที่ 2"
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ตารางที่ 1: ข้อมูลวัด (1 บัญชีผู้ใช้ = 1 วัด)
-- ---------------------------------------------------------------------------
create table if not exists temples (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null default 'วัดของฉัน',
  address text default '',
  abbot text default '',
  treasurer text default '',
  fiscal_year int default 2569,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- ตารางที่ 2: รายรับ-รายจ่าย
-- ---------------------------------------------------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null,            -- 'income' หรือ 'expense'
  category text not null,
  description text not null,
  amount numeric not null default 0,
  note text default '',
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- ตารางที่ 3: ทะเบียนทรัพย์สิน
-- ---------------------------------------------------------------------------
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  date date not null,
  category text not null,
  name text not null,
  quantity int default 1,
  value numeric default 0,
  source text default '',
  note text default '',
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- ตารางที่ 4: บัญชีเงินฝาก
-- ---------------------------------------------------------------------------
create table if not exists deposits (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  date date not null,
  bank text not null,
  account_number text default '',
  type text not null,            -- 'deposit' / 'withdraw' / 'interest'
  amount numeric not null default 0,
  note text default '',
  created_at timestamptz default now()
);

-- ===========================================================================
--  ⭐ ส่วนที่สำคัญที่สุด: กฎแยกข้อมูลแต่ละวัด (Row Level Security)
--  ตั้งค่านี้แล้ว แต่ละวัดจะเห็นเฉพาะข้อมูลของตัวเองเท่านั้น
-- ===========================================================================

-- เปิดระบบรักษาความปลอดภัยทุกตาราง
alter table temples       enable row level security;
alter table transactions  enable row level security;
alter table assets        enable row level security;
alter table deposits      enable row level security;

-- กฎสำหรับตาราง temples
create policy "เห็นเฉพาะวัดตนเอง" on temples
  for select using (auth.uid() = owner);
create policy "เพิ่มได้เฉพาะของตนเอง" on temples
  for insert with check (auth.uid() = owner);
create policy "แก้ได้เฉพาะของตนเอง" on temples
  for update using (auth.uid() = owner);
create policy "ลบได้เฉพาะของตนเอง" on temples
  for delete using (auth.uid() = owner);

-- กฎสำหรับตาราง transactions
create policy "เห็นเฉพาะของตนเอง" on transactions
  for select using (auth.uid() = owner);
create policy "เพิ่มได้เฉพาะของตนเอง" on transactions
  for insert with check (auth.uid() = owner);
create policy "แก้ได้เฉพาะของตนเอง" on transactions
  for update using (auth.uid() = owner);
create policy "ลบได้เฉพาะของตนเอง" on transactions
  for delete using (auth.uid() = owner);

-- กฎสำหรับตาราง assets
create policy "เห็นเฉพาะของตนเอง" on assets
  for select using (auth.uid() = owner);
create policy "เพิ่มได้เฉพาะของตนเอง" on assets
  for insert with check (auth.uid() = owner);
create policy "แก้ได้เฉพาะของตนเอง" on assets
  for update using (auth.uid() = owner);
create policy "ลบได้เฉพาะของตนเอง" on assets
  for delete using (auth.uid() = owner);

-- กฎสำหรับตาราง deposits
create policy "เห็นเฉพาะของตนเอง" on deposits
  for select using (auth.uid() = owner);
create policy "เพิ่มได้เฉพาะของตนเอง" on deposits
  for insert with check (auth.uid() = owner);
create policy "แก้ได้เฉพาะของตนเอง" on deposits
  for update using (auth.uid() = owner);
create policy "ลบได้เฉพาะของตนเอง" on deposits
  for delete using (auth.uid() = owner);

-- เสร็จแล้ว! ฐานข้อมูลพร้อมใช้งานและแยกข้อมูลแต่ละวัดอัตโนมัติ
