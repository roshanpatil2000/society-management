import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { List, Text } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { splitTabs, visibleTabs } from '@/features/permissions/permissions';
import { useSessionStore } from '@/stores/session';

export default function MoreRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useSessionStore((s) => s.permissions);
  const { more } = splitTabs(visibleTabs(permissions));
  return (
    <Screen>
      <Text variant="headlineMedium">{t('tabs.more')}</Text>
      {more.map((tab) => (
        <List.Item
          key={tab.name}
          title={t(tab.titleKey)}
          onPress={() => router.push(`/${tab.name}` as Href)}
          accessibilityRole="button"
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
        />
      ))}
    </Screen>
  );
}
