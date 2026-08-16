-- ЗАКУП: схема базы данных для Supabase
-- Выполните этот файл в Supabase SQL Editor (Project -> SQL Editor -> New query)

create extension if not exists "pgcrypto";

-- Точки ресторана (AFRO, Yupaper, Sharks, Tgr, Karina ...)
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Поставщики (общие, могут использоваться в разных точках)
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  note text,             -- напр. "оплата с кассы"
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Товары (каталог)
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete set null,
  name text not null,
  category text,          -- напр. "Салфетки", "Одноразовые посуды"
  unit text not null default 'шт',   -- ед. измерения: шт, кг, л, уп, пач ...
  price numeric(12,2) not null default 0,   -- цена в тг за ед.
  payment_note text,      -- "с кассы" и т.п., копируется из поставщика по умолчанию
  is_archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_products_supplier on products(supplier_id);
create index if not exists idx_products_name on products using gin (to_tsvector('simple', name));

-- Какие товары доступны в какой точке + возможность переопределить цену для точки
create table if not exists location_products (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  price_override numeric(12,2),
  unique (location_id, product_id)
);

-- Настройки приложения (шаблон имени отчёта, лого текст и т.д.)
create table if not exists app_settings (
  id int primary key default 1,
  report_filename_template text not null default 'ЗАКУП_{location}_{date}',
  company_name text not null default '',
  constraint single_row check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- Заказы (закупы) — история
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete set null,
  status text not null default 'draft',   -- draft | finished
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text,     -- снимок на момент заказа
  supplier_contact text,
  product_name text,
  unit text,
  quantity numeric(12,2) not null default 0,
  price numeric(12,2) not null default 0,
  payment_note text,
  sort_order int not null default 0
);

-- Простая политика доступа: разрешить всё для anon-ключа (внутренний инструмент).
-- Если нужен логин — включите auth и замените политики на "authenticated".
alter table locations enable row level security;
alter table suppliers enable row level security;
alter table products enable row level security;
alter table location_products enable row level security;
alter table app_settings enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "allow all locations" on locations for all using (true) with check (true);
create policy "allow all suppliers" on suppliers for all using (true) with check (true);
create policy "allow all products" on products for all using (true) with check (true);
create policy "allow all location_products" on location_products for all using (true) with check (true);
create policy "allow all app_settings" on app_settings for all using (true) with check (true);
create policy "allow all orders" on orders for all using (true) with check (true);
create policy "allow all order_items" on order_items for all using (true) with check (true);
