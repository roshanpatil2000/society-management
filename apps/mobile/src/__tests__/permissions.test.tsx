import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Can } from '@/features/permissions/Can';
import { can, visibleTabs } from '@/features/permissions/permissions';
import { useSessionStore } from '@/stores/session';
import { ROLE_PRESETS, type PermissionKey } from '@society/shared';

const presetKeys = (name: string): PermissionKey[] => [
  ...(ROLE_PRESETS.find((p) => p.name === name)?.permissions ?? []),
];

describe('can', () => {
  it('is true only for held keys', () => {
    expect(can(['bills.view.own'], 'bills.view.own')).toBe(true);
    expect(can(['bills.view.own'], 'bills.view.all')).toBe(false);
    expect(can([], 'dashboard.view')).toBe(false);
  });
});

describe('visibleTabs', () => {
  it('shows a member their bills, complaints and dashboard, but no committee tabs', () => {
    expect(visibleTabs(presetKeys('Member')).map((t) => t.name)).toEqual([
      'index',
      'bills',
      'complaints',
      'transparency',
      'profile',
    ]);
  });

  it('shows a treasurer billing, expenses and accounts', () => {
    expect(visibleTabs(presetKeys('Treasurer')).map((t) => t.name)).toEqual([
      'index',
      'transparency',
      'billing',
      'expenses',
      'accounts',
      'profile',
    ]);
  });

  it('shows staff only Home, Complaints and Profile', () => {
    expect(visibleTabs(presetKeys('Staff')).map((t) => t.name)).toEqual([
      'index',
      'complaints',
      'profile',
    ]);
  });

  it('gives the three roles three different tab sets from the same config', () => {
    const sets = ['Member', 'Treasurer', 'Staff'].map((r) =>
      visibleTabs(presetKeys(r))
        .map((t) => t.name)
        .join(','),
    );
    expect(new Set(sets).size).toBe(3);
  });

  it('always keeps Home and Profile, even with no permissions', () => {
    expect(visibleTabs([]).map((t) => t.name)).toEqual(['index', 'profile']);
  });
});

describe('<Can>', () => {
  afterEach(() => useSessionStore.getState().reset());

  it('renders children only when the active society grants the permission', async () => {
    useSessionStore.getState().setPermissions(['notices.manage']);
    await render(
      <>
        <Can permission="notices.manage">
          <Text>Publish notice</Text>
        </Can>
        <Can permission="bills.approve" fallback={<Text>No access</Text>}>
          <Text>Approve bills</Text>
        </Can>
      </>,
    );
    expect(screen.getByText('Publish notice')).toBeTruthy();
    expect(screen.queryByText('Approve bills')).toBeNull();
    expect(screen.getByText('No access')).toBeTruthy();
  });
});
