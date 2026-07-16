import type { AnalyticsEvent } from '../../shared/analytics';

type XtremepushFn = (...args: unknown[]) => void;
type BrowserWindow = Window & { XtremePushObject?: string; XPInterfaceInstance?: unknown; xtremepush?: XtremepushFn & { q?: unknown[] } };

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
    // The vendor SDK resolves its command queue through
    // window[window.XtremePushObject]. The dashboard-generated bootstrap uses
    // "xtremepush" here; setting the indirection is required even when our
    // queue function already exists.
    win.XtremePushObject = 'xtremepush';
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
          const res = await fetcher('/api/config', { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error('Xtremepush config unavailable');
          const config = (await res.json()) as { xtremepushSdkKey?: string | null };
          const key = typeof config.xtremepushSdkKey === 'string' ? config.xtremepushSdkKey.trim() : '';
          if (!key) {
            disabled = true;
            pending.length = 0;
            return false;
          }
          installQueue();
          const existing = Array.from(doc.querySelectorAll('script[data-xtremepush-sdk]')).some(script => (script as HTMLScriptElement).dataset.xtremepushSdk === key);
          let loaded = Boolean(existing && win.XPInterfaceInstance);
          if (!loaded) {
            loaded = await new Promise<boolean>(resolve => {
              const script = existing
                ? doc.querySelector('script[data-xtremepush-sdk]') as HTMLScriptElement | null
                : doc.createElement('script');
              if (!script) return resolve(false);
              let settled = false;
              const finish = (ok: boolean) => {
                if (settled) return;
                settled = true;
                globalThis.clearTimeout(timeout);
                resolve(ok && Boolean(win.XPInterfaceInstance));
              };
              const timeout = globalThis.setTimeout(() => finish(false), 15_000);
              script.onload = () => finish(true);
              script.onerror = () => finish(false);
              if (!existing) {
                script.async = true;
                script.src = `${sdkBaseUrl}/sdk.js`;
                script.dataset.xtremepushSdk = key;
                doc.head.appendChild(script);
              }
            });
          }
          if (!loaded) {
            disabled = true;
            pending.length = 0;
            return false;
          }
          enabled = true;
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

export function initXtremepush() {
  return xtremepushAnalytics.init();
}

export function xtremepushCommand(...args: unknown[]) {
  const fn = (window as BrowserWindow).xtremepush;
  if (!fn) return false;
  fn(...args);
  return true;
}

// The current web SDK still emits its own launcher in element mode. Keep the
// documented element mount, then make the generated iframe a true embedded view
// controlled exclusively by Unicup's Rewards button and panel.
export function normalizeEmbeddedLoyaltyMount(host: HTMLElement): HTMLIFrameElement | null {
  host.querySelector('#loyalty-widget-button')?.remove();
  const container = host.querySelector<HTMLElement>('#loyalty-frame-container');
  if (!container) return null;
  for (const child of Array.from(container.children)) {
    if (child instanceof host.ownerDocument.defaultView!.HTMLButtonElement) child.remove();
  }
  Object.assign(container.style, {
    position: 'relative',
    inset: 'auto',
    right: 'auto',
    bottom: 'auto',
    width: '100%',
    height: '100%',
    display: 'flex',
    borderRadius: '0',
    boxShadow: 'none'
  });
  const iframe = container.querySelector<HTMLIFrameElement>('iframe');
  if (iframe) Object.assign(iframe.style, { width: '100%', height: '100%', border: '0' });
  return iframe;
}
