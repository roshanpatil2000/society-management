// Non-secret app preferences (chosen society, language). AsyncStorage on native,
// localStorage on web.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const appStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};
