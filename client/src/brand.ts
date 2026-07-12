export interface UnicupBrand {
  readonly name: string;
  readonly tagline: string;
  readonly mission: string;
  readonly art: {
    readonly logo: string;
    readonly heroDesktop: string;
    readonly heroMobile: string;
    readonly roadToBallOffice: string;
  };
  readonly principles: readonly string[];
  readonly future: readonly string[];
}

export const UNICUP_BRAND = {
  name: 'Unicup',
  tagline: 'No hands. No weapons. All skill.',
  mission: "Enter Unicap's Universe Cup on PlanetBall, climb the leaderboard, and uncover what waits inside the Ball Office.",
  art: {
    logo: '/assets/brand/unicup-logo.png',
    heroDesktop: '/assets/brand/planetball-hero-desktop.png',
    heroMobile: '/assets/brand/planetball-hero-mobile.png',
    roadToBallOffice: '/assets/brand/road-to-ball-office.png'
  },
  principles: [
    'Cosmetics only. No pay-to-win power.',
    'Every goal is earned through timing, aim, and teamwork.',
    'PlanetBall stays competitive, funny, and fair.'
  ],
  future: [
    'Bigger maps',
    'New abilities',
    'New ball types',
    'New planets',
    'New characters'
  ]
} as const satisfies UnicupBrand;
