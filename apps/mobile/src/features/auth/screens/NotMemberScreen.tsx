import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { useSessionStore } from '@/stores/session';

import { signOut } from '../api';

export function NotMemberScreen({ email }: { email: string }) {
  const { t } = useTranslation();
  const society = useSessionStore((s) => s.discovered);
  const forgetSociety = useSessionStore((s) => s.forgetSociety);
  const name = society?.name ?? '';

  return (
    <Screen>
      <Text variant="headlineSmall">{t('membership.notMemberTitle', { society: name })}</Text>
      <Text variant="bodyMedium">{t('membership.notMemberBody', { society: name, email })}</Text>
      <Button mode="contained" onPress={() => void signOut()}>
        {t('login.differentEmail')}
      </Button>
      <Button
        onPress={() => {
          forgetSociety();
          void signOut();
        }}
      >
        {t('login.changeSociety')}
      </Button>
    </Screen>
  );
}
