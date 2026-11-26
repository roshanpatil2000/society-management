import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { ActivityIndicator, Button, Divider, List, Text, TextInput } from 'react-native-paper';

import { normalizeSocietyCode, societyLink } from '@society/shared';

import { ErrorText } from '@/components/ErrorText';
import { Screen } from '@/components/Screen';
import { errorKey } from '@/lib/errors';

import { type AdminSociety, getSociety, setQuotas, setSlug, setStatus } from './api';
import { STATUS_KEYS } from './status';

export function SocietyDetailScreen({ societyId, webUrl }: { societyId: string; webUrl: string }) {
  const { t } = useTranslation();
  const society = useQuery({
    queryKey: ['admin', 'society', societyId],
    queryFn: () => getSociety(societyId),
  });
  const data = society.data;

  if (!data) {
    return (
      <Screen>
        {society.isPending ? (
          <ActivityIndicator />
        ) : (
          <ErrorText message={t(errorKey(society.error))} />
        )}
      </Screen>
    );
  }
  // Re-key on the saved values so the form restarts from the server after a change.
  return (
    <SocietyForm
      key={`${data.slug}:${JSON.stringify(data.quotas)}`}
      society={data}
      webUrl={webUrl}
    />
  );
}

function SocietyForm({ society: data, webUrl }: { society: AdminSociety; webUrl: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(data.slug);
  const [quotas, setQuotaDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(data.quotas).map(([k, v]) => [k, String(v)])),
  );
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (e) {
      setError(t(errorKey(e)));
    }
  }

  const link = societyLink(data.slug, webUrl);
  const suspended = data.status === 'suspended';

  return (
    <Screen>
      <Text variant="headlineMedium">{data.name}</Text>
      <Text variant="bodyMedium">
        {t('admin.status')}: {t(STATUS_KEYS[data.status] ?? 'admin.active')} · {t('admin.plan')}:{' '}
        {data.plan}
      </Text>
      <Button
        mode={suspended ? 'contained' : 'outlined'}
        onPress={() => void run(() => setStatus(data.id, suspended ? 'active' : 'suspended'))}
      >
        {suspended ? t('admin.reactivate') : t('admin.suspend')}
      </Button>
      <Divider />
      <Text variant="titleMedium">{t('admin.qr')}</Text>
      <View style={styles.qr}>
        <QRCode value={link} size={180} />
      </View>
      <List.Item title={link} description={t('admin.link')} />
      <TextInput
        mode="outlined"
        label={t('admin.code')}
        accessibilityLabel={t('admin.code')}
        value={code}
        autoCapitalize="none"
        onChangeText={setCode}
      />
      <Button
        onPress={() => {
          const slug = normalizeSocietyCode(code);
          if (!slug) {
            setError(t('discovery.invalid'));
            return;
          }
          void run(() => setSlug(data.id, slug));
        }}
      >
        {t('app.save')}
      </Button>
      <Divider />
      <Text variant="titleMedium">{t('admin.quotas')}</Text>
      {Object.keys(quotas).map((key) => (
        <TextInput
          key={key}
          mode="outlined"
          label={key}
          accessibilityLabel={key}
          keyboardType="number-pad"
          value={quotas[key]}
          onChangeText={(v) => setQuotaDraft((q) => ({ ...q, [key]: v.replace(/\D/g, '') }))}
        />
      ))}
      <Button
        onPress={() =>
          void run(() =>
            setQuotas(
              data.id,
              Object.fromEntries(Object.entries(quotas).map(([k, v]) => [k, Number(v || 0)])),
            ),
          )
        }
      >
        {t('admin.saveQuotas')}
      </Button>
      <ErrorText message={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  qr: { alignItems: 'center', padding: 16, backgroundColor: 'white' },
});
