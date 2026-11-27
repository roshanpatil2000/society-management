import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import * as authApi from '@/features/auth/api';
import type { Access } from '@/features/auth/api';
import { HomeScreen } from '@/features/home/HomeScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import i18n from '@/i18n';
import { useSessionStore } from '@/stores/session';
import { renderScreen } from '@/test/render';
import { router } from '@/test/router-mock';

jest.mock('expo-router', () => require('@/test/router-mock').routerMock);
jest.mock('@/features/auth/api');
const mocked = jest.mocked(authApi);

const access = (over: Partial<Access> = {}): Access => ({
  userId: 'u1',
  email: 'ravi@example.com',
  fullName: 'Ravi Deshmukh',
  consentVersion: 1,
  isPlatformAdmin: false,
  memberships: [
    { society_id: 'gp-id', society_name: 'Green Park CHS', role_names: ['Member', 'Treasurer'] },
  ],
  invites: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.getState().reset();
  useSessionStore.getState().setActiveSociety('gp-id');
});
afterEach(() => void i18n.changeLanguage('en'));

describe('HomeScreen', () => {
  it('greets the person and names the active society', async () => {
    await renderScreen(<HomeScreen access={access()} />);
    expect(screen.getByText('Hello, Ravi Deshmukh')).toBeTruthy();
    expect(screen.getByText('Green Park CHS')).toBeTruthy();
  });
});

describe('ProfileScreen', () => {
  it('shows the person, their email and their roles in this society', async () => {
    await renderScreen(<ProfileScreen access={access()} />);
    expect(screen.getByText('Ravi Deshmukh')).toBeTruthy();
    expect(screen.getByText('ravi@example.com')).toBeTruthy();
    expect(screen.getByText('Member, Treasurer')).toBeTruthy();
  });

  it('offers Switch society only to people in more than one society', async () => {
    const { unmount } = await renderScreen(<ProfileScreen access={access()} />);
    expect(screen.queryByText('Switch society')).toBeNull();
    await unmount();
    await renderScreen(
      <ProfileScreen
        access={access({
          memberships: [
            { society_id: 'gp-id', society_name: 'Green Park CHS', role_names: ['Member'] },
            { society_id: 'br-id', society_name: 'Blue Ridge CHS', role_names: ['Member'] },
          ],
        })}
      />,
    );
    await fireEvent.press(screen.getByText('Switch society'));
    expect(useSessionStore.getState().activeSocietyId).toBeNull();
  });

  it('switches the language and marks the chosen one as selected', async () => {
    await renderScreen(<ProfileScreen access={access()} />);
    await fireEvent.press(screen.getByText('मराठी'));
    expect(i18n.language).toBe('mr');
    expect(await screen.findByText('साइन आउट')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'मराठी' }).props.accessibilityState?.checked).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'English' }).props.accessibilityState?.checked).toBe(
      false,
    );
  });

  it('signs out', async () => {
    mocked.signOut.mockResolvedValue(undefined);
    await renderScreen(<ProfileScreen access={access()} />);
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() => expect(mocked.signOut).toHaveBeenCalled());
  });

  it('shows the super-admin console link only to platform admins', async () => {
    const { unmount } = await renderScreen(<ProfileScreen access={access()} />);
    expect(screen.queryByText('Super-admin console')).toBeNull();
    await unmount();
    await renderScreen(<ProfileScreen access={access({ isPlatformAdmin: true })} />);
    await fireEvent.press(screen.getByText('Super-admin console'));
    expect(router.push).toHaveBeenCalledWith('/admin');
  });
});
