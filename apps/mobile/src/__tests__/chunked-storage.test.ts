import { createChunkedStorage, type KeyValueBackend } from '@/lib/chunked-storage';

function memoryBackend(): KeyValueBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => Promise.resolve(data.get(k) ?? null),
    setItem: (k, v) => {
      data.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      data.delete(k);
      return Promise.resolve();
    },
  };
}

describe('createChunkedStorage', () => {
  it('stores small values in one piece and reads them back', async () => {
    const backend = memoryBackend();
    const storage = createChunkedStorage(backend, 10);
    await storage.setItem('sb.session', 'short');
    expect(await storage.getItem('sb.session')).toBe('short');
  });

  it('splits values larger than the chunk size and joins them on read', async () => {
    const backend = memoryBackend();
    const storage = createChunkedStorage(backend, 4);
    await storage.setItem('k', 'abcdefghij');
    for (const value of backend.data.values()) expect(value.length).toBeLessThanOrEqual(4);
    expect(await storage.getItem('k')).toBe('abcdefghij');
  });

  it('removes every chunk, including leftovers from a longer earlier value', async () => {
    const backend = memoryBackend();
    const storage = createChunkedStorage(backend, 4);
    await storage.setItem('k', 'abcdefghijklmnop');
    await storage.setItem('k', 'xy');
    expect(await storage.getItem('k')).toBe('xy');
    expect(
      [...backend.data.keys()].filter((key) => key.startsWith('k')).length,
    ).toBeLessThanOrEqual(2);
    await storage.removeItem('k');
    expect(backend.data.size).toBe(0);
    expect(await storage.getItem('k')).toBeNull();
  });

  it('only uses key characters the secure store accepts', async () => {
    const backend = memoryBackend();
    const storage = createChunkedStorage(backend, 4);
    await storage.setItem('sb-abc-auth-token', 'abcdefghij');
    for (const key of backend.data.keys()) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
