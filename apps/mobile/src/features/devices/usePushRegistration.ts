import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

import { registerForPush } from './push';

/** Once per signed-in session: register this phone's push token. Failures are not fatal. */
export function usePushRegistration(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    void registerForPush({
      platform: Platform.OS,
      isDevice: Device.isDevice,
      getPermission: async () => (await Notifications.getPermissionsAsync()).status,
      requestPermission: async () => (await Notifications.requestPermissionsAsync()).status,
      getToken: async () => {
        const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
          ?.projectId;
        return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined))
          .data;
      },
      register: async (token, platform) => {
        const { error } = await supabase.rpc('register_device', {
          p_token: token,
          p_platform: platform,
        });
        if (error) throw error;
      },
    }).catch((e: unknown) => console.warn('Push registration failed', e));
  }, [userId]);
}
