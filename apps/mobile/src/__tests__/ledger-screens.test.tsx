import { fireEvent, screen } from '@testing-library/react-native';

import * as accounts from '@/features/accounts/api';
import { defaultOpeningDate } from '@/features/accounts/dates';
import { FlatStatement } from '@/features/accounts/FlatStatement';
import { OpeningBalancesScreen } from '@/features/accounts/OpeningBalancesScreen';
import * as society from '@/features/society/api';
import { SocietyHomeScreen } from '@/features/society/SocietyHomeScreen';
import { YourFlatCard } from '@/features/society/YourFlatCard';
import { useSessionStore } from '@/stores/session';
import { renderScreen } from '@/test/render';
import { router } from '@/test/router-mock';

jest.mock('expo-router', () => require('@/test/router-mock').routerMock);
jest.mock('@/features/accounts/api');
jest.mock('@/features/society/api');
const mockedAccounts = jest.mocked(accounts);
const mockedSociety = jest.mocked(society);

const SID = 'gp-id';
const report = (over: Partial<accounts.OpeningReport> = {}): accounts.OpeningReport => ({
  ok: true,
  entry_id: null,
  flats: 100,
  total_debit: 33504500,
  total_credit: 33504500,
  errors: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  useSessionStore.getState().reset();
  useSessionStore.getState().setActiveSociety(SID);
});

describe('defaultOpeningDate', () => {
  it('is the last 31 March, the end of the previous financial year', () => {
    expect(defaultOpeningDate(new Date('2026-11-27T10:00:00+05:30'))).toBe('2026-03-31');
    expect(defaultOpeningDate(new Date('2027-02-10T10:00:00+05:30'))).toBe('2026-03-31');
    expect(defaultOpeningDate(new Date('2026-04-01T00:30:00+05:30'))).toBe('2026-03-31');
    expect(defaultOpeningDate(new Date('2026-03-31T23:00:00+05:30'))).toBe('2025-03-31');
  });
});

describe('OpeningBalancesScreen', () => {
  it('checks the file first, shows the totals, then posts', async () => {
    mockedSociety.pickSpreadsheet.mockResolvedValue({ name: 'opening.xlsx', base64: 'B64' });
    mockedAccounts.importOpeningBalances
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(report({ entry_id: 'e1' }));
    await renderScreen(<OpeningBalancesScreen />);
    await fireEvent.changeText(screen.getByLabelText('As of date'), '2026-03-31');
    await fireEvent.press(screen.getByText('Choose file'));
    expect(
      await screen.findByText(
        'Ready to post opening balances for 100 flats. Debits ₹3,35,045.00, credits ₹3,35,045.00.',
      ),
    ).toBeTruthy();
    expect(mockedAccounts.importOpeningBalances).toHaveBeenCalledWith(
      SID,
      '2026-03-31',
      'B64',
      true,
    );
    await fireEvent.press(screen.getByText('Post opening balances'));
    expect(await screen.findByText('Opening balances posted.')).toBeTruthy();
    expect(mockedAccounts.importOpeningBalances).toHaveBeenLastCalledWith(
      SID,
      '2026-03-31',
      'B64',
      false,
    );
  });

  it('lists problems by sheet and row and posts nothing', async () => {
    mockedSociety.pickSpreadsheet.mockResolvedValue({ name: 'opening.xlsx', base64: 'B64' });
    mockedAccounts.importOpeningBalances.mockResolvedValue(
      report({
        ok: false,
        flats: 0,
        errors: [
          {
            sheet: 'flats',
            row: 3,
            field: 'flat_number',
            message: 'No flat D-999 in this society',
          },
          { sheet: 'accounts', row: 2, field: 'code', message: 'Unknown account code 9999' },
          {
            sheet: 'file',
            row: 0,
            field: 'total',
            message: 'Debits ₹10.00 and credits ₹9.00 differ by ₹1.00',
          },
        ],
      }),
    );
    await renderScreen(<OpeningBalancesScreen />);
    await fireEvent.press(screen.getByText('Choose file'));
    expect(
      await screen.findByText('Flats · Row 3 · flat_number: No flat D-999 in this society'),
    ).toBeTruthy();
    expect(screen.getByText('Accounts · Row 2 · code: Unknown account code 9999')).toBeTruthy();
    expect(screen.getByText('File: Debits ₹10.00 and credits ₹9.00 differ by ₹1.00')).toBeTruthy();
    expect(screen.queryByText('Post opening balances')).toBeNull();
  });

  it('refuses a badly written date before reading the file', async () => {
    await renderScreen(<OpeningBalancesScreen />);
    await fireEvent.changeText(screen.getByLabelText('As of date'), '31/03/2026');
    await fireEvent.press(screen.getByText('Choose file'));
    expect(
      await screen.findByText('Enter the date as YYYY-MM-DD, for example 2026-03-31.'),
    ).toBeTruthy();
    expect(mockedSociety.pickSpreadsheet).not.toHaveBeenCalled();
  });

  it('explains when the books already have their opening balances', async () => {
    mockedSociety.pickSpreadsheet.mockResolvedValue({ name: 'opening.xlsx', base64: 'B64' });
    mockedAccounts.importOpeningBalances.mockRejectedValue({
      message: 'opening_already_posted: opening balances were already posted',
    });
    await renderScreen(<OpeningBalancesScreen />);
    await fireEvent.press(screen.getByText('Choose file'));
    expect(
      await screen.findByText('Opening balances were already posted for this society.'),
    ).toBeTruthy();
  });
});

