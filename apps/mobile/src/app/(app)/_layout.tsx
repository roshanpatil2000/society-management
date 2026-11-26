import { Stack } from 'expo-router';

import { useGateContext } from '@/features/auth/AuthGate';
import { usePushRegistration } from '@/features/devices/usePushRegistration';

export default function AppLayout() {
  const { session } = useGateContext();
  usePushRegistration(session?.user.id);
  return <Stack screenOptions={{ headerShown: false }} />;
}
