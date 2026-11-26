import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';

import { acceptConsent } from '../api';
import { CURRENT_CONSENT_VERSION } from '../gate';

export function ConsentScreen({ societyName }: { societyName: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      await acceptConsent(CURRENT_CONSENT_VERSION);
      await queryClient.invalidateQueries({ queryKey: ['access'] });
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="headlineSmall">{t('consent.title')}</Text>
      <Text variant="bodyMedium">{t('consent.body', { society: societyName })}</Text>
      <ErrorText message={error} />
      <Button mode="contained" onPress={accept} loading={busy} disabled={busy}>
        {t('consent.accept')}
      </Button>
    </Screen>
  );
}
