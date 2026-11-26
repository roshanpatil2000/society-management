import { useLocalSearchParams } from 'expo-router';

import { SocietyDetailScreen } from '@/features/admin/SocietyDetailScreen';
import { env } from '@/lib/env';

export default function SocietyRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return (
    <SocietyDetailScreen
      societyId={id}
      webUrl={env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:8081'}
    />
  );
}
