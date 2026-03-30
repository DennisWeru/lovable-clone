-- Function to check if a user is an admin without recursion
-- Security definer bypasses RLS
create or replace function public.is_admin()
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
end;
$$ language plpgsql security definer;

-- Drop existing problematic select policies on profiles
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Admins can view all profiles." on public.profiles;

-- Create new non-recursive select policies on profiles
create policy "Users can view own profile." on public.profiles
  for select using (auth.uid() = id);

create policy "Admins can view all profiles." on public.profiles
  for select using (public.is_admin());

-- Update update policies on profiles to use the new function
drop policy if exists "Admins can update all profiles." on public.profiles;
create policy "Admins can update all profiles." on public.profiles
  for update using (public.is_admin());

-- Update policies on projects for consistency
drop policy if exists "Admins can view all projects." on public.projects;
drop policy if exists "Admins can update all projects." on public.projects;

create policy "Admins can view all projects." on public.projects
  for select using (public.is_admin());

create policy "Admins can update all projects." on public.projects
  for update using (public.is_admin());
