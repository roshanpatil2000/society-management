import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, HelperText, Text, TextInput } from 'react-native-paper';

import { formatPaise } from '@society/shared';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { pickSpreadsheet } from '@/features/society/api';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { importOpeningBalances, type OpeningProblem, type OpeningReport } from './api';
import { defaultOpeningDate, isIsoDate } from './dates';

export function OpeningBalancesScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const [asOf, setAsOf] = useState(() => defaultOpeningDate());
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [check, setCheck] = useState<OpeningReport | null>(null);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problemText = (p: OpeningProblem) =>
    p.sheet === 'file'
      ? t('society.fileProblem', { message: p.message })
      : t('accounts.rowProblem', {
          sheet: t(`accounts.sheet.${p.sheet}`),
          row: p.row,
          field: p.field,
          message: p.message,
        });

  async function choose() {
    setError(null);
    setCheck(null);
    setPosted(false);
    if (!isIsoDate(asOf.trim())) {
      setError(t('accounts.invalidDate'));
      return;
    }
    try {
      const picked = await pickSpreadsheet();
      if (!picked) return;
      setFile(picked);
      setBusy(true);
      setCheck(await importOpeningBalances(societyId, asOf.trim(), picked.base64, true));
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const report = await importOpeningBalances(societyId, asOf.trim(), file.base64, false);
      if (report.ok) {
        setPosted(true);
        setCheck(null);
        await queryClient.invalidateQueries({ queryKey: ['flat-statement'] });
      } else {
        setCheck(report);
      }
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="headlineMedium">{t('accounts.opening')}</Text>
      <HelperText type="info">{t('accounts.openingHint')}</HelperText>
      <TextInput
        mode="outlined"
        label={t('accounts.asOf')}
        accessibilityLabel={t('accounts.asOf')}
        value={asOf}
        onChangeText={setAsOf}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
      />
      <Button
        mode="outlined"
        icon="file-excel"
        onPress={choose}
        loading={busy && !check}
        disabled={busy}
      >
        {t('society.chooseFile')}
      </Button>
      {file ? <Text variant="bodySmall">{file.name}</Text> : null}
      <ErrorText message={error} />
      {check?.ok ? (
        <>
          <Text variant="bodyLarge">
            {t('accounts.ready', {
              flats: check.flats,
              debit: formatPaise(check.total_debit),
              credit: formatPaise(check.total_credit),
            })}
          </Text>
          <Button mode="contained" onPress={post} loading={busy} disabled={busy}>
            {t('accounts.post')}
          </Button>
        </>
      ) : null}
      {check && !check.ok ? (
        <Card>
          <Card.Content>
            {check.errors.map((p, i) => (
              <Text key={i} variant="bodyMedium">
                {problemText(p)}
              </Text>
            ))}
          </Card.Content>
        </Card>
      ) : null}
      {posted ? <Text variant="titleMedium">{t('accounts.posted')}</Text> : null}
    </Screen>
  );
}
