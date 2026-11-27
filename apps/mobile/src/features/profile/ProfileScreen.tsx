import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Divider, List, SegmentedButtons, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { type Access, signOut } from '@/features/auth/api';
import { LANGUAGES } from '@/i18n';
import { saveLanguage } from '@/i18n/language';
import { useSessionStore } from '@/stores/session';

export function ProfileScreen({ access }: { access: Access }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  // Held in state so the selector re-renders reliably (the React Compiler memoises reads of i18n).
  const [language, setLanguage] = useState(i18n.language);
  const activeSocietyId = useSessionStore((s) => s.activeSocietyId);
  const forgetSociety = useSessionStore((s) => s.forgetSociety);
  const society = access.memberships.find((m) => m.society_id === activeSocietyId);

  return (
    <Screen>
      <Text variant="headlineMedium">{t('profile.title')}</Text>
      <List.Item title={access.fullName ?? '—'} description={t('profile.name')} />
      <List.Item title={access.email ?? '—'} description={t('profile.email')} />
      {society ? (
        <List.Item
          title={society.role_names.join(', ')}
          description={`${t('profile.roles')} · ${society.society_name}`}
        />
      ) : null}
      <Divider />
      <Text variant="titleSmall">{t('profile.language')}</Text>
      <SegmentedButtons
        value={language}
        onValueChange={(code) => {
          setLanguage(code);
          void i18n.changeLanguage(code);
          void saveLanguage(code);
        }}
        buttons={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
      />
      <Divider />
      {access.memberships.length > 1 ? (
        <Button icon="swap-horizontal" onPress={forgetSociety}>
          {t('profile.switchSociety')}
        </Button>
      ) : null}
      {access.isPlatformAdmin ? (
        <Button icon="shield-account" onPress={() => router.push('/admin')}>
          {t('profile.admin')}
        </Button>
      ) : null}
      <Button mode="outlined" icon="logout" onPress={() => void signOut()}>
        {t('profile.signOut')}
      </Button>
    </Screen>
  );
}
