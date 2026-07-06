import type { AnalyticsEvent, AnalyticsEventName, AnalyticsPayload } from '../../shared/analytics';

type XtremepushFn = (command: 'event', name: AnalyticsEventName, payload: AnalyticsPayload) => void;
type BrowserWindow = Window & { xtremepush?: XtremepushFn & { q?: unknown[] } };

type AnalyticsDeps = {
  fetcher?: typeof fetch;
  win?: BrowserWindow;
  doc?: Document;
  sdkBaseUrl?: string;
};

export type XtremepushAnalytics = {
  init: () => Promise<boolean>;
  track: (event: AnalyticsEvent) => boolean;
};

export function createXtremepushAnalytics(deps: AnalyticsDeps = {}): XtremepushAnalytics {
  const win = deps.win ?? (typeof window !== 'undefined' ? (window as BrowserWindow) : undefined);
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const fetcher = deps.fetcher ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
  const sdkBaseUrl = deps.sdkBaseUrl ?? '/api/xtremepush';
  const pending: AnalyticsEvent[] = [];
  let initPromise: Promise<boolean> | null = null;
  let enabled = false;
  let disabled = false;

  const installQueue = () => {
    if (!win) return null;
    if (win.xtremepush) return win.xtremepush;
    const queued = ((...args: unknown[]) => {
      queued.q = queued.q ?? [];
      queued.q.push(args);
    }) as unknown as XtremepushFn & { q?: unknown[] };
    win.xtremepush = queued;
    return queued;
  };

  const flush = () => {
    while (pending.length) sendNow(pending.shift()!);
  };

  const sendNow = (event: AnalyticsEvent) => {
    if (!enabled || !win?.xtremepush) return false;
    try {
      win.xtremepush('event', event.name, event.payload);
      return true;
    } catch {
      return false;
    }
  };

  return {
    init: () => {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        if (!win || !doc || !fetcher) {
          disabled = true;
          return false;
        }
        try {
          const res = await fetcher('/api/config');
          const config = (await res.json()) as { xtremepushSdkKey?: string | null };
          const key = config.xtremepushSdkKey?.trim();
          if (!key) {
            disabled = true;
            pending.length = 0;
            return false;
          }
          installQueue();
          enabled = true;
          const existing = Array.from(doc.querySelectorAll('script[data-xtremepush-sdk]')).some(script => (script as HTMLScriptElement).dataset.xtremepushSdk === key);
          if (!existing) {
            const script = doc.createElement('script');
            script.async = true;
            script.src = `${sdkBaseUrl}/sdk.js`;
            script.dataset.xtremepushSdk = key;
            script.onerror = () => { disabled = true; enabled = false; pending.length = 0; };
            doc.head.appendChild(script);
          }
          flush();
          return true;
        } catch {
          disabled = true;
          pending.length = 0;
          return false;
        }
      })();
      return initPromise;
    },
    track: event => {
      if (disabled) return false;
      if (!enabled) {
        pending.push(event);
        return false;
      }
      return sendNow(event);
    }
  };
}

export const xtremepushAnalytics = createXtremepushAnalytics();
void xtremepushAnalytics.init();

export function trackAnalyticsEvent(event: AnalyticsEvent) {
  return xtremepushAnalytics.track(event);
}
