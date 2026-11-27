// The person's chosen language, kept on the device between launches.
import { appStorage } from '@/lib/app-storage';

const KEY = 'language';
const SUPPORTED = ['en', 'mr', 'hi'];

interface LanguageSwitcher {
  language: string;
  changeLanguage(code: string): Promise<unknown>;
}

export async function saveLanguage(code: string): Promise<void> {
  await appStorage.setItem(KEY, code);
}

/** Switches to the saved language, if one was chosen and is still supported. */
export async function restoreLanguage(i18n: LanguageSwitcher): Promise<void> {
  const saved = await appStorage.getItem(KEY);
  if (saved && SUPPORTED.includes(saved) && saved !== i18n.language)
    await i18n.changeLanguage(saved);
}
