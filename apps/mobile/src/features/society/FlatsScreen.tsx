import { useQuery } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, List, Text } from 'react-native-paper';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { listFlats } from './api';
import { occupantLabel } from './labels';

export function FlatsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const flats = useQuery({ queryKey: ['flats', societyId], queryFn: () => listFlats(societyId) });
  const wings = [...new Set((flats.data ?? []).map((f) => f.wing))];

  return (
    <Screen>
      <Text variant="headlineMedium">{t('society.flats')}</Text>
      {flats.isPending ? <ActivityIndicator /> : null}
      <ErrorText message={flats.error ? t(errorKey(flats.error)) : null} />
      {flats.data && flats.data.length === 0 ? <Text>{t('society.noFlats')}</Text> : null}
      {wings.map((wing) => (
        <List.Section key={wing} title={t('society.wing', { name: wing })}>
          {(flats.data ?? [])
            .filter((f) => f.wing === wing)
            .map((f) => (
              <List.Item
                key={f.id}
                title={`${f.wing}-${f.number}`}
                description={
                  f.occupants.length > 0
                    ? f.occupants.map((o) => `${o.name} (${occupantLabel(t, o.type)})`).join(', ')
                    : t('society.vacant')
                }
                onPress={() => router.push(`/society/flat/${f.id}` as Href)}
                accessibilityRole="button"
                right={(props) => <List.Icon {...props} icon="chevron-right" />}
              />
            ))}
        </List.Section>
      ))}
    </Screen>
  );
}
