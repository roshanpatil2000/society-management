import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';

import * as api from '@/features/society/api';
import { FlatDetailScreen } from '@/features/society/FlatDetailScreen';
import { FlatsScreen } from '@/features/society/FlatsScreen';
import { ImportFlatsScreen } from '@/features/society/ImportFlatsScreen';
import { InviteMemberScreen } from '@/features/society/InviteMemberScreen';
import { InvitesScreen } from '@/features/society/InvitesScreen';
import { SocietyHomeScreen } from '@/features/society/SocietyHomeScreen';
import { YourFlatCard } from '@/features/society/YourFlatCard';
import { useSessionStore } from '@/stores/session';
import { renderScreen } from '@/test/render';
import { params, router } from '@/test/router-mock';

jest.mock('expo-router', () => require('@/test/router-mock').routerMock);
jest.mock('@/features/society/api');
const mocked = jest.mocked(api);

const SID = 'gp-id';
const flats: api.FlatSummary[] = [
  {
    id: 'f1',
    wing: 'A',
    number: '101',
    floor: 1,
    area_sqft: 650,
    flat_type: '2BHK',
    occupants: [{ id: 'o1', name: 'Ravi Deshmukh', type: 'owner' }],
  },
  {
    id: 'f2',
    wing: 'A',
    number: '102',
    floor: 1,
    area_sqft: 650,
    flat_type: '2BHK',
    occupants: [{ id: 'o2', name: 'Divya Rao', type: 'tenant' }],
  },
  { id: 'f3', wing: 'B', number: '201', floor: 2, area_sqft: 720, flat_type: null, occupants: [] },
];

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete params[k];
  useSessionStore.getState().reset();
  useSessionStore.getState().chooseSociety({
    society_id: SID,
    slug: 'greenpark',
    name: 'Green Park CHS',
    city: null,
    logo_url: null,
    login_methods: ['email_otp'],
  });
});

describe('SocietyHomeScreen', () => {
  it('shows only the sections the person may use', async () => {
    useSessionStore.getState().setPermissions(['flats.view.all', 'members.view.all']);
    const { unmount } = await renderScreen(<SocietyHomeScreen />);
    expect(screen.getByText('Wings and flats')).toBeTruthy();
    expect(screen.queryByText('Import flats')).toBeNull();
    expect(screen.queryByText('Invite a member')).toBeNull();
    await unmount();
    useSessionStore.getState().setPermissions(['flats.view.all', 'flats.manage', 'members.invite']);
    await renderScreen(<SocietyHomeScreen />);
    expect(screen.getByText('Import flats')).toBeTruthy();
    expect(screen.getByText('Invite a member')).toBeTruthy();
  });
});

describe('FlatsScreen', () => {
  it('lists flats by wing with their occupants and opens one', async () => {
    mocked.listFlats.mockResolvedValue(flats);
    await renderScreen(<FlatsScreen />);
    expect(await screen.findByText('Wing A')).toBeTruthy();
    expect(screen.getByText('Wing B')).toBeTruthy();
    expect(screen.getByText('Ravi Deshmukh (Owner)')).toBeTruthy();
    expect(screen.getByText('Vacant')).toBeTruthy();
    expect(mocked.listFlats).toHaveBeenCalledWith(SID);
    await fireEvent.press(screen.getByText('A-101'));
    expect(router.push).toHaveBeenCalledWith('/society/flat/f1');
  });
});

describe('FlatDetailScreen', () => {
  it('shows the occupants and invites an owner for this flat', async () => {
    mocked.listFlats.mockResolvedValue(flats);
    params.id = 'f2';
    const { unmount } = await renderScreen(<FlatDetailScreen />);
    expect(await screen.findByText('A-102')).toBeTruthy();
    expect(screen.getByText('Divya Rao')).toBeTruthy();
    expect(screen.queryByText('Invite owner')).toBeNull();
    await unmount();
    useSessionStore.getState().setPermissions(['flats.view.all', 'members.invite']);
    await renderScreen(<FlatDetailScreen />);
    expect(await screen.findByText('A-102')).toBeTruthy();
    await fireEvent.press(screen.getByText('Invite owner'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/society/invite',
      params: { flatId: 'f2', occupantType: 'owner' },
    });
  });
});

