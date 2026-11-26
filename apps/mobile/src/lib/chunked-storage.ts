// Supabase stores its session as one string, which can be larger than the ~2 KB a
// secure-store item holds on iOS and Android. This adapter splits a value across
// numbered keys and joins it back on read.

export interface KeyValueBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const safeKey = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, '_');
const countKey = (key: string): string => `${safeKey(key)}.n`;
const chunkKey = (key: string, i: number): string => `${safeKey(key)}.${i}`;

export function createChunkedStorage(backend: KeyValueBackend, chunkSize = 1800): KeyValueBackend {
  async function removeChunks(key: string): Promise<void> {
    const count = Number((await backend.getItem(countKey(key))) ?? '0');
    for (let i = 0; i < count; i += 1) await backend.removeItem(chunkKey(key, i));
    await backend.removeItem(countKey(key));
  }

  return {
    async getItem(key) {
      const raw = await backend.getItem(countKey(key));
      if (raw === null) return null;
      const parts: string[] = [];
      for (let i = 0; i < Number(raw); i += 1) {
        const part = await backend.getItem(chunkKey(key, i));
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },
    async setItem(key, value) {
      await removeChunks(key);
      const count = Math.max(1, Math.ceil(value.length / chunkSize));
      for (let i = 0; i < count; i += 1) {
        await backend.setItem(chunkKey(key, i), value.slice(i * chunkSize, (i + 1) * chunkSize));
      }
      await backend.setItem(countKey(key), String(count));
    },
    async removeItem(key) {
      await removeChunks(key);
    },
  };
}
