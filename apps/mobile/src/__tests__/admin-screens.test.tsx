import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import * as adminApi from '@/features/admin/api';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { OnboardScreen } from '@/features/admin/OnboardScreen';
import { SocietiesScreen } from '@/features/admin/SocietiesScreen';
import { SocietyDetailScreen } from '@/features/admin/SocietyDetailScreen';
import { renderScreen } from '@/test/render';
import { router } from '@/test/router-mock';

jest.mock('expo-router', () => require('@/test/router-mock').routerMock);
jest.mock('@/features/admin/api');
jest.mock('react-native-qrcode-svg', () => {
  const { Text: RNText } = require('react-native');
  return function QRCodeMock({ value }: { value: string }) {
    return <RNText>QR:{value}</RNText>;
  };
});
const mocked = jest.mocked(adminApi);

const society = {
  id: 'gp-id',
  name: 'Green Park CHS',
  slug: 'greenpark',
  status: 'active',
  plan: 'pilot',
  trial_ends_at: null,
  quotas: { max_flats: 300, invites_per_day: 100 },
};

beforeEach(() => jest.clearAllMocks());

describe('AdminGuard', () => {
  it('shows the console to platform admins only', async () => {
    const { unmount } = await renderScreen(
      <AdminGuard isPlatformAdmin={false}>
        <Text>Console</Text>
      </AdminGuard>,
    );
    expect(screen.queryByText('Console')).toBeNull();
    await unmount();
    await renderScreen(
      <AdminGuard isPlatformAdmin>
        <Text>Console</Text>
      </AdminGuard>,
    );
    expect(screen.getByText('Console')).toBeTruthy();
  });
});

describe('SocietiesScreen', () => {
  it('lists societies with their code and status, and opens onboarding', async () => {
    mocked.listSocieties.mockResolvedValue([
      society,
      { ...society, id: 'br', name: 'Blue Ridge CHS', slug: 'blueridge', status: 'suspended' },
    ]);
    await renderScreen(<SocietiesScreen />);
    expect(await screen.findByText('Green Park CHS')).toBeTruthy();
    expect(screen.getByText('greenpark · Active')).toBeTruthy();
    expect(screen.getByText('blueridge · Suspended')).toBeTruthy();
    await fireEvent.press(screen.getByText('Onboard a society'));
    expect(router.push).toHaveBeenCalledWith('/admin/onboard');
  });
});

describe('OnboardScreen', () => {
  it('suggests a code from the name, until the code is edited by hand', async () => {
    await renderScreen(<OnboardScreen />);
    await fireEvent.changeText(screen.getByLabelText('Society name'), 'Sunrise Towers CHS');
    expect(screen.getByLabelText('Society code').props.value).toBe('sunrise-towers');
    await fireEvent.changeText(screen.getByLabelText('Society code'), 'sunrise');
    await fireEvent.changeText(screen.getByLabelText('Society name'), 'Sunrise Towers Co-op');
    expect(screen.getByLabelText('Society code').props.value).toBe('sunrise');
  });

  it('checks the form with the shared schema before calling the server', async () => {
    await renderScreen(<OnboardScreen />);
    await fireEvent.changeText(screen.getByLabelText('Society name'), 'Sunrise Towers CHS');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.changeText(screen.getByLabelText('Full name'), 'Vikram');
    await fireEvent.press(screen.getByText('Create society'));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(mocked.onboardSociety).not.toHaveBeenCalled();
  });

  it('creates the society with its committee and opens it', async () => {
    mocked.onboardSociety.mockResolvedValue({ society_id: 'new-id' });
    await renderScreen(<OnboardScreen />);
    await fireEvent.changeText(screen.getByLabelText('Society name'), 'Sunrise Towers CHS');
    await fireEvent.changeText(screen.getByLabelText('Address'), 'Thane West');
    await fireEvent.changeText(screen.getByLabelText('Email'), ' Vikram@Example.com ');
    await fireEvent.changeText(screen.getByLabelText('Full name'), 'Vikram Joshi');
    await fireEvent.press(screen.getByText('Create society'));
    await waitFor(() =>
      expect(mocked.onboardSociety).toHaveBeenCalledWith({
        action: 'onboard',
        status: 'trial',
        society: { name: 'Sunrise Towers CHS', slug: 'sunrise-towers', address: 'Thane West' },
        committee: [
          { email: 'vikram@example.com', full_name: 'Vikram Joshi', roles: ['Chairman'] },
        ],
      }),
    );
    expect(router.replace).toHaveBeenCalledWith('/admin/society/new-id');
  });

  it('shows a taken society code clearly', async () => {
    mocked.onboardSociety.mockRejectedValue({
      message: 'duplicate_slug: the society code sunrise-towers is taken',
    });
    await renderScreen(<OnboardScreen />);
    await fireEvent.changeText(screen.getByLabelText('Society name'), 'Sunrise Towers CHS');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'vikram@example.com');
    await fireEvent.changeText(screen.getByLabelText('Full name'), 'Vikram Joshi');
    await fireEvent.press(screen.getByText('Create society'));
    expect(await screen.findByText('That society code is already taken.')).toBeTruthy();
  });
});

describe('SocietyDetailScreen', () => {
  it('shows the society link and its QR code for the notice board', async () => {
    mocked.getSociety.mockResolvedValue(society);
    await renderScreen(<SocietyDetailScreen societyId="gp-id" webUrl="http://localhost:8081" />);
    expect(await screen.findByText('http://localhost:8081/s/greenpark')).toBeTruthy();
    expect(screen.getByText('QR:http://localhost:8081/s/greenpark')).toBeTruthy();
  });

  it('suspends an active society', async () => {
    mocked.getSociety.mockResolvedValue(society);
    mocked.setStatus.mockResolvedValue(undefined);
    await renderScreen(<SocietyDetailScreen societyId="gp-id" webUrl="http://localhost:8081" />);
    await fireEvent.press(await screen.findByText('Suspend'));
    await waitFor(() => expect(mocked.setStatus).toHaveBeenCalledWith('gp-id', 'suspended'));
  });

  it('changes the society code', async () => {
    mocked.getSociety.mockResolvedValue(society);
    mocked.setSlug.mockResolvedValue('green-park');
    await renderScreen(<SocietyDetailScreen societyId="gp-id" webUrl="http://localhost:8081" />);
    await fireEvent.changeText(await screen.findByLabelText('Society code'), 'Green-Park');
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(mocked.setSlug).toHaveBeenCalledWith('gp-id', 'green-park'));
  });
});
