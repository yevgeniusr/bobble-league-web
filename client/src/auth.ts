export type UnicupIdentity = { accountId: string; kind: 'guest' | 'account' };
export type ClerkTokenGetter = () => Promise<string | null>;

export async function authHeaders(getToken: ClerkTokenGetter): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function fetchUnicupIdentity(fetcher: typeof fetch, getToken: ClerkTokenGetter): Promise<UnicupIdentity> {
  const response = await fetcher('/api/identity', { credentials: 'same-origin', headers: await authHeaders(getToken) });
  if (!response.ok) throw new Error('Could not establish a Unicup identity.');
  const value = await response.json() as Partial<UnicupIdentity>;
  if (typeof value.accountId !== 'string' || (value.kind !== 'guest' && value.kind !== 'account')) throw new Error('Invalid Unicup identity response.');
  return { accountId: value.accountId, kind: value.kind };
}
