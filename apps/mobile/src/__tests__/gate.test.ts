import { CURRENT_CONSENT_VERSION, resolveGate, type GateInput } from '@/features/auth/gate';

const GP = 'society-green-park';
const BR = 'society-blue-ridge';
const base: GateInput = {
  authReady: true,
  signedIn: false,
  discoveredSocietyId: null,
  activeSocietyId: null,
  isPlatformAdmin: false,
  memberships: [],
  pendingInviteSocietyIds: [],
  consentVersion: CURRENT_CONSENT_VERSION,
  dataReady: true,
};

describe('resolveGate', () => {
  it('waits while the stored session is being restored', () => {
    expect(resolveGate({ ...base, authReady: false })).toEqual({ screen: 'loading' });
  });

  it('asks for the society code first when signed out and nothing was discovered', () => {
    expect(resolveGate(base)).toEqual({ screen: 'discovery' });
  });

  it("goes to that society's login when a society was discovered", () => {
    expect(resolveGate({ ...base, discoveredSocietyId: GP })).toEqual({ screen: 'login' });
  });

  it('waits for memberships and invites after sign-in', () => {
    expect(
      resolveGate({ ...base, signedIn: true, discoveredSocietyId: GP, dataReady: false }),
    ).toEqual({
      screen: 'loading',
    });
  });

  it('opens the discovered society when the user is a member of it', () => {
    expect(
      resolveGate({ ...base, signedIn: true, discoveredSocietyId: GP, memberships: [BR, GP] }),
    ).toEqual({
      screen: 'app',
      societyId: GP,
    });
  });

  it('offers a pending invite for the discovered society', () => {
    expect(
      resolveGate({
        ...base,
        signedIn: true,
        discoveredSocietyId: GP,
        pendingInviteSocietyIds: [GP],
      }),
    ).toEqual({ screen: 'invite', societyId: GP });
  });

  it('says "not a member" when the email has no membership or invite there', () => {
    expect(
      resolveGate({
        ...base,
        signedIn: true,
        discoveredSocietyId: GP,
        memberships: [BR],
        pendingInviteSocietyIds: [BR],
      }),
    ).toEqual({ screen: 'not-member', societyId: GP });
  });

  it('asks for consent before opening the app when the notice changed or was never accepted', () => {
    expect(
      resolveGate({
        ...base,
        signedIn: true,
        discoveredSocietyId: GP,
        memberships: [GP],
        consentVersion: null,
      }),
    ).toEqual({ screen: 'consent', societyId: GP });
  });

  it('without a discovered society: one membership opens it, several show the picker unless one is active', () => {
    const signed = { ...base, signedIn: true };
    expect(resolveGate({ ...signed, memberships: [GP] })).toEqual({ screen: 'app', societyId: GP });
    expect(resolveGate({ ...signed, memberships: [GP, BR] })).toEqual({ screen: 'picker' });
    expect(resolveGate({ ...signed, memberships: [GP, BR], activeSocietyId: BR })).toEqual({
      screen: 'app',
      societyId: BR,
    });
    expect(resolveGate({ ...signed, memberships: [GP], activeSocietyId: 'stale-id' })).toEqual({
      screen: 'app',
      societyId: GP,
    });
  });

  it('without a discovered society and no membership: an invite, the admin console, or discovery', () => {
    const signed = { ...base, signedIn: true };
    expect(resolveGate({ ...signed, pendingInviteSocietyIds: [GP] })).toEqual({
      screen: 'invite',
      societyId: GP,
    });
    expect(resolveGate({ ...signed, isPlatformAdmin: true })).toEqual({ screen: 'admin' });
    expect(resolveGate(signed)).toEqual({ screen: 'discovery' });
  });
});
