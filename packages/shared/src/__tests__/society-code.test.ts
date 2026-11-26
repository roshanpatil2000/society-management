import { describe, expect, it } from 'vitest';

import {
  isValidSocietySlug,
  normalizeSocietyCode,
  RESERVED_SOCIETY_SLUGS,
  societyLink,
  suggestSocietySlug,
} from '../society-code';

describe('normalizeSocietyCode', () => {
  it('accepts a typed code, ignoring case and spaces', () => {
    expect(normalizeSocietyCode('  GreenPark ')).toBe('greenpark');
    expect(normalizeSocietyCode('Blue-Ridge')).toBe('blue-ridge');
  });

  it('extracts the code from a web link, a deep link or a subdomain', () => {
    expect(normalizeSocietyCode('https://app.societyapp.in/s/greenpark')).toBe('greenpark');
    expect(normalizeSocietyCode('https://app.societyapp.in/s/GreenPark/login?x=1')).toBe(
      'greenpark',
    );
    expect(normalizeSocietyCode('societyapp://s/blue-ridge')).toBe('blue-ridge');
    expect(normalizeSocietyCode('greenpark.societyapp.in')).toBe('greenpark');
  });

  it('returns null for empty or invalid input', () => {
    expect(normalizeSocietyCode('')).toBeNull();
    expect(normalizeSocietyCode('   ')).toBeNull();
    expect(normalizeSocietyCode('a')).toBeNull();
    expect(normalizeSocietyCode('green park')).toBeNull();
    expect(normalizeSocietyCode('https://example.com/')).toBeNull();
  });
});

describe('isValidSocietySlug', () => {
  it('allows 3 to 30 lower-case letters, digits and single hyphens', () => {
    for (const ok of ['abc', 'greenpark', 'blue-ridge', 'tower-2', 'a'.repeat(30)]) {
      expect(isValidSocietySlug(ok)).toBe(true);
    }
  });

  it('refuses bad shapes and reserved words', () => {
    for (const bad of [
      'ab',
      'a'.repeat(31),
      'Green',
      '-green',
      'green-',
      'green--park',
      'green_park',
      'grün',
    ]) {
      expect(isValidSocietySlug(bad)).toBe(false);
    }
    for (const reserved of RESERVED_SOCIETY_SLUGS) {
      expect(isValidSocietySlug(reserved)).toBe(false);
    }
  });
});

describe('suggestSocietySlug', () => {
  it('derives a valid code from a society name', () => {
    expect(suggestSocietySlug('Green Park CHS')).toBe('green-park');
    expect(suggestSocietySlug('Sunrise Towers Co-op Housing Society Ltd.')).toBe('sunrise-towers');
    expect(isValidSocietySlug(suggestSocietySlug('A'))).toBe(true);
  });
});

describe('societyLink', () => {
  it('builds the web and deep links for a code', () => {
    expect(societyLink('greenpark', 'https://app.societyapp.in/')).toBe(
      'https://app.societyapp.in/s/greenpark',
    );
    expect(societyLink('greenpark')).toBe('societyapp://s/greenpark');
  });
});
