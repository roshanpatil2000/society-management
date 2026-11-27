import { useQuery } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card, List } from 'react-native-paper';

import { useSessionStore } from '@/stores/session';

import { myFlats } from './api';
import { occupantLabel } from './labels';

/** The signed-in person's flats in the active society, each opening its statement. Hidden for people with none. */
export function YourFlatCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const flats = useQuery({
    queryKey: ['my-flats', societyId],
    queryFn: () => myFlats(societyId),
    enabled: Boolean(societyId),
  });
  if (!flats.data || flats.data.length === 0) return null;
  return (
    <Card>
      <Card.Title title={t('society.yourFlat')} />
      <Card.Content>
        {flats.data.map((f) => (
          <List.Item
            key={f.id}
            title={`${f.label} · ${occupantLabel(t, f.type)}`}
            description={t('accounts.statement')}
            onPress={() => router.push(`/society/flat/${f.id}` as Href)}
            accessibilityRole="button"
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        ))}
      </Card.Content>
    </Card>
  );
}
