import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Button, List, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { FlatStatement } from '@/features/accounts/FlatStatement';
import { Can } from '@/features/permissions/Can';
import { useSessionStore } from '@/stores/session';

import { listFlats } from './api';
import { occupantLabel } from './labels';

export function FlatDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const societyId = useSessionStore((s) => s.activeSocietyId) ?? '';
  const flats = useQuery({ queryKey: ['flats', societyId], queryFn: () => listFlats(societyId) });
  const flat = flats.data?.find((f) => f.id === id);

  if (!flat)
    return (
      <Screen>
        {flats.isPending ? <ActivityIndicator /> : <Text>{t('errors.generic')}</Text>}
      </Screen>
    );

  const invite = (occupantType: 'owner' | 'tenant') =>
    router.push({ pathname: '/society/invite', params: { flatId: flat.id, occupantType } });

  return (
    <Screen>
      <Text variant="headlineMedium">{`${flat.wing}-${flat.number}`}</Text>
      <Text variant="bodyMedium">
        {[
          flat.flat_type,
          flat.area_sqft ? `${flat.area_sqft} sq ft` : null,
          flat.floor !== null ? t('society.floor', { floor: flat.floor }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {flat.occupants.length === 0 ? <Text>{t('society.vacant')}</Text> : null}
      {flat.occupants.map((o) => (
        <List.Item
          key={o.id}
          title={o.name}
          description={occupantLabel(t, o.type)}
          left={(p) => <List.Icon {...p} icon="account" />}
        />
      ))}
      <Can permission="members.invite">
        <Button mode="contained" icon="account-plus" onPress={() => invite('owner')}>
          {t('society.inviteOwner')}
        </Button>
        <Button icon="account-plus-outline" onPress={() => invite('tenant')}>
          {t('society.inviteTenant')}
        </Button>
      </Can>
      <Can permission="members.manage">
        <Button
          icon="swap-horizontal"
          onPress={() =>
            router.push({ pathname: '/society/transfer', params: { flatId: flat.id } })
          }
        >
          {t('transfers.start')}
        </Button>
      </Can>
      <FlatStatement flatId={flat.id} />
    </Screen>
  );
}
