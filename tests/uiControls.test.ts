import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

describe('round time controls', () => {
  it('renders exact-second control with visible five-second milestones', async () => {
    const module = await import('../client/src/landingArchive') as typeof import('../client/src/landingArchive') & {
      ROUND_TIME_MILESTONES?: readonly number[];
      RoundTimeControl?: React.ComponentType<{ value: number; onChange: (value: number) => void; disabled?: boolean }>;
    };
    expect(module.ROUND_TIME_MILESTONES).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(module.RoundTimeControl).toBeTypeOf('function');
    const html = renderToStaticMarkup(React.createElement(module.RoundTimeControl!, { value: 20, onChange: vi.fn() }));
    const document = new JSDOM(html).window.document;
    const slider = document.querySelector('input[type="range"]');
    expect(slider?.getAttribute('min')).toBe('2');
    expect(slider?.getAttribute('max')).toBe('60');
    expect(slider?.getAttribute('step')).toBe('1');
    expect(document.querySelectorAll('.roundTimeMilestone')).toHaveLength(12);
  });
});

describe('embedded loyalty normalization', () => {
  it('removes the vendor launcher and expands its iframe inside the custom host', async () => {
    const module = await import('../client/src/analytics') as typeof import('../client/src/analytics') & {
      normalizeEmbeddedLoyaltyMount?: (host: HTMLElement) => HTMLIFrameElement | null;
    };
    expect(module.normalizeEmbeddedLoyaltyMount).toBeTypeOf('function');
    const dom = new JSDOM('<div id="host"><div id="loyalty-widget-button"></div><div id="loyalty-frame-container" style="position:absolute;display:none"><button>close</button><iframe></iframe></div></div>');
    const host = dom.window.document.getElementById('host') as HTMLElement;
    const iframe = module.normalizeEmbeddedLoyaltyMount!(host);
    const container = host.querySelector<HTMLElement>('#loyalty-frame-container');
    expect(host.querySelector('#loyalty-widget-button')).toBeNull();
    expect(container?.querySelector('button')).toBeNull();
    expect(container?.style.position).toBe('relative');
    expect(container?.style.display).toBe('flex');
    expect(container?.style.width).toBe('100%');
    expect(iframe).toBe(container?.querySelector('iframe'));
  });
});
