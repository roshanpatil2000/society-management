import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Text } from 'react-native-paper';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { listInvites, resendInvite, revokeInvite } from './api';

export function InvitesScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const invites = useQuery({
    queryKey: ['invites', societyId],
    queryFn: () => listInvites(societyId),
  });
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['invites', societyId] });
    } catch (e) {
      setError(t(errorKey(e)));
    }
  }

  return (
    <Screen>
      <Text variant="headlineMedium">{t('society.invites')}</Text>
      {invites.isPending ? <ActivityIndicator /> : null}
      <ErrorText message={error ?? (invites.error ? t(errorKey(invites.error)) : null)} />
      {invites.data && invites.data.length === 0 ? <Text>{t('society.noInvites')}</Text> : null}
      {invites.data?.map((i) => (
        <Card key={i.id}>
          <Card.Content>
            <Text variant="titleMedium">{i.email}</Text>
            <Text variant="bodySmall">
              {[
                i.full_name,
                i.flat,
                t('society.expires', { date: new Date(i.expires_at).toLocaleDateString() }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Card.Content>
          <View style={styles.actions}>
            <Button onPress={() => void run(() => resendInvite(i.id))}>
              {t('society.resend')}
            </Button>
            <Button onPress={() => void run(() => revokeInvite(i.id))}>
              {t('society.revoke')}
            </Button>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ actions: { flexDirection: 'row', justifyContent: 'flex-end' } });
