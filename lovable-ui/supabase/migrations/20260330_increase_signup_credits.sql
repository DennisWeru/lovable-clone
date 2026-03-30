-- Update the default credits award for new users to 20,000 ($2.00)

-- 1. Update the default value for the profiles table
ALTER TABLE public.profiles 
ALTER COLUMN credits SET DEFAULT 20000;

-- 2. Update the handle_new_user trigger function to award 20,000 credits
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, credits)
  VALUES (new.id, new.email, 'user', 20000);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
