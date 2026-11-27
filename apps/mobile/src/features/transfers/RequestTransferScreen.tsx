import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Checkbox, Chip, Text, TextInput } from 'react-native-paper';
import { z } from 'zod';

import { parseRupees } from '@society/shared';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { isIsoDate, todayIst } from '@/features/accounts/dates';
import { listFlats } from '@/features/society/api';
import { occupantLabel } from '@/features/society/labels';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { type BuyerType, requestTransfer } from './api';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const BUYER_TYPES: BuyerType[] = ['owner', 'joint_owner'];

export function RequestTransferScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { flatId = '' } = useLocalSearchParams<{ flatId: string }>();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const flats = useQuery({ queryKey: ['flats', societyId], queryFn: () => listFlats(societyId) });
  const flat = flats.data?.find((f) => f.id === flatId);
  const owners = (flat?.occupants ?? []).filter((o) => o.type !== 'tenant');

  const [unticked, setUnticked] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [buyerType, setBuyerType] = useState<BuyerType>('owner');
  const [date, setDate] = useState(() => todayIst());
  const [cert, setCert] = useState('');
  const [fee, setFee] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!flat)
    return (
      <Screen>
        {flats.isPending ? <ActivityIndicator /> : <Text>{t('errors.generic')}</Text>}
      </Screen>
    );

  async function submit() {
    setError(null);
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) return setError(t('login.invalidEmail'));
    if (!isIsoDate(date.trim())) return setError(t('accounts.invalidDate'));
    const paise = parseRupees(fee);
    if (paise === undefined) return setError(t('transfers.invalidFee'));
    setBusy(true);
    try {
      await requestTransfer({
        societyId,
        flatId: flat!.id,
        fromOccupantIds: owners.filter((o) => !unticked.includes(o.id)).map((o) => o.id),
        buyers: [{ email: parsedEmail.data, full_name: name.trim() || null, type: buyerType }],
        transferDate: date.trim(),
        shareCertNo: cert.trim() || null,
        transferFee: paise ?? 0,
        note: note.trim() || null,
      });
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ['transfers', societyId] });
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  const label = `${flat.wing}-${flat.number}`;
  if (done) {
    return (
      <Screen>
        <Text variant="headlineSmall">{t('transfers.title', { flat: label })}</Text>
        <Text variant="bodyLarge">{t('transfers.requested')}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="headlineMedium">{t('transfers.title', { flat: label })}</Text>
      <Text variant="titleSmall">{t('transfers.sellers')}</Text>
      {owners.length === 0 ? <Text>{t('transfers.noSellers')}</Text> : null}
      {owners.map((o) => (
        <Checkbox.Item
          key={o.id}
          label={`${o.name} (${occupantLabel(t, o.type)})`}
          status={unticked.includes(o.id) ? 'unchecked' : 'checked'}
          onPress={() =>
            setUnticked(
              unticked.includes(o.id) ? unticked.filter((x) => x !== o.id) : [...unticked, o.id],
            )
          }
        />
      ))}
      <Text variant="titleSmall">{t('transfers.buyer')}</Text>
      <TextInput
        mode="outlined"
        label={t('transfers.buyerEmail')}
        accessibilityLabel={t('transfers.buyerEmail')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        mode="outlined"
        label={t('transfers.buyerName')}
        accessibilityLabel={t('transfers.buyerName')}
        value={name}
        onChangeText={setName}
      />
      <View style={styles.chips}>
        {BUYER_TYPES.map((type) => (
          <Chip
            key={type}
            selected={buyerType === type}
            showSelectedCheck
            onPress={() => setBuyerType(type)}
          >
            {occupantLabel(t, type)}
          </Chip>
        ))}
      </View>
      <TextInput
        mode="outlined"
        label={t('transfers.date')}
        accessibilityLabel={t('transfers.date')}
        value={date}
        onChangeText={setDate}
        keyboardType="numbers-and-punctuation"
      />
      <TextInput
        mode="outlined"
        label={t('transfers.cert')}
        accessibilityLabel={t('transfers.cert')}
        value={cert}
        onChangeText={setCert}
      />
      <TextInput
        mode="outlined"
        label={t('transfers.fee')}
        accessibilityLabel={t('transfers.fee')}
        value={fee}
        onChangeText={setFee}
        keyboardType="decimal-pad"
      />
      <TextInput
        mode="outlined"
        label={t('transfers.note')}
        accessibilityLabel={t('transfers.note')}
        value={note}
        onChangeText={setNote}
        multiline
      />
      <ErrorText message={error} />
      <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>
        {t('transfers.submit')}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
