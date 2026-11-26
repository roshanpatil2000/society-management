import { z } from 'zod';

// Public values only. The anon key is safe in the app; RLS protects the data.
const schema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  EXPO_PUBLIC_WEB_URL: z.url().optional(),
  EXPO_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
});

// Expo inlines EXPO_PUBLIC_* only when accessed literally, so list them explicitly.
export const env = schema.parse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL || undefined,
  EXPO_PUBLIC_TURNSTILE_SITE_KEY: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || undefined,
});
