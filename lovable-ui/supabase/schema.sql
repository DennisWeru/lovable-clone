-- Create profiles table linked to auth.users
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text not null,
  role text not null default 'user'::text,
  credits integer not null default 1000,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.profiles enable row level security;

-- Create policies
create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

create policy "Users can update own profile." on profiles
  for update using (auth.uid() = id);

create policy "Admins can update all profiles." on profiles
  for update using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can view all profiles." on profiles
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Function to handle new user signups
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role, credits)
  values (new.id, new.email, 'user', 1000);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for new user signups
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- Create projects table
create table public.projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  prompt text not null,
  sandbox_id text,
  preview_url text,
  model text not null,
  status text not null default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.projects enable row level security;

-- Create policies for projects
create policy "Users can view own projects." on projects
  for select using (auth.uid() = user_id);

create policy "Users can insert own projects." on projects
  for insert with check (auth.uid() = user_id);

create policy "Users can update own projects." on projects
  for update using (auth.uid() = user_id);

create policy "Admins can view all projects." on projects
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can update all projects." on projects
  for update using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );
