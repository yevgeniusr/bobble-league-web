import { describe, expect, it } from 'vitest';
import { TEAM_IDS, TEAMS } from '../shared/types';
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
      logo: '/assets/brand/unicup-logo.png',
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

  it('defines four distinct textured robot teams with bounded gameplay traits', () => {
    expect(TEAM_IDS).toHaveLength(4);
    expect(new Set(Object.values(TEAMS).map(team => team.label)).size).toBe(4);
    expect(new Set(Object.values(TEAMS).map(team => team.crest)).size).toBe(4);
    expect(new Set(Object.values(TEAMS).map(team => team.robot.shape)).size).toBe(4);
    expect(new Set(Object.values(TEAMS).map(team => team.robot.texture)).size).toBe(4);
    for (const team of Object.values(TEAMS)) {
      expect(team.crest).toMatch(/^\/assets\/teams\/.+-robot\.webp$/);
      expect(team.robot.texture).toMatch(/^\/assets\/robots\/.+-surface\.jpg$/);
      expect(team.robot.density).toBeGreaterThanOrEqual(0.85);
      expect(team.robot.density).toBeLessThanOrEqual(1.2);
      expect(team.robot.restitution).toBeGreaterThanOrEqual(0.88);
      expect(team.robot.restitution).toBeLessThanOrEqual(1.12);
      expect(team.robot.trait.length).toBeGreaterThan(20);
      expect(team.lore.length).toBeGreaterThan(30);
      expect('emoji' in team).toBe(false);
    }
  });
});
