import { describe, expect, it } from 'vitest';
import { TEAMS } from '../shared/types';
import { UNICUP_BRAND } from '../client/src/brand';
import { contrastRatio, readableTextColor } from '../client/src/color';

describe('Unicup brand contract', () => {
  it('keeps the canonical name and fair-play promise', () => {
    expect(UNICUP_BRAND.name).toBe('Unicup');
    expect(UNICUP_BRAND.tagline).toBe('No hands. No weapons. All skill.');
    expect(UNICUP_BRAND.principles[0]).toBe('Cosmetics only. No pay-to-win power.');
  });

  it('publishes stable paths for every brand illustration', () => {
    expect(UNICUP_BRAND.art).toEqual({
      heroDesktop: '/assets/brand/planetball-hero-desktop.png',
      heroMobile: '/assets/brand/planetball-hero-mobile.png',
      roadToBallOffice: '/assets/brand/road-to-ball-office.png'
    });
  });

  it('keeps the announced expansion roadmap', () => {
    expect(UNICUP_BRAND.future).toEqual([
      'Bigger maps',
      'New abilities',
      'New ball types',
      'New planets',
      'New characters'
    ]);
  });

  it('uses accessible text over every team color', () => {
    for (const team of Object.values(TEAMS)) {
      expect(contrastRatio(team.primary, readableTextColor(team.primary)), team.label).toBeGreaterThanOrEqual(4.5);
    }
  });
});
