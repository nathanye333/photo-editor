-- Field catalog: per-user photo state (recipes, metadata) + image blobs in Storage.
-- Scoped by auth.uid() via RLS. Browser catalog no longer uses localStorage/IndexedDB.

create table if not exists public.photos (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null,
  mtime bigint not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  exif jsonb not null default '{}'::jsonb,
  rating integer not null default 0,
  flag text not null default 'unflagged',
  recipe jsonb not null,
  history jsonb not null,
  folder text not null default '',
  kind text not null default 'bitmap',
  master_id text,
  copy_name text,
  keywords jsonb not null default '[]'::jsonb,
  color_label text,
  title text not null default '',
  caption text not null default '',
  copyright text not null default '',
  creator text not null default '',
  quick_collection boolean not null default false,
  stack_id text,
  stack_index integer default 0,
  latitude double precision,
  longitude double precision,
  storage_path text,
  thumb_storage_path text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists photos_user_folder_idx on public.photos (user_id, folder);
create index if not exists photos_user_path_idx on public.photos (user_id, path);

create table if not exists public.presets (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  recipe jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.recipe_snapshots (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  photo_id text not null,
  name text not null,
  recipe jsonb not null,
  created_at bigint not null,
  primary key (user_id, id)
);

create index if not exists recipe_snapshots_photo_idx
  on public.recipe_snapshots (user_id, photo_id);

create table if not exists public.collections (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'manual',
  rules jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.collection_photos (
  user_id uuid not null references auth.users (id) on delete cascade,
  collection_id text not null,
  photo_id text not null,
  sort_order integer not null default 0,
  primary key (user_id, collection_id, photo_id)
);

alter table public.photos enable row level security;
alter table public.presets enable row level security;
alter table public.recipe_snapshots enable row level security;
alter table public.collections enable row level security;
alter table public.collection_photos enable row level security;

create policy "photos_select_own" on public.photos
  for select to authenticated using (user_id = auth.uid());
create policy "photos_insert_own" on public.photos
  for insert to authenticated with check (user_id = auth.uid());
create policy "photos_update_own" on public.photos
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "photos_delete_own" on public.photos
  for delete to authenticated using (user_id = auth.uid());

create policy "presets_select_own" on public.presets
  for select to authenticated using (user_id = auth.uid());
create policy "presets_insert_own" on public.presets
  for insert to authenticated with check (user_id = auth.uid());
create policy "presets_update_own" on public.presets
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "presets_delete_own" on public.presets
  for delete to authenticated using (user_id = auth.uid());

create policy "snapshots_select_own" on public.recipe_snapshots
  for select to authenticated using (user_id = auth.uid());
create policy "snapshots_insert_own" on public.recipe_snapshots
  for insert to authenticated with check (user_id = auth.uid());
create policy "snapshots_update_own" on public.recipe_snapshots
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "snapshots_delete_own" on public.recipe_snapshots
  for delete to authenticated using (user_id = auth.uid());

create policy "collections_select_own" on public.collections
  for select to authenticated using (user_id = auth.uid());
create policy "collections_insert_own" on public.collections
  for insert to authenticated with check (user_id = auth.uid());
create policy "collections_update_own" on public.collections
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "collections_delete_own" on public.collections
  for delete to authenticated using (user_id = auth.uid());

create policy "collection_photos_select_own" on public.collection_photos
  for select to authenticated using (user_id = auth.uid());
create policy "collection_photos_insert_own" on public.collection_photos
  for insert to authenticated with check (user_id = auth.uid());
create policy "collection_photos_update_own" on public.collection_photos
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "collection_photos_delete_own" on public.collection_photos
  for delete to authenticated using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photo-images',
  'photo-images',
  false,
  104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy "photo_images_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'photo-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photo_images_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'photo-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photo_images_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'photo-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photo-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photo_images_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'photo-images' and (storage.foldername(name))[1] = auth.uid()::text);
