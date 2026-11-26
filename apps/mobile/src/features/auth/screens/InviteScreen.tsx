import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';

import { acceptInvite, type PendingInvite, signOut } from '../api';

export function InviteScreen({
  invite,
}: {
  invite: Pick<PendingInvite, 'token' | 'society_name' | 'role_names'>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      await acceptInvite(invite.token);
      await queryClient.invalidateQueries({ queryKey: ['access'] });
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="headlineSmall">
        {t('membership.inviteTitle', { society: invite.society_name })}
      </Text>
      <Text variant="bodyMedium">
        {t('membership.inviteBody', { roles: invite.role_names.join(', ') })}
      </Text>
      <ErrorText message={error} />
      <Button mode="contained" onPress={accept} loading={busy} disabled={busy}>
        {t('membership.accept')}
      </Button>
      <Button onPress={() => void signOut()}>{t('login.differentEmail')}</Button>
    </Screen>
  );
}
