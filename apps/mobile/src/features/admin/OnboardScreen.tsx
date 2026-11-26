import { useQueryClient } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  Divider,
  HelperText,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';

import { onboardSocietyRequestSchema, ROLE_PRESETS, suggestSocietySlug } from '@society/shared';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';

import { onboardSociety } from './api';

interface CommitteeRow {
  email: string;
  full_name: string;
  roles: string[];
}

const COMMITTEE_ROLES = ROLE_PRESETS.map((p) => p.name).filter(
  (n) => !['Member', 'Tenant', 'Staff'].includes(n),
);

export function OnboardScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [registrationNo, setRegistrationNo] = useState('');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<'trial' | 'active'>('trial');
  const [committee, setCommittee] = useState<CommitteeRow[]>([
    { email: '', full_name: '', roles: ['Chairman'] },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateRow = (i: number, change: Partial<CommitteeRow>) =>
    setCommittee((rows) => rows.map((row, j) => (j === i ? { ...row, ...change } : row)));

  async function submit() {
    setError(null);
    const parsed = onboardSocietyRequestSchema.safeParse({
      action: 'onboard',
      status,
      society: {
        name,
        slug,
        ...(registrationNo.trim() ? { registration_no: registrationNo } : {}),
        ...(address.trim() ? { address } : {}),
      },
      committee,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('errors.generic'));
      return;
    }
    setBusy(true);
    try {
      const result = await onboardSociety(parsed.data);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'societies'] });
      router.replace(`/admin/society/${result.society_id}` as Href);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="headlineMedium">{t('admin.onboard')}</Text>
      <TextInput
        mode="outlined"
        label={t('admin.name')}
        accessibilityLabel={t('admin.name')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (!slugEdited) setSlug(v.trim() ? suggestSocietySlug(v) : '');
        }}
      />
      <TextInput
        mode="outlined"
        label={t('admin.code')}
        accessibilityLabel={t('admin.code')}
        value={slug}
        autoCapitalize="none"
        onChangeText={(v) => {
          setSlug(v);
          setSlugEdited(true);
        }}
      />
      <HelperText type="info">{t('admin.codeHint')}</HelperText>
      <TextInput
        mode="outlined"
        label={t('admin.registrationNo')}
        accessibilityLabel={t('admin.registrationNo')}
        value={registrationNo}
        onChangeText={setRegistrationNo}
      />
      <TextInput
        mode="outlined"
        label={t('admin.address')}
        accessibilityLabel={t('admin.address')}
        value={address}
        onChangeText={setAddress}
      />
      <SegmentedButtons
        value={status}
        onValueChange={(v) => setStatus(v === 'active' ? 'active' : 'trial')}
        buttons={[
          { value: 'trial', label: t('admin.trial') },
          { value: 'active', label: t('admin.active') },
        ]}
      />
      <Divider />
      <Text variant="titleMedium">{t('admin.committee')}</Text>
      {committee.map((row, i) => (
        <View key={i} style={styles.row}>
          <TextInput
            mode="outlined"
            label={t('admin.memberEmail')}
            accessibilityLabel={t('admin.memberEmail')}
            value={row.email}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={(v) => updateRow(i, { email: v })}
          />
          <TextInput
            mode="outlined"
            label={t('admin.memberName')}
            accessibilityLabel={t('admin.memberName')}
            value={row.full_name}
            onChangeText={(v) => updateRow(i, { full_name: v })}
          />
          <View style={styles.chips}>
            {COMMITTEE_ROLES.map((role) => (
              <Chip
                key={role}
                selected={row.roles.includes(role)}
                showSelectedCheck
                onPress={() =>
                  updateRow(i, {
                    roles: row.roles.includes(role)
                      ? row.roles.filter((r) => r !== role)
                      : [...row.roles, role],
                  })
                }
              >
                {role}
              </Chip>
            ))}
          </View>
        </View>
      ))}
      <Button
        icon="account-plus"
        onPress={() =>
          setCommittee((rows) => [
            ...rows,
            { email: '', full_name: '', roles: ['Committee member'] },
          ])
        }
      >
        {t('admin.addMember')}
      </Button>
      <ErrorText message={error} />
      <Button mode="contained" onPress={submit} loading={busy} disabled={busy}>
        {t('admin.submit')}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
