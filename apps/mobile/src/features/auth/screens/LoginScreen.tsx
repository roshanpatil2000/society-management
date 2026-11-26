import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput } from 'react-native-paper';
import { z } from 'zod';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { sendCode } from '../api';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const society = useSessionStore((s) => s.discovered);
  const forgetSociety = useSessionStore((s) => s.forgetSociety);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const methods = society?.login_methods ?? ['email_otp'];

  async function submit() {
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(t('login.invalidEmail'));
      return;
    }
    setBusy(true);
    try {
      await sendCode(parsed.data, undefined);
      router.push({ pathname: '/verify', params: { email: parsed.data } });
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="headlineMedium">
        {t('login.title', { society: society?.name ?? t('app.name') })}
      </Text>
      {methods.includes('email_otp') ? (
        <>
          <TextInput
            mode="outlined"
            label={t('login.emailLabel')}
            accessibilityLabel={t('login.emailLabel')}
            placeholder={t('login.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onSubmitEditing={submit}
          />
          <ErrorText message={error} />
          <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>
            {t('login.sendCode')}
          </Button>
        </>
      ) : null}
      {methods.includes('google') ? (
        <Button mode="outlined" icon="google" onPress={() => router.push('/google')}>
          {t('login.google')}
        </Button>
      ) : null}
      <Button
        onPress={() => {
          forgetSociety();
          router.replace('/discover');
        }}
      >
        {t('login.changeSociety')}
      </Button>
    </Screen>
  );
}
