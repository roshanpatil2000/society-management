import { useTranslation } from 'react-i18next';
import { Card, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import type { Access } from '@/features/auth/api';
import { YourFlatCard } from '@/features/society/YourFlatCard';
import { useSessionStore } from '@/stores/session';

export function HomeScreen({ access }: { access: Access }) {
  const { t } = useTranslation();
  const activeSocietyId = useSessionStore((s) => s.activeSocietyId);
  const society = access.memberships.find((m) => m.society_id === activeSocietyId);

  return (
    <Screen>
      <Text variant="headlineMedium">
        {t('home.greeting', { name: access.fullName ?? access.email ?? '' })}
      </Text>
      {society ? <Text variant="titleMedium">{society.society_name}</Text> : null}
      <YourFlatCard />
      <Card>
        <Card.Content>
          <Text variant="bodyMedium">{t('home.comingSoon')}</Text>
        </Card.Content>
      </Card>
    </Screen>
  );
}
