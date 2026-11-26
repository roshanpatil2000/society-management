import { useQuery } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Button, List, Text } from 'react-native-paper';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';

import { listSocieties } from './api';
import { STATUS_KEYS } from './status';

export function SocietiesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const societies = useQuery({ queryKey: ['admin', 'societies'], queryFn: listSocieties });

  return (
    <Screen>
      <Text variant="headlineMedium">{t('admin.societies')}</Text>
      <Button mode="contained" icon="plus" onPress={() => router.push('/admin/onboard')}>
        {t('admin.onboard')}
      </Button>
      {societies.isPending ? <ActivityIndicator /> : null}
      <ErrorText message={societies.error ? t(errorKey(societies.error)) : null} />
      {societies.data?.map((s) => (
        <List.Item
          key={s.id}
          title={s.name}
          description={`${s.slug} · ${t(STATUS_KEYS[s.status] ?? 'admin.active')}`}
          onPress={() => router.push(`/admin/society/${s.id}` as Href)}
          accessibilityRole="button"
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
        />
      ))}
    </Screen>
  );
}
