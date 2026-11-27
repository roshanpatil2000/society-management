import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, HelperText, Text, TextInput } from 'react-native-paper';

import { formatPaise } from '@society/shared';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { formatDate } from '@/features/accounts/dates';
import { usePermission } from '@/features/permissions/Can';
import { occupantLabel } from '@/features/society/labels';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { decideTransfer, listTransfers, type PendingTransfer } from './api';

function TransferCard({
  transfer,
  onDone,
}: {
  transfer: PendingTransfer;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const canDecide = usePermission('members.transfer');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'approve' | 'reject') {
    setError(null);
    if (decision === 'reject' && !reason.trim()) {
      setRejecting(true);
      return;
    }
    setBusy(true);
    try {
      const result = await decideTransfer(
        transfer.id,
        decision,
        decision === 'reject' ? reason.trim() : null,
      );
      onDone(
        decision === 'approve' ? t('transfers.approved', { ...result }) : t('transfers.rejected'),
      );
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  const buyers = transfer.buyers
    .map((b) => `${b.full_name ?? b.email} (${occupantLabel(t, b.type)})`)
    .join(', ');
  return (
    <Card>
      <Card.Content>
        <Text variant="titleMedium">{`${transfer.flat} · ${formatDate(transfer.transfer_date)}`}</Text>
        <Text variant="bodyMedium">{`${transfer.sellers.join(', ') || t('transfers.noSellers')} → ${buyers}`}</Text>
        <Text variant="bodySmall">
          {t('transfers.details', {
            cert: transfer.share_cert_no ?? '—',
            fee: formatPaise(transfer.transfer_fee),
          })}
        </Text>
        {transfer.mine ? <HelperText type="info">{t('transfers.mine')}</HelperText> : null}
        {rejecting ? (
          <>
            <HelperText type="error">{t('transfers.reasonNeeded')}</HelperText>
            <TextInput
              mode="outlined"
              label={t('transfers.reason')}
              accessibilityLabel={t('transfers.reason')}
              value={reason}
              onChangeText={setReason}
            />
          </>
        ) : null}
        <ErrorText message={error} />
      </Card.Content>
      {canDecide && !transfer.mine ? (
        <View style={styles.actions}>
          <Button onPress={() => void decide('reject')} disabled={busy}>
            {t('transfers.reject')}
          </Button>
          <Button
            mode="contained"
            onPress={() => void decide('approve')}
            loading={busy}
            disabled={busy}
          >
            {t('transfers.approve')}
          </Button>
        </View>
      ) : null}
    </Card>
  );
}

export function TransfersScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const transfers = useQuery({
    queryKey: ['transfers', societyId],
    queryFn: () => listTransfers(societyId),
  });
  const [message, setMessage] = useState<string | null>(null);

  async function done(text: string) {
    setMessage(text);
    await queryClient.invalidateQueries({ queryKey: ['transfers', societyId] });
    await queryClient.invalidateQueries({ queryKey: ['flats', societyId] });
  }

  return (
    <Screen>
      <Text variant="headlineMedium">{t('transfers.list')}</Text>
      {message ? <Text variant="titleMedium">{message}</Text> : null}
      {transfers.isPending ? <ActivityIndicator /> : null}
      <ErrorText message={transfers.error ? t(errorKey(transfers.error)) : null} />
      {transfers.data && transfers.data.length === 0 ? <Text>{t('transfers.none')}</Text> : null}
      {transfers.data?.map((tr) => (
        <TransferCard key={tr.id} transfer={tr} onDone={(m) => void done(m)} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 8 },
});
