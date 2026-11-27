import { fireEvent, screen } from '@testing-library/react-native';

import * as society from '@/features/society/api';
import { FlatDetailScreen } from '@/features/society/FlatDetailScreen';
import { SocietyHomeScreen } from '@/features/society/SocietyHomeScreen';
import * as transfers from '@/features/transfers/api';
import { RequestTransferScreen } from '@/features/transfers/RequestTransferScreen';
import { TransfersScreen } from '@/features/transfers/TransfersScreen';
import { useSessionStore } from '@/stores/session';
import { renderScreen } from '@/test/render';
import { params, router } from '@/test/router-mock';

jest.mock('expo-router', () => require('@/test/router-mock').routerMock);
jest.mock('@/features/society/api');
jest.mock('@/features/transfers/api');
jest.mock('@/features/accounts/api', () => ({ flatStatement: jest.fn().mockResolvedValue([]) }));
const mockedSociety = jest.mocked(society);
const mockedTransfers = jest.mocked(transfers);

const SID = 'gp-id';
const flat: society.FlatSummary = {
  id: 'f1',
  wing: 'A',
  number: '101',
  floor: 1,
  area_sqft: 650,
  flat_type: '2BHK',
  occupants: [
    { id: 'o1', name: 'Ravi Deshmukh', type: 'owner' },
    { id: 'o2', name: 'Divya Rao', type: 'tenant' },
  ],
};
const pending: transfers.PendingTransfer = {
  id: 't1',
  flat: 'A-101',
  sellers: ['Ravi Deshmukh'],
  buyers: [{ email: 'meera@example.com', full_name: 'Meera Iyer', type: 'owner' }],
  transfer_date: '2026-11-27',
  share_cert_no: 'GP-SC-0101-B',
  transfer_fee: 2500000,
  mine: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete params[k];
  useSessionStore.getState().reset();
  useSessionStore.getState().setActiveSociety(SID);
  mockedSociety.listFlats.mockResolvedValue([flat]);
});

describe('Flat page', () => {
  it('offers Transfer flat only with members.manage', async () => {
    params.id = 'f1';
    const { unmount } = await renderScreen(<FlatDetailScreen />);
    expect(await screen.findByText('A-101')).toBeTruthy();
    expect(screen.queryByText('Transfer flat')).toBeNull();
    await unmount();
    useSessionStore.getState().setPermissions(['members.manage']);
    await renderScreen(<FlatDetailScreen />);
    await fireEvent.press(await screen.findByText('Transfer flat'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/society/transfer',
      params: { flatId: 'f1' },
    });
  });
});

describe('RequestTransferScreen', () => {
  it('sends the owners as sellers and the buyer, with the fee in paise', async () => {
    params.flatId = 'f1';
    mockedTransfers.requestTransfer.mockResolvedValue('t1');
    await renderScreen(<RequestTransferScreen />);
    expect(await screen.findByText('Transfer A-101')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Ravi Deshmukh (Owner)', checked: true })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Divya Rao (Tenant)' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Buyer email'), 'Meera@Example.com');
    await fireEvent.changeText(screen.getByLabelText('Buyer name'), 'Meera Iyer');
    await fireEvent.changeText(screen.getByLabelText('Transfer date'), '2026-11-27');
    await fireEvent.changeText(screen.getByLabelText('Share certificate number'), 'GP-SC-0101-B');
    await fireEvent.changeText(screen.getByLabelText('Transfer fee (₹)'), '25,000');
    await fireEvent.press(screen.getByText('Request transfer'));
    expect(
      await screen.findByText('Transfer requested. Another committee member must approve it.'),
    ).toBeTruthy();
    expect(mockedTransfers.requestTransfer).toHaveBeenCalledWith({
      societyId: SID,
      flatId: 'f1',
      fromOccupantIds: ['o1'],
      buyers: [{ email: 'meera@example.com', full_name: 'Meera Iyer', type: 'owner' }],
      transferDate: '2026-11-27',
      shareCertNo: 'GP-SC-0101-B',
      transferFee: 2500000,
      note: null,
    });
  });

  it('checks the email, date and fee before sending', async () => {
    params.flatId = 'f1';
    await renderScreen(<RequestTransferScreen />);
    await screen.findByText('Transfer A-101');
    await fireEvent.changeText(screen.getByLabelText('Buyer email'), 'not-an-email');
    await fireEvent.press(screen.getByText('Request transfer'));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Buyer email'), 'meera@example.com');
    await fireEvent.changeText(screen.getByLabelText('Transfer fee (₹)'), '12.345');
    await fireEvent.press(screen.getByText('Request transfer'));
    expect(
      await screen.findByText('Enter the fee in rupees, like 25000 or 25,000.50'),
    ).toBeTruthy();
    expect(mockedTransfers.requestTransfer).not.toHaveBeenCalled();
  });
});

describe('TransfersScreen', () => {
  it('lets another committee member approve a pending transfer', async () => {
    useSessionStore.getState().setPermissions(['members.transfer']);
    mockedTransfers.listTransfers.mockResolvedValue([pending]);
    mockedTransfers.decideTransfer.mockResolvedValue({
      closed: 1,
      added: 0,
      invited: 1,
      memberships_removed: 1,
    });
    await renderScreen(<TransfersScreen />);
    expect(await screen.findByText('A-101 · 27 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Ravi Deshmukh → Meera Iyer (Owner)')).toBeTruthy();
    expect(screen.getByText('Share certificate GP-SC-0101-B · Fee ₹25,000.00')).toBeTruthy();
    await fireEvent.press(screen.getByText('Approve'));
    expect(mockedTransfers.decideTransfer).toHaveBeenCalledWith('t1', 'approve', null);
    expect(
      await screen.findByText('Approved: 1 owner moved out, 0 added, 1 invited.'),
    ).toBeTruthy();
  });

  it('needs a reason to reject', async () => {
    useSessionStore.getState().setPermissions(['members.transfer']);
    mockedTransfers.listTransfers.mockResolvedValue([pending]);
    mockedTransfers.decideTransfer.mockResolvedValue({
      closed: 0,
      added: 0,
      invited: 0,
      memberships_removed: 0,
    });
    await renderScreen(<TransfersScreen />);
    await fireEvent.press(await screen.findByText('Reject'));
    expect(screen.getByText('Give a reason for rejecting.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'Documents incomplete');
    await fireEvent.press(screen.getByText('Reject'));
    expect(mockedTransfers.decideTransfer).toHaveBeenCalledWith(
      't1',
      'reject',
      'Documents incomplete',
    );
  });

  it('does not offer a decision on your own request', async () => {
    useSessionStore.getState().setPermissions(['members.transfer']);
    mockedTransfers.listTransfers.mockResolvedValue([{ ...pending, mine: true }]);
    await renderScreen(<TransfersScreen />);
    expect(
      await screen.findByText('You requested this; another committee member must approve it.'),
    ).toBeTruthy();
    expect(screen.queryByText('Approve')).toBeNull();
  });

  it('is listed in the Society tab for transfer approvers', async () => {
    useSessionStore.getState().setPermissions(['members.transfer']);
    await renderScreen(<SocietyHomeScreen />);
    await fireEvent.press(screen.getByText('Flat transfers'));
    expect(router.push).toHaveBeenCalledWith('/society/transfers');
  });
});
