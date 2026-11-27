import { errorKey } from '@/lib/errors';

describe('errorKey', () => {
  it('maps database error codes to translation keys', () => {
    expect(errorKey({ message: 'permission_denied: members.invite', code: '42501' })).toBe(
      'errors.permissionDenied',
    );
    expect(errorKey({ message: 'invite_expired' })).toBe('errors.inviteExpired');
    expect(errorKey({ message: 'quota_exceeded: invites_per_day' })).toBe('errors.quotaExceeded');
    expect(errorKey({ message: 'society_inactive' })).toBe('errors.societyInactive');
  });

  it('maps the no-self-registration message from Auth', () => {
    expect(
      errorKey({ message: "This email isn't registered with any society. Ask your committee." }),
    ).toBe('errors.notRegistered');
  });

  it('maps wrong or expired codes and rate limits from Auth', () => {
    expect(errorKey({ message: 'Token has expired or is invalid', code: 'otp_expired' })).toBe(
      'errors.codeInvalid',
    );
    expect(
      errorKey({ message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' }),
    ).toBe('errors.tooMany');
  });

  it('maps ledger refusals', () => {
    expect(
      errorKey({ message: 'opening_already_posted: opening balances were already posted' }),
    ).toBe('errors.openingAlreadyPosted');
    expect(errorKey({ message: 'books_not_empty: opening balances must be the first entry' })).toBe(
      'errors.booksNotEmpty',
    );
    expect(errorKey({ message: 'period_locked: the books are closed up to 2026-03-31' })).toBe(
      'errors.periodLocked',
    );
  });

  it('falls back to a generic message', () => {
    expect(errorKey({ message: 'something odd' })).toBe('errors.generic');
    expect(errorKey(new Error('boom'))).toBe('errors.generic');
    expect(errorKey(null)).toBe('errors.generic');
  });
});
