import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Database } from '@society/shared';

import { createChunkedStorage } from './chunked-storage';
import { env } from './env';

// Native: the session lives in the device's secure store (Keychain / Keystore),
// split into chunks because it is larger than one secure-store item.
// Web: the browser's localStorage (supabase-js default).
const nativeStorage = createChunkedStorage({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
});

export const supabase = createClient<Database>(
  env.EXPO_PUBLIC_SUPABASE_URL,
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      ...(Platform.OS === 'web' ? {} : { storage: nativeStorage }),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  },
);
