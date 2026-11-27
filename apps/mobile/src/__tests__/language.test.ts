import AsyncStorage from '@react-native-async-storage/async-storage';

import { restoreLanguage, saveLanguage } from '@/i18n/language';

describe('language preference', () => {
  beforeEach(() => AsyncStorage.clear());

  it('restores the language chosen earlier', async () => {
    const i18n = { language: 'en', changeLanguage: jest.fn().mockResolvedValue(undefined) };
    await saveLanguage('hi');
    await restoreLanguage(i18n);
    expect(i18n.changeLanguage).toHaveBeenCalledWith('hi');
  });

  it('ignores a missing or unsupported saved value', async () => {
    const i18n = { language: 'en', changeLanguage: jest.fn().mockResolvedValue(undefined) };
    await restoreLanguage(i18n);
    await AsyncStorage.setItem('language', 'fr');
    await restoreLanguage(i18n);
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });
});
