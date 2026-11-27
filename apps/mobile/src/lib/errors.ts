// Maps database and Auth errors to translation keys, so screens show a clear,
// translated message instead of raw error text.

const RULES: readonly [RegExp, string][] = [
  [/isn't registered with any society/i, 'errors.notRegistered'],
  [/^permission_denied/, 'errors.permissionDenied'],
  [/^invite_expired/, 'errors.inviteExpired'],
  [/^invite_not_(found|pending)/, 'errors.inviteUnavailable'],
  [/^quota_exceeded/, 'errors.quotaExceeded'],
  [/^society_inactive/, 'errors.societyInactive'],
  [/^already_invited/, 'errors.alreadyInvited'],
  [/^already_member/, 'errors.alreadyMember'],
  [/^duplicate_slug/, 'errors.duplicateCode'],
  [/^opening_already_posted/, 'errors.openingAlreadyPosted'],
  [/^books_not_empty/, 'errors.booksNotEmpty'],
  [/^period_locked/, 'errors.periodLocked'],
  [/token has expired or is invalid|otp_expired|invalid.*(otp|token)/i, 'errors.codeInvalid'],
  [/rate limit|too many/i, 'errors.tooMany'],
];

export function errorKey(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'errors.generic';
  const { message, code } = error as { message?: unknown; code?: unknown };
  const text =
    `${typeof message === 'string' ? message : ''} ${typeof code === 'string' ? code : ''}`.trim();
  if (text === '') return 'errors.generic';
  if (code === '42501') return 'errors.permissionDenied';
  const match = RULES.find(([pattern]) => pattern.test(text));
  return match ? match[1] : 'errors.generic';
}
