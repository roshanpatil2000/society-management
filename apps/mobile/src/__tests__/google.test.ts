import { signInWithGoogle, type GoogleDeps } from '@/features/auth/google';

const deps = (over: Partial<GoogleDeps> = {}): GoogleDeps => ({
  platform: 'android',
  redirectUri: 'societyapp://auth-callback',
  webOrigin: 'http://localhost:8081',
  startOAuth: jest
    .fn()
    .mockResolvedValue({ url: 'https://project.supabase.co/auth/v1/authorize?provider=google' }),
  openAuthSession: jest
    .fn()
    .mockResolvedValue({ type: 'success', url: 'societyapp://auth-callback?code=abc123' }),
  exchangeCode: jest.fn().mockResolvedValue(undefined),
  ...over,
});

describe('signInWithGoogle', () => {
  it('on a phone, opens the Google sheet and exchanges the returned code for a session', async () => {
    const d = deps();
    await expect(signInWithGoogle(d)).resolves.toBe('signed-in');
    expect(d.startOAuth).toHaveBeenCalledWith({
      redirectTo: 'societyapp://auth-callback',
      skipBrowserRedirect: true,
    });
    expect(d.openAuthSession).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize?provider=google',
      'societyapp://auth-callback',
    );
    expect(d.exchangeCode).toHaveBeenCalledWith('abc123');
  });

  it('on the web, lets the browser redirect to Google and back to the app', async () => {
    const d = deps({ platform: 'web' });
    await expect(signInWithGoogle(d)).resolves.toBe('redirecting');
    expect(d.startOAuth).toHaveBeenCalledWith({
      redirectTo: 'http://localhost:8081',
      skipBrowserRedirect: false,
    });
    expect(d.openAuthSession).not.toHaveBeenCalled();
  });

  it('reports a cancelled sheet without an error', async () => {
    const d = deps({ openAuthSession: jest.fn().mockResolvedValue({ type: 'cancel' }) });
    await expect(signInWithGoogle(d)).resolves.toBe('cancelled');
    expect(d.exchangeCode).not.toHaveBeenCalled();
  });

  it('turns an error in the callback (e.g. no invite for this Google email) into a readable error', async () => {
    const d = deps({
      openAuthSession: jest.fn().mockResolvedValue({
        type: 'success',
        url: 'societyapp://auth-callback?error=access_denied&error_description=This+email+isn%27t+registered+with+any+society.+Ask+your+committee.',
      }),
    });
    await expect(signInWithGoogle(d)).rejects.toEqual({
      message: "This email isn't registered with any society. Ask your committee.",
    });
  });
});
