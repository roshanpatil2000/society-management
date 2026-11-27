import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, HelperText, Text } from 'react-native-paper';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { type ImportReport, importFlats, pickSpreadsheet } from './api';

export function ImportFlatsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [check, setCheck] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose() {
    setError(null);
    setCheck(null);
    setDone(null);
    try {
      const picked = await pickSpreadsheet();
      if (!picked) return;
      setFile(picked);
      setBusy(true);
      setCheck(await importFlats(societyId, picked.base64, true));
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const report = await importFlats(societyId, file.base64, false);
      if (report.ok) {
        setDone(report);
        setCheck(null);
        await queryClient.invalidateQueries({ queryKey: ['flats', societyId] });
        await queryClient.invalidateQueries({ queryKey: ['invites', societyId] });
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
      <Text variant="headlineMedium">{t('society.import')}</Text>
      <HelperText type="info">{t('society.importHint')}</HelperText>
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
            {t('society.ready', {
              flats: check.flats_created,
              wings: check.wings_created,
              invites: check.invites_created,
            })}
          </Text>
          <Button mode="contained" onPress={runImport} loading={busy} disabled={busy}>
            {t('society.importButton')}
          </Button>
        </>
      ) : null}
      {check && !check.ok ? (
        <Card>
          <Card.Content>
            {check.errors.map((e, i) => (
              <Text key={i} variant="bodyMedium">
                {e.row > 0
                  ? t('society.rowProblem', { row: e.row, field: e.field, message: e.message })
                  : t('society.fileProblem', { message: e.message })}
              </Text>
            ))}
          </Card.Content>
        </Card>
      ) : null}
      {done ? (
        <Text variant="titleMedium">{t('society.imported', { count: done.flats_created })}</Text>
      ) : null}
    </Screen>
  );
}
