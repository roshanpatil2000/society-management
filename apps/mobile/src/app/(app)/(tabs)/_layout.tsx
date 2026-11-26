import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { MORE_TAB, splitTabs, TABS, visibleTabs } from '@/features/permissions/permissions';
import { useSessionStore } from '@/stores/session';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Tabs come from the person's permissions in the active society. The database still checks every action. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const permissions = useSessionStore((s) => s.permissions);
  const { bar } = splitTabs(visibleTabs(permissions));
  const onBar = new Set(bar.map((tab) => tab.name));

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      {[...TABS.slice(0, -1), MORE_TAB, ...TABS.slice(-1)].map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.titleKey),
            href: onBar.has(tab.name) ? undefined : null,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={tab.icon as IconName} color={String(color)} size={size} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
