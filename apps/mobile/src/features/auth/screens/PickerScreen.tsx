import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, List, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { useSessionStore } from '@/stores/session';

import type { MembershipSummary } from '../api';

export function PickerScreen({ memberships }: { memberships: readonly MembershipSummary[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const setActiveSociety = useSessionStore((s) => s.setActiveSociety);

  return (
    <Screen>
      <Text variant="headlineSmall">{t('membership.pickerTitle')}</Text>
      {memberships.map((m) => (
        <List.Item
          key={m.society_id}
          title={m.society_name}
          description={m.role_names.join(', ')}
          left={(props) => <List.Icon {...props} icon="office-building" />}
          onPress={() => setActiveSociety(m.society_id)}
          accessibilityRole="button"
        />
      ))}
      <Button icon="plus" onPress={() => router.push('/discover')}>
        {t('membership.joinAnother')}
      </Button>
    </Screen>
  );
}
