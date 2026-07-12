import { createClerkClient } from '@clerk/backend';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GUEST_COOKIE_NAME = 'unicup_guest';
const ACCOUNT_ID_PATTERN = /^unicup:[a-f0-9]{32}$/;

export type ClerkIdentityAdapter = {
  authenticate: (authorization?: string) => Promise<string | null>;
  readAccountId: (clerkUserId: string) => Promise<string | null>;
  writeAccountId: (clerkUserId: string, accountId: string) => Promise<void>;
};

export type ResolvedIdentity = {
  accountId: string;
  kind: 'guest' | 'account';
  clerkUserId?: string;
  guestCookie?: string;
};

export function createIdentityService(options: { secret: string; clerk?: ClerkIdentityAdapter }) {
  const key = Buffer.from(options.secret, 'utf8');
  const pendingAccounts = new Map<string, Promise<string>>();
  if (key.length < 16) throw new Error('Unicup guest identity secret must be at least 16 bytes.');

  return {
    async resolve(input: { authorization?: string; cookieHeader?: string }): Promise<ResolvedIdentity> {
      const cookieValue = readCookie(input.cookieHeader, GUEST_COOKIE_NAME);
      const guestId = verifyGuestCookie(cookieValue, key);
      const clerkUserId = await authenticateSafely(options.clerk, input.authorization);
      if (clerkUserId && options.clerk) {
        try {
          let pending = pendingAccounts.get(clerkUserId);
          if (!pending) {
            pending = resolveClerkAccount(options.clerk, clerkUserId, guestId);
            pendingAccounts.set(clerkUserId, pending);
            void pending.then(
              () => pendingAccounts.delete(clerkUserId),
              () => pendingAccounts.delete(clerkUserId)
            );
          }
          const accountId = await pending;
          return { accountId, kind: 'account', clerkUserId };
        } catch { /* Keep guest play available if Clerk's Backend API is unavailable. */ }
      }

      const id = guestId ?? randomId();
      return {
        accountId: `unicup:${id}`,
        kind: 'guest',
        ...(!guestId ? { guestCookie: signGuestCookie(id, key) } : {})
      };
    }
  };
}

async function resolveClerkAccount(adapter: ClerkIdentityAdapter, clerkUserId: string, guestId: string | null) {
  const stored = await adapter.readAccountId(clerkUserId);
  if (validAccountId(stored)) return stored;
  const accountId = `unicup:${guestId ?? randomId()}`;
  await adapter.writeAccountId(clerkUserId, accountId);
  return accountId;
}

export function createClerkIdentityAdapter(options: {
  secretKey?: string;
  publishableKey?: string;
  authorizedParties: string[];
}): ClerkIdentityAdapter | undefined {
  const secretKey = options.secretKey?.trim();
  const publishableKey = options.publishableKey?.trim();
  if (!secretKey || !publishableKey) return undefined;
  const client = createClerkClient({ secretKey, publishableKey });
  return {
    async authenticate(authorization) {
      if (!authorization?.startsWith('Bearer ')) return null;
      const request = new Request(options.authorizedParties[0] ?? 'http://localhost', { headers: { authorization } });
      const state = await client.authenticateRequest(request, {
        acceptsToken: 'session_token',
        authorizedParties: options.authorizedParties
      });
      return state.isAuthenticated ? state.toAuth().userId : null;
    },
    async readAccountId(clerkUserId) {
      const user = await client.users.getUser(clerkUserId);
      const value = user.privateMetadata.unicupAccountId;
      return typeof value === 'string' ? value : null;
    },
    async writeAccountId(clerkUserId, accountId) {
      await client.users.updateUserMetadata(clerkUserId, { privateMetadata: { unicupAccountId: accountId } });
    }
  };
}

async function authenticateSafely(adapter: ClerkIdentityAdapter | undefined, authorization?: string) {
  if (!adapter || !authorization) return null;
  try { return await adapter.authenticate(authorization); }
  catch { return null; }
}

function validAccountId(value: string | null): value is string {
  return Boolean(value && ACCOUNT_ID_PATTERN.test(value));
}

function randomId() {
  return randomBytes(16).toString('hex');
}

function signGuestCookie(id: string, key: Buffer) {
  return `${id}.${createHmac('sha256', key).update(id).digest('base64url')}`;
}

function verifyGuestCookie(value: string | undefined, key: Buffer) {
  const match = value?.match(/^([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  const expected = createHmac('sha256', key).update(match[1]).digest();
  const supplied = Buffer.from(match[2], 'base64url');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? match[1] : null;
}

export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
