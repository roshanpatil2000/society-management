import en from '@/i18n/locales/en.json';
import hi from '@/i18n/locales/hi.json';
import mr from '@/i18n/locales/mr.json';

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

describe('translations', () => {
  it('Marathi and Hindi have exactly the English keys', () => {
    const base = keys(en as Tree).sort();
    expect(keys(mr as Tree).sort()).toEqual(base);
    expect(keys(hi as Tree).sort()).toEqual(base);
  });

  it('every error key used by errorKey exists in English', () => {
    const base = new Set(keys(en as Tree));
    for (const k of [
      'errors.permissionDenied',
      'errors.inviteExpired',
      'errors.quotaExceeded',
      'errors.societyInactive',
      'errors.notRegistered',
      'errors.codeInvalid',
      'errors.tooMany',
      'errors.generic',
    ]) {
      expect(base.has(k)).toBe(true);
    }
  });
});
