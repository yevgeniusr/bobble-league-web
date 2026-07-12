import { describe, expect, it, vi } from 'vitest';
import { fetchUnicupIdentity } from '../client/src/auth';

describe('Unicup browser identity bootstrap', () => {
  it('creates a guest session without an authorization header', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ accountId: 'unicup:guest', kind: 'guest' })));

    await expect(fetchUnicupIdentity(fetcher, async () => null)).resolves.toEqual({ accountId: 'unicup:guest', kind: 'guest' });
    expect(fetcher).toHaveBeenCalledWith('/api/identity', { credentials: 'same-origin', headers: {} });
  });

  it('sends the current Clerk session token for a signed-in account', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ accountId: 'unicup:account', kind: 'account' })));

    await fetchUnicupIdentity(fetcher, async () => 'session-token');

    expect(fetcher).toHaveBeenCalledWith('/api/identity', {
      credentials: 'same-origin', headers: { authorization: 'Bearer session-token' }
    });
  });
});
