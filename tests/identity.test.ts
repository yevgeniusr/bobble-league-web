import { describe, expect, it, vi } from 'vitest';
import { createIdentityService } from '../server/identity';

const COOKIE = 'unicup_guest';

describe('Unicup canonical identity', () => {
  it('creates a signed guest identity and resolves it consistently', async () => {
    const service = createIdentityService({ secret: 'test-secret-that-is-long-enough' });

    const first = await service.resolve({});
    expect(first.kind).toBe('guest');
    expect(first.accountId).toMatch(/^unicup:[a-f0-9]{32}$/);
    expect(first.guestCookie).toMatch(/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/);

    const second = await service.resolve({ cookieHeader: `${COOKIE}=${first.guestCookie}` });
    expect(second).toMatchObject({ kind: 'guest', accountId: first.accountId });
    expect(second.guestCookie).toBeUndefined();
  });

  it('adopts an existing guest identity when a Clerk user signs in for the first time', async () => {
    const metadata = new Map<string, string>();
    const adapter = {
      authenticate: vi.fn(async (authorization?: string) => authorization === 'Bearer valid' ? 'user_123' : null),
      readAccountId: vi.fn(async (userId: string) => metadata.get(userId) ?? null),
      writeAccountId: vi.fn(async (userId: string, accountId: string) => { metadata.set(userId, accountId); })
    };
    const service = createIdentityService({ secret: 'test-secret-that-is-long-enough', clerk: adapter });
    const guest = await service.resolve({});

    const signedIn = await service.resolve({ authorization: 'Bearer valid', cookieHeader: `${COOKIE}=${guest.guestCookie}` });

    expect(signedIn).toMatchObject({ kind: 'account', clerkUserId: 'user_123', accountId: guest.accountId });
    expect(adapter.writeAccountId).toHaveBeenCalledWith('user_123', guest.accountId);
    expect((await service.resolve({ authorization: 'Bearer valid' })).accountId).toBe(guest.accountId);
  });

  it('falls back to a guest when a supplied Clerk token is invalid', async () => {
    const service = createIdentityService({
      secret: 'test-secret-that-is-long-enough',
      clerk: { authenticate: vi.fn(async () => null), readAccountId: vi.fn(), writeAccountId: vi.fn() }
    });

    const resolved = await service.resolve({ authorization: 'Bearer invalid' });

    expect(resolved.kind).toBe('guest');
    expect(resolved.accountId).toMatch(/^unicup:[a-f0-9]{32}$/);
  });

  it('keeps guest play available when Clerk metadata is temporarily unavailable', async () => {
    const service = createIdentityService({
      secret: 'test-secret-that-is-long-enough',
      clerk: {
        authenticate: vi.fn(async () => 'user_123'),
        readAccountId: vi.fn(async () => { throw new Error('Clerk unavailable'); }),
        writeAccountId: vi.fn()
      }
    });

    await expect(service.resolve({ authorization: 'Bearer valid' })).resolves.toMatchObject({ kind: 'guest' });
  });

  it('serializes first-time Clerk adoption so concurrent requests share one account id', async () => {
    let stored: string | null = null;
    const service = createIdentityService({
      secret: 'test-secret-that-is-long-enough',
      clerk: {
        authenticate: vi.fn(async () => 'user_123'),
        readAccountId: vi.fn(async () => stored),
        writeAccountId: vi.fn(async (_userId, accountId) => {
          await new Promise(resolve => setTimeout(resolve, 5));
          stored = accountId;
        })
      }
    });

    const [first, second] = await Promise.all([
      service.resolve({ authorization: 'Bearer valid' }),
      service.resolve({ authorization: 'Bearer valid' })
    ]);

    expect(second.accountId).toBe(first.accountId);
  });
});
