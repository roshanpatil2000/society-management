import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput } from 'react-native-paper';
import { z } from 'zod';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { env } from '@/lib/env';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { sendCode, signInWithGoogle } from '../api';
import { Captcha } from '../Captcha';

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
  const siteKey = env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const onToken = useCallback((token: string) => setCaptchaToken(token), []);

  async function google() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(t(errorKey(e)));
    }
  }

  async function submit() {
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(t('login.invalidEmail'));
      return;
    }
    if (siteKey && !captchaToken) {
      setError(t('login.captchaRequired'));
      return;
    }
    setBusy(true);
    try {
      await sendCode(parsed.data, captchaToken);
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
          {siteKey ? <Captcha siteKey={siteKey} onToken={onToken} /> : null}
          <ErrorText message={error} />
          <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>
            {t('login.sendCode')}
          </Button>
        </>
      ) : null}
      {methods.includes('google') ? (
        <Button mode="outlined" icon="google" onPress={() => void google()}>
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
