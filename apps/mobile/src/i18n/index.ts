import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { restoreLanguage } from './language';
import en from './locales/en.json';
import hi from './locales/hi.json';
import mr from './locales/mr.json';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'mr', label: 'मराठी' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const supported = LANGUAGES.map((l) => l.code) as string[];
const deviceLanguage = getLocales()[0]?.languageCode ?? 'en';

// eslint-disable-next-line import/no-named-as-default-member -- i18next's documented setup
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, mr: { translation: mr }, hi: { translation: hi } },
  lng: supported.includes(deviceLanguage) ? deviceLanguage : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Apply the language the person chose last time (the device language until then).
void restoreLanguage(i18n);

export default i18n;
