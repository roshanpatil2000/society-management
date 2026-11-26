import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput } from 'react-native-paper';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';

import { sendCode, verifyCode } from '../api';

export function VerifyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      // On success the auth listener updates the session and the gate moves on.
      await verifyCode(email, code.trim());
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await sendCode(email, undefined);
    } catch (e) {
      setError(t(errorKey(e)));
    }
  }

  return (
    <Screen>
      <Text variant="headlineMedium">{t('login.codeTitle')}</Text>
      <Text variant="bodyMedium">{t('login.codeSent', { email })}</Text>
      <TextInput
        mode="outlined"
        label={t('login.codeLabel')}
        accessibilityLabel={t('login.codeLabel')}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        onSubmitEditing={submit}
      />
      <ErrorText message={error} />
      <Button mode="contained" onPress={submit} loading={busy} disabled={busy || code.length !== 6}>
        {t('login.verify')}
      </Button>
      <Button onPress={resend}>{t('login.resend')}</Button>
      <Button onPress={() => router.back()}>{t('login.differentEmail')}</Button>
    </Screen>
  );
}