describe('FlatStatement', () => {
  it('shows the balance due and each entry', async () => {
    mockedAccounts.flatStatement.mockResolvedValue([
      {
        id: 'l1',
        entry_date: '2026-03-31',
        narration: 'Opening balances as on 31 Mar 2026',
        source_type: 'opening',
        debit: 1250050,
        credit: 0,
        balance: 1250050,
      },
    ]);
    await renderScreen(<FlatStatement flatId="f1" />);
    expect(await screen.findByText('Balance due ₹12,500.50')).toBeTruthy();
    expect(screen.getByText('Opening balances as on 31 Mar 2026')).toBeTruthy();
    expect(mockedAccounts.flatStatement).toHaveBeenCalledWith('f1');
  });

  it('shows an advance as money paid ahead', async () => {
    mockedAccounts.flatStatement.mockResolvedValue([
      {
        id: 'l1',
        entry_date: '2026-03-31',
        narration: 'Opening',
        source_type: 'opening',
        debit: 0,
        credit: 300000,
        balance: -300000,
      },
    ]);
    await renderScreen(<FlatStatement flatId="f2" />);
    expect(await screen.findByText('Advance ₹3,000.00')).toBeTruthy();
  });

  it('shows nothing when there are no entries the person may see', async () => {
    mockedAccounts.flatStatement.mockResolvedValue([]);
    await renderScreen(<FlatStatement flatId="f3" />);
    expect(await screen.findByText('No dues and no entries yet.')).toBeTruthy();
  });
});

describe('Society tab and Your flat', () => {
  it('offers opening balances only with accounts.opening_balance', async () => {
    useSessionStore.getState().setPermissions(['flats.view.all']);
    const { unmount } = await renderScreen(<SocietyHomeScreen />);
    expect(screen.queryByText('Opening balances')).toBeNull();
    await unmount();
    useSessionStore.getState().setPermissions(['accounts.opening_balance']);
    await renderScreen(<SocietyHomeScreen />);
    await fireEvent.press(screen.getByText('Opening balances'));
    expect(router.push).toHaveBeenCalledWith('/society/opening-balances');
  });

  it("opens the member's flat statement from Home", async () => {
    mockedSociety.myFlats.mockResolvedValue([{ id: 'f1', label: 'A-101', type: 'owner' }]);
    await renderScreen(<YourFlatCard />);
    await fireEvent.press(await screen.findByText('A-101 · Owner'));
    expect(router.push).toHaveBeenCalledWith('/society/flat/f1');
  });
});
