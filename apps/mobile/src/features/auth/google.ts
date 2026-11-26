// Sign in with Google through Supabase (PKCE). The Before User Created hook still
// decides: a Google account whose email has no invite gets an error back.

export interface GoogleDeps {
  platform: string;
  /** Deep link the Google sheet returns to on phones, e.g. societyapp://auth-callback. */
  redirectUri: string;
  /** The web app's origin, used as the return address on the web. */
  webOrigin: string;
  startOAuth(options: {
    redirectTo: string;
    skipBrowserRedirect: boolean;
  }): Promise<{ url: string }>;
  openAuthSession(url: string, redirectUri: string): Promise<{ type: string; url?: string }>;
  exchangeCode(code: string): Promise<void>;
}

export async function signInWithGoogle(
  deps: GoogleDeps,
): Promise<'signed-in' | 'redirecting' | 'cancelled'> {
  if (deps.platform === 'web') {
    // The browser leaves for Google and comes back; supabase-js finishes the sign-in from the URL.
    await deps.startOAuth({ redirectTo: deps.webOrigin, skipBrowserRedirect: false });
    return 'redirecting';
  }

  const { url } = await deps.startOAuth({
    redirectTo: deps.redirectUri,
    skipBrowserRedirect: true,
  });
  const result = await deps.openAuthSession(url, deps.redirectUri);
  if (result.type !== 'success' || !result.url) return 'cancelled';

  const params = new URL(result.url.replace(/#/, '?')).searchParams;
  const description = params.get('error_description');
  if (description || params.get('error')) {
    throw { message: description ?? params.get('error') ?? 'google_sign_in_failed' };
  }
  const code = params.get('code');
  if (!code) throw { message: 'google_sign_in_failed' };
  await deps.exchangeCode(code);
  return 'signed-in';
}
