import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Button, Text } from 'react-native-paper';

import { normalizeSocietyCode } from '@society/shared';

import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { discoverSociety } from '../api';

/** Opened from a society link or QR: https://<app>/s/<code> or societyapp://s/<code>. */
export function SocietyLinkScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const chooseSociety = useSessionStore((s) => s.chooseSociety);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const slug = normalizeSocietyCode(code);
  const error = slug ? lookupError : t('discovery.notFound');

  useEffect(() => {
    if (!slug) return;
    let active = true;
    discoverSociety(slug)
      .then((society) => {
        if (!active) return;
        if (!society) {
          setLookupError(t('discovery.notFound'));
          return;
        }
        chooseSociety(society);
        router.replace('/login');
      })
      .catch((e: unknown) => active && setLookupError(t(errorKey(e))));
    return () => {
      active = false;
    };
  }, [slug, chooseSociety, router, t]);

  return (
    <Screen>
      {error ? (
        <>
          <Text variant="bodyLarge">{error}</Text>
          <Button mode="contained" onPress={() => router.replace('/discover')}>
            {t('discovery.find')}
          </Button>
        </>
      ) : (
        <ActivityIndicator size="large" />
      )}
    </Screen>
  );
}
