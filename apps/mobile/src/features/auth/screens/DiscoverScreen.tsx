import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text, TextInput } from 'react-native-paper';

import { normalizeSocietyCode } from '@society/shared';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';
import { type DiscoveredSociety, useSessionStore } from '@/stores/session';

import { discoverSociety } from '../api';

export function DiscoverScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const chooseSociety = useSessionStore((s) => s.chooseSociety);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<DiscoveredSociety | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    setError(null);
    const slug = normalizeSocietyCode(code);
    if (!slug) {
      setError(t('discovery.invalid'));
      return;
    }
    setBusy(true);
    try {
      const society = await discoverSociety(slug);
      if (society) setFound(society);
      else setError(t('discovery.notFound'));
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  if (found) {
    return (
      <Screen>
        <Text variant="titleMedium">{t('discovery.confirmTitle')}</Text>
        <Card>
          <Card.Content>
            <Text variant="headlineSmall">{found.name}</Text>
            {found.city ? <Text variant="bodyMedium">{found.city}</Text> : null}
          </Card.Content>
        </Card>
        <Button
          mode="contained"
          onPress={() => {
            chooseSociety(found);
            router.replace('/login');
          }}
        >
          {t('discovery.confirm')}
        </Button>
        <Button onPress={() => setFound(null)}>{t('discovery.change')}</Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="headlineMedium">{t('discovery.title')}</Text>
      <Text variant="bodyMedium">{t('discovery.subtitle')}</Text>
      <TextInput
        mode="outlined"
        label={t('discovery.codeLabel')}
        accessibilityLabel={t('discovery.codeLabel')}
        placeholder={t('discovery.codePlaceholder')}
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={find}
        returnKeyType="search"
      />
      <ErrorText message={error} />
      <Button mode="contained" onPress={find} loading={busy} disabled={busy}>
        {t('discovery.find')}
      </Button>
      <Button icon="qrcode-scan" onPress={() => router.push('/scan')}>
        {t('discovery.scan')}
      </Button>
      <Button compact onPress={() => router.push('/login')}>
        {t('discovery.adminSignIn')}
      </Button>
    </Screen>
  );
}
