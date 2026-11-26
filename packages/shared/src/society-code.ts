// Society code ("slug"): how a person picks their society before logging in
// (tenant discovery). Typed on the first screen, printed as a QR on the notice
// board, or carried in a link. Self-contained (no imports) so the Deno Edge
// Functions can import it too. Keep the rules in step with the SQL in
// private.assert_society_slug.

export const SOCIETY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SOCIETY_SLUG_MIN = 3;
export const SOCIETY_SLUG_MAX = 30;

export const RESERVED_SOCIETY_SLUGS: readonly string[] = [
  'www',
  'app',
  'api',
  'admin',
  's',
  'login',
  'auth',
  'help',
  'support',
  'staging',
  'static',
];

export const DEEP_LINK_SCHEME = 'societyapp';

export function isValidSocietySlug(value: string): boolean {
  return (
    value.length >= SOCIETY_SLUG_MIN &&
    value.length <= SOCIETY_SLUG_MAX &&
    SOCIETY_SLUG_PATTERN.test(value) &&
    !RESERVED_SOCIETY_SLUGS.includes(value)
  );
}

/**
 * Turns whatever the person typed, scanned or opened into a society code, or null.
 * Accepts `greenpark`, `GreenPark`, `https://<app>/s/greenpark`, `societyapp://s/greenpark`
 * and the subdomain form `greenpark.<domain>.<tld>`.
 */
export function normalizeSocietyCode(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw === '') return null;

  let candidate = raw;
  const pathMatch = /(?:^|\/)s\/([^/?#]+)/.exec(raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '/'));
  if (pathMatch?.[1]) {
    candidate = pathMatch[1];
  } else if (raw.includes('.') || raw.includes('/')) {
    const host = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0] ?? '';
    const labels = host.split('.');
    // Only treat it as a subdomain when there is one: sub.domain.tld
    candidate = labels.length >= 3 ? (labels[0] ?? '') : '';
  }

  return isValidSocietySlug(candidate) ? candidate : null;
}

const NAME_STOPWORDS = new Set([
  'chs',
  'co',
  'op',
  'coop',
  'cooperative',
  'operative',
  'housing',
  'society',
  'soc',
  'hsg',
  'ltd',
  'limited',
  'the',
  'and',
]);

/** A starting suggestion for the super-admin, derived from the society name. */
export function suggestSocietySlug(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w !== '' && !NAME_STOPWORDS.has(w));

  let slug = '';
  for (const word of words) {
    const next = slug === '' ? word : `${slug}-${word}`;
    if (next.length > SOCIETY_SLUG_MAX) break;
    slug = next;
  }
  if (slug.length < SOCIETY_SLUG_MIN || RESERVED_SOCIETY_SLUGS.includes(slug)) {
    slug = `${slug === '' ? 'society' : slug}-chs`;
  }
  return slug.slice(0, SOCIETY_SLUG_MAX).replace(/-+$/, '');
}

/** Link that opens the app on this society's login screen (web when a base URL is given). */
export function societyLink(slug: string, webBaseUrl?: string): string {
  return webBaseUrl
    ? `${webBaseUrl.replace(/\/+$/, '')}/s/${slug}`
    : `${DEEP_LINK_SCHEME}://s/${slug}`;
}