describe('InviteMemberScreen', () => {
  beforeEach(() => {
    mocked.listRoles.mockResolvedValue([
      { id: 'r-member', name: 'Member' },
      { id: 'r-tenant', name: 'Tenant' },
    ]);
    mocked.listFlats.mockResolvedValue(flats);
  });

  it('refuses an invalid email', async () => {
    await renderScreen(<InviteMemberScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'nope');
    await fireEvent.press(screen.getByText('Send invite'));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(mocked.createInvite).not.toHaveBeenCalled();
  });

  it('invites an owner for a flat with the Member role, then offers to share the link', async () => {
    params.flatId = 'f1';
    params.occupantType = 'owner';
    mocked.createInvite.mockResolvedValue({
      invite_id: 'i1',
      token: 't',
      expires_at: '2026-12-04T00:00:00Z',
    });
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderScreen(<InviteMemberScreen webUrl="https://app.example" />);
    expect(await screen.findByText('Flat A-101 · Owner')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Email'), ' New.Owner@Example.com ');
    await fireEvent.changeText(screen.getByLabelText('Full name'), 'New Owner');
    await fireEvent.press(screen.getByText('Send invite'));
    await waitFor(() =>
      expect(mocked.createInvite).toHaveBeenCalledWith({
        societyId: SID,
        email: 'new.owner@example.com',
        fullName: 'New Owner',
        roleIds: ['r-member'],
        flatId: 'f1',
        occupantType: 'owner',
      }),
    );
    await fireEvent.press(await screen.findByText('Share invite'));
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('https://app.example/s/greenpark'),
    });
  });

  it('defaults a tenant invite to the Tenant role', async () => {
    params.flatId = 'f2';
    params.occupantType = 'tenant';
    mocked.createInvite.mockResolvedValue({
      invite_id: 'i2',
      token: 't',
      expires_at: '2026-12-04T00:00:00Z',
    });
    await renderScreen(<InviteMemberScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'tenant@example.com');
    await fireEvent.press(screen.getByText('Send invite'));
    await waitFor(() =>
      expect(mocked.createInvite.mock.calls[0]?.[0].roleIds).toEqual(['r-tenant']),
    );
  });
});

describe('InvitesScreen', () => {
  it('lists pending invites and resends or revokes them', async () => {
    mocked.listInvites.mockResolvedValue([
      {
        id: 'i1',
        email: 'a@x.com',
        full_name: 'A',
        flat: 'A-101',
        expires_at: '2026-12-04T00:00:00Z',
        status: 'pending',
      },
    ]);
    mocked.resendInvite.mockResolvedValue(undefined);
    mocked.revokeInvite.mockResolvedValue(undefined);
    await renderScreen(<InvitesScreen />);
    expect(await screen.findByText('a@x.com')).toBeTruthy();
    await fireEvent.press(screen.getByText('Resend'));
    await waitFor(() => expect(mocked.resendInvite).toHaveBeenCalledWith('i1'));
    await fireEvent.press(screen.getByText('Revoke'));
    await waitFor(() => expect(mocked.revokeInvite).toHaveBeenCalledWith('i1'));
  });
});

describe('ImportFlatsScreen', () => {
  it('checks the file first, shows what will be created, then imports', async () => {
    mocked.pickSpreadsheet.mockResolvedValue({ name: 'flats.xlsx', base64: 'BASE64' });
    mocked.importFlats
      .mockResolvedValueOnce({
        ok: true,
        wings_created: 2,
        flats_created: 100,
        invites_created: 5,
        errors: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        wings_created: 2,
        flats_created: 100,
        invites_created: 5,
        errors: [],
      });
    await renderScreen(<ImportFlatsScreen />);
    await fireEvent.press(screen.getByText('Choose file'));
    expect(
      await screen.findByText('Ready to import 100 flats, 2 new wings and 5 owner invites.'),
    ).toBeTruthy();
    expect(mocked.importFlats).toHaveBeenCalledWith(SID, 'BASE64', true);
    await fireEvent.press(screen.getByText('Import'));
    expect(await screen.findByText('Imported 100 flats.')).toBeTruthy();
    expect(mocked.importFlats).toHaveBeenLastCalledWith(SID, 'BASE64', false);
  });

  it('lists the problems row by row and imports nothing', async () => {
    mocked.pickSpreadsheet.mockResolvedValue({ name: 'flats.xlsx', base64: 'BASE64' });
    mocked.importFlats.mockResolvedValue({
      ok: false,
      wings_created: 0,
      flats_created: 0,
      invites_created: 0,
      errors: [
        { row: 3, field: 'wing', message: 'Wing is required' },
        { row: 0, field: 'file', message: 'Missing column: Flat No' },
      ],
    });
    await renderScreen(<ImportFlatsScreen />);
    await fireEvent.press(screen.getByText('Choose file'));
    expect(await screen.findByText('Row 3 · wing: Wing is required')).toBeTruthy();
    expect(screen.getByText('File: Missing column: Flat No')).toBeTruthy();
    expect(screen.queryByText('Import')).toBeNull();
  });
});

describe('YourFlatCard', () => {
  it('shows the member their flats', async () => {
    mocked.myFlats.mockResolvedValue([{ id: 'f1', label: 'A-101', type: 'owner' }]);
    await renderScreen(<YourFlatCard />);
    expect(await screen.findByText('A-101 · Owner')).toBeTruthy();
  });
});
