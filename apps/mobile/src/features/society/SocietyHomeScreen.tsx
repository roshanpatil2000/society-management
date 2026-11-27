import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { List, Text } from 'react-native-paper';

import type { PermissionKey } from '@society/shared';

import { Screen } from '@/components/Screen';
import { can } from '@/features/permissions/permissions';
import { useSessionStore } from '@/stores/session';

const SECTIONS: { titleKey: string; icon: string; href: Href; anyOf: PermissionKey[] }[] = [
  {
    titleKey: 'society.flats',
    icon: 'office-building',
    href: '/society/flats',
    anyOf: ['flats.view.all', 'flats.manage'],
  },
  {
    titleKey: 'society.invite',
    icon: 'account-plus',
    href: '/society/invite',
    anyOf: ['members.invite'],
  },
  {
    titleKey: 'society.invites',
    icon: 'email-outline',
    href: '/society/invites',
    anyOf: ['members.invite'],
  },
  {
    titleKey: 'society.import',
    icon: 'file-upload-outline',
    href: '/society/import',
    anyOf: ['flats.manage'],
  },
];

export function SocietyHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const permissions = useSessionStore((s) => s.permissions);

  return (
    <Screen>
      <Text variant="headlineMedium">{t('tabs.society')}</Text>
      {SECTIONS.filter((s) => s.anyOf.some((k) => can(permissions, k))).map((s) => (
        <List.Item
          key={s.titleKey}
          title={t(s.titleKey)}
          left={(props) => <List.Icon {...props} icon={s.icon} />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => router.push(s.href)}
          accessibilityRole="button"
        />
      ))}
    </Screen>
  );
}
