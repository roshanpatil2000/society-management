import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';

import { Screen } from './Screen';

export function ComingSoon({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <Screen>
      <Text variant="headlineMedium">{t(titleKey)}</Text>
      <Text variant="bodyMedium">{t('home.comingSoon')}</Text>
    </Screen>
  );
}
