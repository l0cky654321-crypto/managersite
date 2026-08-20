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
  hint text,               -- короткая подсказка, напр. "К этому ведру нужна крышка: ..."
  is_archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_products_supplier on products(supplier_id);
create index if not exists idx_products_name on products using gin (to_tsvector('simple', name));

-- Если таблица products уже была создана раньше без колонки hint —
-- эта строка безопасно добавит её (ничего не сломает при повторном запуске).
alter table products add column if not exists hint text;

-- Товар относится к «кухне» — попадает в изолированную вкладку «Кухня»
-- (свой закуп, свои остатки, своя ревизия, без доступа к остальным данным).
alter table products add column if not exists is_kitchen boolean not null default false;

-- Какие товары доступны в какой точке + возможность переопределить цену для точки
-- + необязательный лимит количества этого товара на эту точку в одном закупе.
create table if not exists location_products (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  price_override numeric(12,2),
  max_qty numeric(12,2),
  unique (location_id, product_id)
);
alter table location_products add column if not exists max_qty numeric(12,2);

-- Свой 4-значный PIN на каждую точку — при входе во вкладку «Кухня» человек
-- вводит код и попадает СРАЗУ в свою точку, без возможности переключиться на
-- другую: так одна точка физически не видит остатки/ревизию/закуп другой.
alter table locations add column if not exists pin text;
-- Гарантирует, что два разных PIN-кода не совпадают (иначе непонятно, в чью
-- точку попадёт человек, который его ввёл). Пустые/NULL PIN не ограничены.
create unique index if not exists idx_locations_pin on locations (pin) where pin is not null and pin <> '';

-- Настройки приложения (шаблон имени отчёта, лого текст)
create table if not exists app_settings (
  id int primary key default 1,
  report_filename_template text not null default 'ЗАКУП_{location}_{date}',
  company_name text not null default '',
  kitchen_pin text not null default '',   -- устарело: PIN теперь у каждой точки (locations.pin), поле оставлено для обратной совместимости
  constraint single_row check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;
alter table app_settings add column if not exists kitchen_pin text not null default '';

-- Заказы (закупы) — история
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete set null,
  status text not null default 'draft',   -- draft | finished
  source text not null default 'main',    -- main | kitchen — чтобы «Повторить прошлый закуп»
                                           -- и статистика частых товаров не смешивали кухню и обычный закуп
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table orders add column if not exists source text not null default 'main';

-- Текущие остатки по товару на точке (редактируется вручную на вкладке «Остатки»,
-- а также обновляется при сохранении ревизии — становится «учётным» значением).
create table if not exists stock_levels (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (location_id, product_id)
);

-- Ревизии (инвентаризации) — сверка фактического остатка с учётным.
create table if not exists revisions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id) on delete set null,
  location_name text,      -- снимок названия точки на момент ревизии
  source text not null default 'main',   -- main | kitchen
  note text,
  created_at timestamptz not null default now()
);

create table if not exists revision_items (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references revisions(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text,
  unit text,
  expected_qty numeric(12,2) not null default 0,   -- учётный остаток на момент ревизии
  actual_qty numeric(12,2) not null default 0,     -- фактический (посчитанный) остаток
  diff numeric(12,2) not null default 0,           -- actual - expected
  sort_order int not null default 0
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
alter table stock_levels enable row level security;
alter table revisions enable row level security;
alter table revision_items enable row level security;

-- "drop policy if exists" перед каждым "create policy" делает файл безопасным
-- для повторного запуска — раньше повторный запуск падал с ошибкой
-- 42710 "policy ... already exists", если политика уже была создана раньше.
drop policy if exists "allow all locations" on locations;
create policy "allow all locations" on locations for all using (true) with check (true);

drop policy if exists "allow all suppliers" on suppliers;
create policy "allow all suppliers" on suppliers for all using (true) with check (true);

drop policy if exists "allow all products" on products;
create policy "allow all products" on products for all using (true) with check (true);

drop policy if exists "allow all location_products" on location_products;
create policy "allow all location_products" on location_products for all using (true) with check (true);

drop policy if exists "allow all app_settings" on app_settings;
create policy "allow all app_settings" on app_settings for all using (true) with check (true);

drop policy if exists "allow all orders" on orders;
create policy "allow all orders" on orders for all using (true) with check (true);

drop policy if exists "allow all order_items" on order_items;
create policy "allow all order_items" on order_items for all using (true) with check (true);

drop policy if exists "allow all stock_levels" on stock_levels;
create policy "allow all stock_levels" on stock_levels for all using (true) with check (true);

drop policy if exists "allow all revisions" on revisions;
create policy "allow all revisions" on revisions for all using (true) with check (true);

drop policy if exists "allow all revision_items" on revision_items;
create policy "allow all revision_items" on revision_items for all using (true) with check (true);
