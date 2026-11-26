import { redirectFor } from '@/features/auth/gate-routes';

describe('redirectFor', () => {
  it('does nothing while loading', () => {
    expect(redirectFor({ screen: 'loading' }, ['(auth)', 'discover'])).toBeNull();
  });

  it('keeps signed-out people anywhere in the sign-in flow, and sends them there otherwise', () => {
    expect(redirectFor({ screen: 'discovery' }, ['(auth)', 'scan'])).toBeNull();
    expect(redirectFor({ screen: 'login' }, ['(auth)', 'verify'])).toBeNull();
    expect(redirectFor({ screen: 'discovery' }, ['s', '[code]'])).toBeNull();
    expect(redirectFor({ screen: 'discovery' }, ['(app)', '(tabs)'])).toBe('/discover');
    expect(redirectFor({ screen: 'login' }, [])).toBe('/login');
  });

  it('sends people to the one screen a membership decision needs', () => {
    expect(redirectFor({ screen: 'invite', societyId: 'x' }, ['(app)', '(tabs)'])).toBe('/invite');
    expect(redirectFor({ screen: 'not-member', societyId: 'x' }, ['(auth)', 'verify'])).toBe(
      '/not-member',
    );
    expect(redirectFor({ screen: 'consent', societyId: 'x' }, ['(gate)', 'consent'])).toBeNull();
  });

  it('lets someone choosing a society also look up a new one', () => {
    expect(redirectFor({ screen: 'picker' }, ['(gate)', 'picker'])).toBeNull();
    expect(redirectFor({ screen: 'picker' }, ['(auth)', 'discover'])).toBeNull();
    expect(redirectFor({ screen: 'picker' }, ['(app)', '(tabs)'])).toBe('/picker');
  });

  it('keeps members inside the app, the admin console, or a society lookup', () => {
    expect(
      redirectFor({ screen: 'app', societyId: 'x' }, ['(app)', '(tabs)', 'profile']),
    ).toBeNull();
    expect(redirectFor({ screen: 'app', societyId: 'x' }, ['admin'])).toBeNull();
    expect(redirectFor({ screen: 'app', societyId: 'x' }, ['(auth)', 'discover'])).toBeNull();
    expect(redirectFor({ screen: 'app', societyId: 'x' }, ['(auth)', 'verify'])).toBe('/');
    expect(redirectFor({ screen: 'app', societyId: 'x' }, ['(gate)', 'consent'])).toBe('/');
  });

  it('sends a super-admin with no society to the console', () => {
    expect(redirectFor({ screen: 'admin' }, ['admin', 'onboard'])).toBeNull();
    expect(redirectFor({ screen: 'admin' }, ['(auth)', 'verify'])).toBe('/admin');
  });
});
