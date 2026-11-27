import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, Text } from 'react-native-paper';

import { useSessionStore } from '@/stores/session';

import { myFlats } from './api';
import { occupantLabel } from './labels';

/** The signed-in person's flats in the active society. Hidden for people with none. */
export function YourFlatCard() {
  const { t } = useTranslation();
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
          <Text key={f.id} variant="titleMedium">{`${f.label} · ${occupantLabel(t, f.type)}`}</Text>
        ))}
      </Card.Content>
    </Card>
  );
}
