import { createHash, createHmac, createPublicKey, createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import { userIdForNickname } from './xtremepush';

export type LoyaltyConfig = {
  sdkKey?: string;
  endpoint?: string;
  privateKey?: string;
  publicKey?: string;
  keyId?: string;
  tokenTtlSeconds?: number;
};

export type LoyaltyToken = {
  token: string;
  userId: string;
  expiresAt: number;
};

export function normalizeLoyaltyEndpoint(value?: string) {
  const endpoint = value?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') ?? '';
  if (!endpoint || !/^p[1-9]\d*\.p\.loyalty\.(?:live|eu|us)\.xtremepush\.com$/i.test(endpoint)) return '';
  return endpoint;
}

export function normalizePrivateKey(value?: string) {
  return value?.trim().replace(/\\n/g, '\n') ?? '';
}

export function createLoyaltyService(config: LoyaltyConfig) {
  const sdkKey = config.sdkKey?.trim() ?? '';
  const endpoint = normalizeLoyaltyEndpoint(config.endpoint);
  const privateKey = normalizePrivateKey(config.privateKey);
  const publicKey = normalizePrivateKey(config.publicKey);
  const keyId = config.keyId?.trim() || undefined;
  const configuredTtl = config.tokenTtlSeconds ?? 300;
  const ttl = Number.isFinite(configuredTtl) ? Math.max(60, Math.min(3600, Math.floor(configuredTtl))) : 300;
  const keyPairValid = validateKeyPair(privateKey, publicKey);
  const enabled = Boolean(sdkKey && endpoint && keyPairValid);
  const guestSigningKey = createHash('sha256').update('babble-loyalty-guest-v1\0').update(privateKey).digest();

  return {
    enabled,
    sdkKey,
    endpoint,
    guestSession(cookieValue?: string): { id: string; cookie: string; created: boolean } | null {
      if (!enabled) return null;
      const verified = verifyGuestCookie(cookieValue, guestSigningKey);
      const id = verified ?? randomBytes(16).toString('hex');
      return { id, cookie: signGuestCookie(id, guestSigningKey), created: !verified };
    },
    issueToken(nickname: string, guestId: string, nowSeconds = Math.floor(Date.now() / 1000)): LoyaltyToken | null {
      if (!enabled || !/^[a-f0-9]{32}$/.test(guestId)) return null;
      const userId = `${userIdForNickname(nickname)}:guest:${guestId}`;
      const expiresAt = nowSeconds + ttl;
      const header = { alg: 'RS256', typ: 'JWT', ...(keyId ? { kid: keyId } : {}) };
      const payload = { sub: userId, exp: expiresAt };
      const encodedHeader = base64url(JSON.stringify(header));
      const encodedPayload = base64url(JSON.stringify(payload));
      const unsigned = `${encodedHeader}.${encodedPayload}`;
      const signer = createSign('RSA-SHA256');
      signer.update(unsigned);
      signer.end();
      const signature = signer.sign(privateKey).toString('base64url');
      return { token: `${unsigned}.${signature}`, userId, expiresAt };
    }
  };
}

function validateKeyPair(privateKey: string, publicKey: string) {
  if (!privateKey) return false;
  try {
    const derivedObject = createPublicKey(privateKey);
    if (derivedObject.asymmetricKeyType !== 'rsa' || (derivedObject.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return false;
    if (!publicKey) return true;
    const derived = derivedObject.export({ type: 'spki', format: 'pem' }).toString().trim();
    const supplied = createPublicKey(publicKey).export({ type: 'spki', format: 'pem' }).toString().trim();
    return derived === supplied;
  } catch {
    return false;
  }
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

function base64url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}
