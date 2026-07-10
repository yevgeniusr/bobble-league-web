#!/usr/bin/env node
import fs from 'node:fs';

const file = process.env.ORIGINAL_EVENTS_JSON || '/Users/mac/Downloads/events4-2.json';
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const records = Array.isArray(raw) ? raw : Object.values(raw);

const counts = new Map();
const typeCounts = new Map();
const powers = new Map();
const formations = new Map();
const ballHeights = [];
const ballVy = [];
const ballAngularSpeed = [];
const ballAngularAbs = { x: [], y: [], z: [] };
const giantHeights = [];
const athleteHeights = [];
const athleteVy = [];
const turns = new Set();
const scores = [];

const inc = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
const stat = values => {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const q = p => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
  return { count: xs.length, min: xs[0], p50: q(0.5), p90: q(0.9), p99: q(0.99), max: xs.at(-1) };
};

function walk(value, visitor) {
  if (Array.isArray(value)) for (const v of value) walk(v, visitor);
  else if (value && typeof value === 'object') {
    visitor(value);
    for (const v of Object.values(value)) walk(v, visitor);
  }
}

for (const rec of records) {
  inc(counts, String(rec.event));
  inc(typeCounts, String(rec.type));
  const ctx = rec?.data?.state?.properties?.cg6GameContext;
  if (!ctx) continue;
  const ball = ctx.Ball;
  if (ball?.CurPhysState?.Position) {
    const y = Number(ball.CurPhysState.Position[1]);
    if (Number.isFinite(y)) {
      ballHeights.push(y);
      if (ball.IsGiant) giantHeights.push(y);
    }
    const vy = Number(ball.CurPhysState.LinearVelocity?.[1]);
    if (Number.isFinite(vy)) ballVy.push(vy);
    const angular = ball.CurPhysState.AngularVelocity;
    if (Array.isArray(angular) && angular.length >= 3) {
      const [x, y, z] = angular.map(Number);
      if ([x, y, z].every(Number.isFinite)) {
        ballAngularSpeed.push(Math.hypot(x, y, z));
        ballAngularAbs.x.push(Math.abs(x));
        ballAngularAbs.y.push(Math.abs(y));
        ballAngularAbs.z.push(Math.abs(z));
      }
    }
  }
  for (const team of ctx.Teams ?? []) {
    if (team.SelectedFormation) inc(formations, team.SelectedFormation);
    if (Number.isFinite(team.Score)) scores.push(team.Score);
    for (const athlete of team.Athletes ?? []) {
      const y = Number(athlete.CurPhysState?.Position?.[1]);
      if (Number.isFinite(y)) athleteHeights.push(y);
      const vy = Number(athlete.CurPhysState?.LinearVelocity?.[1]);
      if (Number.isFinite(vy)) athleteVy.push(vy);
    }
  }
  if (Number.isFinite(ctx.TurnNumber)) turns.add(ctx.TurnNumber);
  walk(ctx, obj => {
    const p = obj.PowerId || obj.HasPowerId || obj.Item2;
    if (typeof p === 'string' && /^[a-z]+$/i.test(p)) inc(powers, p);
  });
}

const objectFrom = map => Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
const result = {
  source: file,
  records: records.length,
  eventCounts: objectFrom(counts),
  messageTypeCounts: objectFrom(typeCounts),
  turns: { count: turns.size, min: Math.min(...turns), max: Math.max(...turns) },
  ballHeight: stat(ballHeights),
  ballVerticalVelocity: stat(ballVy),
  ballAngularSpeed: stat(ballAngularSpeed),
  ballAngularAbsComponents: {
    x: stat(ballAngularAbs.x),
    y: stat(ballAngularAbs.y),
    z: stat(ballAngularAbs.z)
  },
  giantBallHeight: stat(giantHeights),
  athleteHeight: stat(athleteHeights),
  athleteVerticalVelocity: stat(athleteVy),
  powerIds: objectFrom(powers),
  formationIds: objectFrom(formations),
};
console.log(JSON.stringify(result, null, 2));
