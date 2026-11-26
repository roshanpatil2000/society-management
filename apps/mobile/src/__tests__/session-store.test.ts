import { useSessionStore } from '@/stores/session';

const greenPark = {
  society_id: '2ec496a0-aabf-418c-9045-e70fe3dfd381',
  slug: 'greenpark',
  name: 'Green Park CHS',
  city: 'Andheri West, Mumbai',
  logo_url: null,
  login_methods: ['email_otp', 'google'],
};

describe('session store', () => {
  afterEach(() => useSessionStore.getState().reset());

  it('remembers the society picked at discovery and makes it active', () => {
    useSessionStore.getState().chooseSociety(greenPark);
    const s = useSessionStore.getState();
    expect(s.discovered?.slug).toBe('greenpark');
    expect(s.activeSocietyId).toBe(greenPark.society_id);
  });

  it('switching society clears the old permissions', () => {
    useSessionStore.getState().setPermissions(['bills.approve']);
    useSessionStore.getState().setActiveSociety('another-id');
    expect(useSessionStore.getState().permissions).toEqual([]);
  });

  it('signing out keeps the discovered society but clears the active one', () => {
    useSessionStore.getState().chooseSociety(greenPark);
    useSessionStore.getState().setPermissions(['bills.view.own']);
    useSessionStore.getState().signedOut();
    const s = useSessionStore.getState();
    expect(s.discovered?.slug).toBe('greenpark');
    expect(s.activeSocietyId).toBeNull();
    expect(s.permissions).toEqual([]);
  });
});
