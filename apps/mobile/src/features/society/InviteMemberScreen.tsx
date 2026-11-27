import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { Button, Chip, Text, TextInput } from 'react-native-paper';
import { z } from 'zod';

import { societyLink } from '@society/shared';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { env } from '@/lib/env';
import { errorKey } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';

import { createInvite, listFlats, listRoles, type OccupantType } from './api';
import { occupantLabel } from './labels';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const OCCUPANT_TYPES: OccupantType[] = ['owner', 'joint_owner', 'tenant'];

export function InviteMemberScreen({ webUrl = env.EXPO_PUBLIC_WEB_URL }: { webUrl?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ flatId?: string; occupantType?: string }>();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const society = useSessionStore((s) => s.discovered);
  const flatId = params.flatId ?? null;
  const occupantType =
    OCCUPANT_TYPES.find((o) => o === params.occupantType) ?? (flatId ? 'owner' : null);

  const roles = useQuery({ queryKey: ['roles', societyId], queryFn: () => listRoles(societyId) });
  const flats = useQuery({
    queryKey: ['flats', societyId],
    queryFn: () => listFlats(societyId),
    enabled: Boolean(flatId),
  });
  const flat = flats.data?.find((f) => f.id === flatId);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultRole = roles.data?.find(
    (r) => r.name === (occupantType === 'tenant' ? 'Tenant' : 'Member'),
  );
  const roleIds = picked ?? (defaultRole ? [defaultRole.id] : []);

  async function submit() {
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(t('login.invalidEmail'));
      return;
    }
    setBusy(true);
    try {
      await createInvite({
        societyId,
        email: parsed.data,
        fullName: fullName.trim() || null,
        roleIds,
        flatId,
        occupantType: flatId ? occupantType : null,
      });
      setSentTo(parsed.data);
      await queryClient.invalidateQueries({ queryKey: ['invites', societyId] });
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  const link = society ? societyLink(society.slug, webUrl) : '';

  if (sentTo) {
    return (
      <Screen>
        <Text variant="headlineSmall">{t('society.invited', { email: sentTo })}</Text>
        <Button
          mode="contained"
          icon="share-variant"
          onPress={() =>
            void Share.share({
              message: t('society.shareMessage', {
                society: society?.name ?? '',
                link,
                code: society?.slug ?? '',
              }),
            })
          }
        >
          {t('society.shareInvite')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="headlineMedium">{t('society.invite')}</Text>
      {flat && occupantType ? (
        <Text variant="titleMedium">
          {t('society.flatLabel', {
            flat: `${flat.wing}-${flat.number}`,
            type: occupantLabel(t, occupantType),
          })}
        </Text>
      ) : null}
      <TextInput
        mode="outlined"
        label={t('admin.memberEmail')}
        accessibilityLabel={t('admin.memberEmail')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        mode="outlined"
        label={t('admin.memberName')}
        accessibilityLabel={t('admin.memberName')}
        value={fullName}
        onChangeText={setFullName}
      />
      <Text variant="titleSmall">{t('admin.memberRoles')}</Text>
      <View style={styles.chips}>
        {(roles.data ?? []).map((role) => (
          <Chip
            key={role.id}
            selected={roleIds.includes(role.id)}
            showSelectedCheck
            onPress={() =>
              setPicked(
                roleIds.includes(role.id)
                  ? roleIds.filter((r) => r !== role.id)
                  : [...roleIds, role.id],
              )
            }
          >
            {role.name}
          </Chip>
        ))}
      </View>
      <ErrorText message={error} />
      <Button
        mode="contained"
        onPress={submit}
        loading={busy}
        disabled={busy || roleIds.length === 0}
      >
        {t('society.sendInvite')}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
