import type { PermissionKey } from '@society/shared';

export function can(permissions: readonly string[], key: PermissionKey): boolean {
  return permissions.includes(key);
}

export interface TabDefinition {
  /** Route name under app/(app)/(tabs). */
  name: string;
  titleKey: string;
  icon: string;
  /** Shown when the user holds any of these; empty means always shown. */
  anyOf: readonly PermissionKey[];
}

// Order is the order of the tab bar (PLAN.md, "One app, role-based navigation").
export const TABS: readonly TabDefinition[] = [
  { name: 'index', titleKey: 'tabs.home', icon: 'home', anyOf: [] },
  { name: 'bills', titleKey: 'tabs.bills', icon: 'receipt', anyOf: ['bills.view.own'] },
  {
    name: 'complaints',
    titleKey: 'tabs.complaints',
    icon: 'chatbubbles',
    anyOf: ['complaints.create', 'complaints.view.assigned'],
  },
  {
    name: 'transparency',
    titleKey: 'tabs.transparency',
    icon: 'pie-chart',
    anyOf: ['dashboard.view'],
  },
  {
    name: 'billing',
    titleKey: 'tabs.billing',
    icon: 'document-text',
    anyOf: ['bills.generate', 'bills.view.all'],
  },
  {
    name: 'expenses',
    titleKey: 'tabs.expenses',
    icon: 'wallet',
    anyOf: ['expenses.create', 'expenses.approve'],
  },
  { name: 'accounts', titleKey: 'tabs.accounts', icon: 'library', anyOf: ['accounts.view'] },
  {
    name: 'society',
    titleKey: 'tabs.society',
    icon: 'business',
    anyOf: ['flats.manage', 'members.manage', 'roles.manage'],
  },
  { name: 'profile', titleKey: 'tabs.profile', icon: 'person', anyOf: [] },
];

export function visibleTabs(permissions: readonly string[]): TabDefinition[] {
  return TABS.filter(
    (tab) => tab.anyOf.length === 0 || tab.anyOf.some((key) => permissions.includes(key)),
  );
}

export const MORE_TAB: TabDefinition = {
  name: 'more',
  titleKey: 'tabs.more',
  icon: 'menu',
  anyOf: [],
};

/**
 * Phones show at most `max` tabs. With more, Home stays first and Profile last,
 * the first few module tabs stay on the bar, and the rest move under More.
 */
export function splitTabs(
  tabs: readonly TabDefinition[],
  max = 5,
): { bar: TabDefinition[]; more: TabDefinition[] } {
  if (tabs.length <= max) return { bar: [...tabs], more: [] };
  const [home, ...rest] = tabs;
  const profile = rest.pop();
  if (!home || !profile) return { bar: [...tabs], more: [] };
  const keep = Math.max(0, max - 3);
  return { bar: [home, ...rest.slice(0, keep), MORE_TAB, profile], more: rest.slice(keep) };
}
