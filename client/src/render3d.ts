import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ARENA_BARRIERS, ARENA_FLOORS, ARENA_WALL_HEIGHT, GOAL_COLLISION_BOTTOM, GOAL_COLLISION_TOP } from '../../shared/arena';
import { ActiveEffect, BOX_TYPES, BUMPERS, FIELD, FieldObjectType, GameState, MAPS, MapId, RAMP_HALF_LEN, RAMP_HALF_WIDTH, ROTATABLE_FIELD_OBJECTS, TEAMS, TeamId, Vec, normalizeMapId } from '../../shared/types';
import { babbleRestHeight, ballRestHeight } from '../../shared/airborne';

export type WorldXZ = { x: number; z: number };
export type PlacingGhost = { type: FieldObjectType; pos: Vec; angle: number };
export type RenderInput = {
  state: GameState;
  you: string;
  drag: { babbleId: string; start: Vec; current: Vec } | null;
  placing?: PlacingGhost | null;
  selectedBabbleId?: string | null;
  targetingBabbles?: boolean;
  // optimistic hold-LMB rotation: pad follows the cursor before the server echoes
  rotatingPad?: { id: string; angle: number } | null;
};

export const TEXT_DRAW_MAX_WIDTH = 440;
export function fitCanvasTextFontSize(requestedPx: number, measuredWidth: number, maxWidth = TEXT_DRAW_MAX_WIDTH) {
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) return requestedPx;
  return Math.max(12, Math.min(requestedPx, requestedPx * maxWidth / measuredWidth));
}

export function fieldToWorld(p: Vec): WorldXZ { return { x: (p.x - FIELD.width / 2) / 50, z: (p.y - FIELD.height / 2) / 50 }; }
export function worldToField(p: WorldXZ): Vec { return { x: p.x * 50 + FIELD.width / 2, y: p.z * 50 + FIELD.height / 2 }; }
export function fieldRadiusToWorld(r: number): number { return r / 50; }
export const BUMPER_WORLD_POSITIONS: WorldXZ[] = BUMPERS.map(fieldToWorld);
export const mapBumperWorldPositions = (mapId: MapId): WorldXZ[] => MAPS[normalizeMapId(mapId)].layout.bumpers.map(fieldToWorld);

export type ArenaSkylineProp = WorldXZ & {
  width: number;
  height: number;
  depth: number;
  visualTop: number;
  office: boolean;
};

export function arenaSkylineLayout(): ArenaSkylineProp[] {
  return [];
}

export function arenaSkylinePositions(): WorldXZ[] {
  return arenaSkylineLayout().map(({ x, z }) => ({ x, z }));
}

export type ResourcePylonProp = WorldXZ & { radius: number };

export function resourcePylonLayout(): ResourcePylonProp[] {
  return [];
}

export function resourcePylonPositions(): WorldXZ[] {
  return resourcePylonLayout().map(({ x, z }) => ({ x, z }));
}

export type RendererCameraLayout = {
  fov: number;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
};

const DESKTOP_CAMERA: RendererCameraLayout = {
  fov: 42,
  position: { x: 0, y: 18, z: 8 },
  target: { x: 0, y: 0.4, z: 0 }
};
const PORTRAIT_CAMERA_POSITION = { x: 12, y: 19, z: 0 } as const;

const FIT_CAMERA_ASPECT = 16 / 10;
const PORTRAIT_CAMERA_ASPECT = 390 / 844;
const PORTRAIT_CAMERA_FOV = 70;

function smoothstep(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

export function arenaCameraFitEnvelope(): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (const barrier of arenaBarrierWorldLayout()) {
    for (const x of [barrier.x - barrier.width / 2, barrier.x + barrier.width / 2]) {
      for (const z of [barrier.z - barrier.depth / 2, barrier.z + barrier.depth / 2]) {
        const visual = arenaBarrierVisualProfile(barrier);
        points.push(new THREE.Vector3(x, TURF_Y, z), new THREE.Vector3(x, TURF_Y + visual.baseHeight + visual.screenHeight, z));
      }
    }
  }
  return points;
}

function cameraDistanceScaleForFit(aspect: number, fov: number, position: THREE.Vector3): number {
  const target = new THREE.Vector3(DESKTOP_CAMERA.target.x, DESKTOP_CAMERA.target.y, DESKTOP_CAMERA.target.z);
  const distance = position.distanceTo(target);
  const forward = target.clone().sub(position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanHalfFov = Math.tan(fov * Math.PI / 360);
  let extraDistance = 0;

  // Moving the camera backward along its view ray only increases view-space
  // depth, so the exact extra distance needed for each envelope point is direct.
  for (const point of arenaCameraFitEnvelope()) {
    const relative = point.clone().sub(position);
    const depth = relative.dot(forward);
    const requiredDepth = Math.max(
      Math.abs(relative.dot(right)) / (0.96 * tanHalfFov * aspect),
      Math.abs(relative.dot(up)) / (0.88 * tanHalfFov)
    );
    extraDistance = Math.max(extraDistance, requiredDepth - depth);
  }

  return Math.max(1, (distance + extraDistance) / distance);
}

export function cameraLayoutForViewport(width: number, height: number): RendererCameraLayout {
  const aspect = Math.max(0.1, width / Math.max(1, height));
  const narrowProgress = smoothstep((FIT_CAMERA_ASPECT - aspect) / (FIT_CAMERA_ASPECT - PORTRAIT_CAMERA_ASPECT));
  const fov = THREE.MathUtils.lerp(DESKTOP_CAMERA.fov, PORTRAIT_CAMERA_FOV, narrowProgress);
  const basePosition = new THREE.Vector3(
    THREE.MathUtils.lerp(DESKTOP_CAMERA.position.x, PORTRAIT_CAMERA_POSITION.x, narrowProgress),
    THREE.MathUtils.lerp(DESKTOP_CAMERA.position.y, PORTRAIT_CAMERA_POSITION.y, narrowProgress),
    THREE.MathUtils.lerp(DESKTOP_CAMERA.position.z, PORTRAIT_CAMERA_POSITION.z, narrowProgress)
  );
  const fullFitScale = cameraDistanceScaleForFit(aspect, fov, basePosition);
  return {
    fov,
    position: {
      x: DESKTOP_CAMERA.target.x + (basePosition.x - DESKTOP_CAMERA.target.x) * fullFitScale,
      y: DESKTOP_CAMERA.target.y + (basePosition.y - DESKTOP_CAMERA.target.y) * fullFitScale,
      z: DESKTOP_CAMERA.target.z + (basePosition.z - DESKTOP_CAMERA.target.z) * fullFitScale
    },
    target: { ...DESKTOP_CAMERA.target }
  };
}

export function babbleContactShadowRadius(radiusField: number): number {
  return fieldRadiusToWorld(radiusField) * 1.16;
}

export function babbleContactBaseMetrics(radiusField: number): { radius: number; topRadius: number; height: number } {
  const radius = fieldRadiusToWorld(radiusField);
  return { radius, topRadius: radius * 0.88, height: 0.16 };
}

export function babbleIndicatorRingRadius(radiusField: number, kind: 'control' | 'target' | 'ghost'): number {
  const radius = fieldRadiusToWorld(radiusField);
  if (kind === 'target') return radius + 0.34;
  if (kind === 'ghost') return radius + 0.28;
  return radius + 0.22;
}

export function bumperVisualRadii(mapId: MapId, powered = false): { collider: number; socket: number; base: number; drum: number; cap: number; dome: number; energyRing: number } {
  const map = MAPS[normalizeMapId(mapId)];
  const collider = fieldRadiusToWorld(powered ? map.layout.bigBumperRadius : map.layout.bumperRadius);
  return {
    collider,
    socket: collider + (powered ? 0.12 : 0.1),
    base: collider + (powered ? 0.08 : 0.04),
    drum: collider * 0.94,
    cap: collider * 0.9,
    dome: collider * 0.46,
    energyRing: collider
  };
}

export function bumperVisualFootprint(mapId: MapId, powered = false): { collider: number; maxRoundBaseRadius: number; rectangularPlateLongestSide: number } {
  const radii = bumperVisualRadii(mapId, powered);
  return {
    collider: radii.collider,
    maxRoundBaseRadius: Math.max(radii.socket, radii.base),
    rectangularPlateLongestSide: 0
  };
}

export function bumperColliderVisualProfile(mapId: MapId, powered = false): { radius: number; height: number; wireframe: true } {
  return {
    radius: bumperVisualRadii(mapId, powered).collider,
    height: ARENA_WALL_HEIGHT,
    wireframe: true
  };
}

export type ArenaBarrierWorld = { id: string; x: number; z: number; width: number; depth: number; height: number; tone: (typeof ARENA_BARRIERS)[number]['tone'] };
export type ArenaFloorWorld = { id: string; x: number; z: number; width: number; depth: number };
export const ARENA_BARRIER_SCREEN_PRIMITIVE = 'lineSegments' as const;
export const ARENA_FRAME_SCREEN_OPACITY = 0.34;
export const ARENA_GOAL_SCREEN_OPACITY = 0.48;

export function arenaBarrierScreenObject(
  geometry: THREE.BufferGeometry,
  material: THREE.LineBasicMaterial,
  primitive: typeof ARENA_BARRIER_SCREEN_PRIMITIVE
): THREE.LineSegments {
  if (primitive !== 'lineSegments') throw new Error(`Unsupported arena barrier primitive: ${primitive}`);
  return new THREE.LineSegments(geometry, material);
}

export function arenaBarrierWorldLayout(): ArenaBarrierWorld[] {
  return ARENA_BARRIERS.map(barrier => {
    const world = fieldToWorld(barrier.center);
    return {
      id: barrier.id,
      x: world.x,
      z: world.z,
      width: fieldRadiusToWorld(barrier.halfSize.x * 2),
      depth: fieldRadiusToWorld(barrier.halfSize.y * 2),
      height: barrier.height,
      tone: barrier.tone
    };
  });
}

export function arenaFloorWorldLayout(): ArenaFloorWorld[] {
  return ARENA_FLOORS.map(floor => {
    const world = fieldToWorld(floor.center);
    return {
      id: floor.id,
      x: world.x,
      z: world.z,
      width: fieldRadiusToWorld(floor.halfSize.x * 2),
      depth: fieldRadiusToWorld(floor.halfSize.y * 2)
    };
  });
}

export function arenaBarrierVisualProfile(barrier: ArenaBarrierWorld): { baseHeight: number; screenHeight: number; primitive: typeof ARENA_BARRIER_SCREEN_PRIMITIVE } {
  const baseHeight = Math.min(0.36, barrier.height);
  return {
    baseHeight,
    screenHeight: Math.max(0, Math.min(1.14, barrier.height - baseHeight)),
    primitive: ARENA_BARRIER_SCREEN_PRIMITIVE
  };
}

export function robotVisualProfile(teamId: TeamId) {
  const robot = TEAMS[teamId].robot;
  return {
    shape: robot.shape,
    texture: robot.texture,
    width: robot.width,
    depth: robot.depth,
    height: robot.height,
    motion: robot.motion,
    smoothness: robot.smoothness,
    bodyGeometry: robot.shape === 'block' ? 'roundedBox' : robot.shape === 'wedge' ? 'rampWedge' : robot.shape === 'orb' ? 'sphere' : 'ring',
    baseGeometry: robot.motion === 'rotatingBase' ? 'rotor' : 'driveRing'
  };
}

export function goalVisualMetrics(): { leftGoalLineX: number; rightGoalLineX: number; mouthTopZ: number; mouthBottomZ: number; mouthHalfHeight: number; collisionTopZ: number; collisionBottomZ: number; collisionHalfHeight: number; depth: number; pocketFloorDepth: number; pocketFloorWidth: number; sideWallLength: number } {
  const mouthTopZ = fieldToWorld({ x: 0, y: FIELD.goalY }).z;
  const mouthBottomZ = fieldToWorld({ x: 0, y: FIELD.goalY + FIELD.goalHeight }).z;
  const collisionTopZ = fieldToWorld({ x: 0, y: GOAL_COLLISION_TOP }).z;
  const collisionBottomZ = fieldToWorld({ x: 0, y: GOAL_COLLISION_BOTTOM }).z;
  return {
    leftGoalLineX: -FIELD_X / 2,
    rightGoalLineX: FIELD_X / 2,
    mouthTopZ,
    mouthBottomZ,
    mouthHalfHeight: (mouthBottomZ - mouthTopZ) / 2,
    collisionTopZ,
    collisionBottomZ,
    collisionHalfHeight: (collisionBottomZ - collisionTopZ) / 2,
    depth: fieldRadiusToWorld(FIELD.goalDepth),
    pocketFloorDepth: fieldRadiusToWorld(FIELD.goalDepth),
    pocketFloorWidth: collisionBottomZ - collisionTopZ,
    sideWallLength: fieldRadiusToWorld(FIELD.goalDepth)
  };
}

// Deterministic ball rotation from the authoritative spin state so the visual
// roll always matches travel direction (field x -> world x, field y -> world z).
export function ballSpinToRotation(spin: Vec): { x: number; z: number } {
  return { x: spin.y, z: -spin.x };
}

export function authoritativeBallQuaternion(ball: { rotation?: { x: number; y: number; z: number; w: number } }): { x: number; y: number; z: number; w: number } | null {
  const q = ball.rotation;
  if (!q || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) return null;
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < 1e-8) return null;
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

export function ballVisualProfile(lowPower: boolean) {
  return {
    surface: 'proceduralTexture' as const,
    geometricPatches: false,
    seamRings: false,
    blobShadow: lowPower
  };
}

export function ballRenderElevation(ball: { radius: number; height?: number }): {
  centerYAboveTurf: number;
  shadowYAboveTurf: number;
  shadowRadius: number;
  shadowOpacity: number;
} {
  const rest = ballRestHeight(ball.radius);
  // Render the authoritative Rapier height without an artificial ceiling.
  const height = Number.isFinite(ball.height) ? Math.max(rest, ball.height!) : rest;
  const separation = Math.max(0, height - rest);
  const r = fieldRadiusToWorld(ball.radius);
  return {
    centerYAboveTurf: height,
    shadowYAboveTurf: 0.025,
    shadowRadius: r * (1.12 + Math.min(0.55, separation * 0.22)),
    shadowOpacity: Math.max(0.04, 0.16 - separation * 0.065)
  };
}

// True rolling: incremental rotation about the axis perpendicular to travel.
// Given the field-space delta the ball moved and its world radius, returns the
// normalized world-space roll axis and the angle (distance / radius).
export function rollDelta(deltaField: Vec, radiusWorld: number): { axis: { x: number; y: number; z: number }; angle: number } {
  const dx = deltaField.x / 50, dz = deltaField.y / 50;
  const distW = Math.hypot(dx, dz);
  if (distW < 1e-6 || radiusWorld <= 0) return { axis: { x: 1, y: 0, z: 0 }, angle: 0 };
  // rolling axis = up × direction = (0,1,0) × (dx,0,dz)/dist = (dz, 0, -dx)/dist
  return { axis: { x: dz / distW, y: 0, z: -dx / distW }, angle: distW / radiusWorld };
}

// Teleports (goal reset, Move Ball) larger than this skip the roll animation.
export const ROLL_TELEPORT_FIELD_DIST = 180;

// Ghosted power play: the whole babble renders translucent so everyone can see
// it phases through other babbleheads, plus a pulsing ghost aura and label.
export const GHOST_OPACITY = 0.38;
export function babbleGhosted(effects: readonly ActiveEffect[] | undefined, turn: number): boolean {
  return !!effects?.some(e => e.type === 'ghosted' && e.untilTurn >= turn);
}


export const GOAL_COLORS = { left: 0x3152c9, right: 0xf16655 } as const;
export function goalDisplayColors(swapped: boolean): { left: number; right: number } {
  return swapped ? { left: GOAL_COLORS.right, right: GOAL_COLORS.left } : { left: GOAL_COLORS.left, right: GOAL_COLORS.right };
}

// Probe the real GL renderer string on a throwaway context. CPU rasterizers
// (SwiftShader in headless Chromium, llvmpipe/softpipe on GPU-less Linux)
// render this scene at seconds-per-frame, which would block the main thread;
// callers use this to pick a cheap quality profile instead.
export function detectSoftwareWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(
      (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || ''
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

const FIELD_X = FIELD.width / 50;
const FIELD_Z = FIELD.height / 50;
const TURF_Y = 1.02;
const PLANETBALL = {
  signal: 0xffda36,
  cobalt: 0x3152c9,
  coral: 0xf16655,
  aqua: 0x2cc7c1,
  white: 0xfffdf5,
  charcoal: 0x22252e
} as const;
const toV3 = (p: Vec, y = 0) => { const w = fieldToWorld(p); return new THREE.Vector3(w.x, y, w.z); };
const hashId = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) / 4294967295; };

export class BabbleLeague3DRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TURF_Y);
  private textCache = new Map<string, THREE.Texture>();
  private imageLoads = new Set<string>();
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.Material>();
  private board = new THREE.Group();
  private dynamic = new THREE.Group();
  private goalTint: Record<'left' | 'right', THREE.MeshStandardMaterial[]> = { left: [], right: [] };
  private goalLineTint: Record<'left' | 'right', THREE.LineBasicMaterial[]> = { left: [], right: [] };
  private boardMapId: MapId | null = null;
  // persistent rolling state so the ball markings physically roll with travel
  private ballQuat = new THREE.Quaternion();
  private lastBallPos: Vec | null = null;

  // True when WebGL is CPU-rasterized (SwiftShader/llvmpipe/Mesa soft — e.g.
  // headless browsers or GPU-less machines). Full-quality frames there take
  // seconds and starve React/input, so we drop to a lightweight profile.
  readonly lowPower: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    this.lowPower = detectSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowPower, preserveDrawingBuffer: true, alpha: true });
    this.renderer.shadowMap.enabled = !this.lowPower;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(this.lowPower ? 0.5 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(MAPS.stadium.theme.sky, 0);
    this.scene.fog = new THREE.Fog(MAPS.stadium.theme.fog, 34, 70);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.camera.position.set(DESKTOP_CAMERA.position.x, DESKTOP_CAMERA.position.y, DESKTOP_CAMERA.position.z);
    this.camera.lookAt(0, 0.4, 0);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(PLANETBALL.white, PLANETBALL.cobalt, 1.9));
    const sun = new THREE.DirectionalLight(PLANETBALL.white, 3.1);
    sun.position.set(-6, 15, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16; sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13;
    sun.shadow.bias = -0.0001;
    sun.shadow.normalBias = 0.025;
    sun.shadow.intensity = 0.42;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(PLANETBALL.aqua, 0.7);
    fill.position.set(7, 9, -11);
    this.scene.add(fill);
    this.scene.add(this.board);
    this.scene.add(this.dynamic);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.clearDynamic();
    this.clearBoard();
    for (const t of this.textCache.values()) t.dispose();
    for (const g of this.geoCache.values()) g.dispose();
    for (const m of this.matCache.values()) m.dispose();
    this.renderer.dispose();
  }

  private resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || window.innerWidth);
    const h = Math.max(180, rect.height || window.innerHeight);
    const layout = cameraLayoutForViewport(w, h);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = layout.fov;
    this.camera.position.set(layout.position.x, layout.position.y, layout.position.z);
    this.camera.lookAt(layout.target.x, layout.target.y, layout.target.z);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  };

  pointFromClient(clientX: number, clientY: number): Vec | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const hit = new THREE.Vector3();
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, hit) ? worldToField({ x: hit.x, z: hit.z }) : null;
  }

  /** Pick the visible babble, not the turf beneath it. Screen-space picking
   * keeps players in roofless goal pockets selectable even when a box or pad
   * occupies the same field coordinate. */
  babbleFromClient(state: GameState, clientX: number, clientY: number, allowedIds?: readonly string[]): GameState['babbles'][number] | null {
    const rect = this.canvas.getBoundingClientRect();
    let best: { babble: GameState['babbles'][number]; distance: number } | null = null;
    for (const babble of state.babbles) {
      if (allowedIds && !allowedIds.includes(babble.id)) continue;
      const w = fieldToWorld(babble.pos);
      const height = Number.isFinite(babble.height) ? babble.height : babbleRestHeight(babble.radius);
      const hop = Math.max(0, height - babbleRestHeight(babble.radius));
      const player = Object.values(state.players).find(p => p.side === babble.side && p.controlledBabbleIds.includes(babble.id));
      const robot = TEAMS[player?.team ?? state.sideTeams[babble.side] ?? 'pigs'].robot;
      const projected = new THREE.Vector3(w.x, TURF_Y + robot.height * 0.55 + hop, w.z).project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const sx = rect.left + (projected.x + 1) * rect.width / 2;
      const sy = rect.top + (1 - projected.y) * rect.height / 2;
      const distance = Math.hypot(clientX - sx, clientY - sy);
      const hitRadius = Math.max(24, fieldRadiusToWorld(babble.radius) * rect.width / FIELD_X * 2.4);
      if (distance <= hitRadius && (!best || distance < best.distance)) best = { babble, distance };
    }
    return best?.babble ?? null;
  }

  render({ state, you, drag, placing, selectedBabbleId, targetingBabbles, rotatingPad }: RenderInput) {
    const mapId = normalizeMapId(state.mapId);
    this.ensureBoard(mapId);
    this.clearDynamic();
    this.buildHud(state);
    this.applyGoalSwap(state);
    const mySide = state.players[you]?.side;
    for (const obj of state.fieldObjects) {
      if (obj.untilTurn < state.turn) continue;
      const angle = rotatingPad?.id === obj.id ? rotatingPad.angle : obj.angle;
      this.addFieldObject(obj.type, obj.pos, angle);
      // hold-LMB rotation affordance on your own live pads during planning
      if (state.phase === 'planning' && obj.owner === mySide && ROTATABLE_FIELD_OBJECTS.includes(obj.type)) {
        this.addRotateAffordance(obj.pos, rotatingPad?.id === obj.id);
      }
    }
    for (const box of state.boxes) this.addPowerBox(box.pos, BOX_TYPES[box.type].color);
    for (const b of state.babbles) this.addBabble(b, state, you, selectedBabbleId, targetingBabbles);
    this.addBall(state);
    this.addBumperFx(state);
    this.addRampFx(state);
    if (state.phase === 'planning') this.addCommittedIntents(state, you, drag?.babbleId);
    if (drag) this.addAimAffordance(state, drag);
    if (placing) this.addFieldObject(placing.type, placing.pos, placing.angle, true);
    this.renderer.render(this.scene, this.camera);
  }

  // -- caches -----------------------------------------------------------
  private geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geoCache.get(key); if (!g) { g = make(); this.geoCache.set(key, g); } return g as T;
  }
  private mat(color: number | string, roughness = 0.5, opts: { flat?: boolean; transparent?: boolean; opacity?: number; emissive?: number } = {}) {
    const key = `${color}|${roughness}|${opts.flat ? 1 : 0}|${opts.opacity ?? 1}|${opts.emissive ?? 0}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color), roughness, metalness: 0.03, flatShading: !!opts.flat,
        transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
        emissive: new THREE.Color(opts.emissive ?? 0), emissiveIntensity: opts.emissive ? 0.55 : 0
      });
      this.matCache.set(key, m);
    }
    return m as THREE.MeshStandardMaterial;
  }
  // cached textured materials (created once, reused every frame, disposed on teardown)
  private texturedMat(key: string, make: () => THREE.Material) {
    let m = this.matCache.get(key);
    if (!m) { m = make(); this.matCache.set(key, m); }
    return m;
  }
  private imageTexture(url: string) {
    const key = `image:${url}`;
    const existing = this.textCache.get(key);
    if (existing) return existing;
    if (!this.imageLoads.has(key)) {
      this.imageLoads.add(key);
      new THREE.TextureLoader().load(url, texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.lowPower ? 1 : 4;
        // Generated arena art is deliberately not constrained to power-of-two
        // dimensions. Avoid driver-specific mipmap failures on mobile GPUs and
        // SwiftShader, both of which otherwise present a black surface.
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        this.textCache.set(key, texture);
        if (url.startsWith('/assets/maps/')) this.boardMapId = null;
      }, undefined, () => this.imageLoads.delete(key));
    }
    return null;
  }
  private imageSprite(url: string) {
    const texture = this.imageTexture(url);
    if (!texture) return null;
    const material = this.texturedMat(`imageSprite:${url}`, () => new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })) as THREE.SpriteMaterial;
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 25;
    return sprite;
  }
  private clearGroup(group: THREE.Group) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of mats) materials.add(material);
    });
    for (const geometry of geometries) if (!this.geoCacheHas(geometry)) geometry.dispose();
    for (const material of materials) {
      if (this.matCacheHas(material)) continue;
      const texture = (material as THREE.Material & { map?: THREE.Texture | null }).map;
      if (texture && !this.texCacheHas(texture)) texture.dispose();
      material.dispose();
    }
    group.clear();
  }
  private clearDynamic() { this.clearGroup(this.dynamic); }
  private clearBoard() { this.clearGroup(this.board); }
  private geoCacheHas(g: THREE.BufferGeometry) { for (const v of this.geoCache.values()) if (v === g) return true; return false; }
  private matCacheHas(m: THREE.Material) { for (const v of this.matCache.values()) if (v === m) return true; return false; }
  private texCacheHas(t: THREE.Texture) { for (const v of this.textCache.values()) if (v === t) return true; return false; }

  private mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, cast = false) {
    const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
  }

  // -- static arena -----------------------------------------------------
  private ensureBoard(mapId: MapId) {
    if (this.boardMapId === mapId) return;
    this.clearBoard();
    this.goalTint = { left: [], right: [] };
    this.goalLineTint = { left: [], right: [] };
    const theme = MAPS[mapId].theme;
    this.renderer.setClearColor(theme.sky, 0);
    this.scene.fog = new THREE.Fog(theme.fog, mapId === 'moon' ? 42 : 34, mapId === 'volcano' ? 62 : 70);
    this.buildBoard(mapId);
    this.boardMapId = mapId;
  }

  private buildBoard(mapId: MapId) {
    const g = this.board;
    const map = MAPS[mapId];
    const theme = map.theme;
    const fieldFloor = arenaFloorWorldLayout().find(floor => floor.id === 'field');
    if (!fieldFloor) throw new Error('Shared arena is missing its field floor');
    // Only the playable floor is modeled. The generated court art reaches the
    // edge, and the narrow collision rim below replaces the former giant deck.
    this.mesh(
      g,
      this.geo('arenaFloorSlab:field', () => new THREE.BoxGeometry(fieldFloor.width, 0.24, fieldFloor.depth)),
      this.mat(theme.fieldBase, 0.85),
      fieldFloor.x,
      0.82,
      fieldFloor.z
    );
    const fieldTexture = this.imageTexture(map.art.fieldTexture) ?? this.turfTexture(mapId);
    const turfMat = this.texturedMat(`turfSurface:${mapId}:${fieldTexture === this.textCache.get(`image:${map.art.fieldTexture}`) ? 'art' : 'fallback'}`, () => new THREE.MeshStandardMaterial({ map: fieldTexture, roughness: 0.88, metalness: 0.02, emissive: new THREE.Color(mapId === 'volcano' ? 0x180604 : 0x000000), emissiveIntensity: mapId === 'volcano' ? 0.25 : 0 }));
    const turf = new THREE.Mesh(this.geo('arenaFloorTurf:field', () => new THREE.PlaneGeometry(fieldFloor.width, fieldFloor.depth)), turfMat);
    turf.rotation.x = -Math.PI / 2;
    turf.position.set(fieldFloor.x, TURF_Y, fieldFloor.z);
    turf.receiveShadow = true;
    g.add(turf);
    this.addArenaBarriers(mapId);
    this.addGoal(-1, mapId); this.addGoal(1, mapId);
    // Every bumper remains aligned with the authoritative physics colliders.
    for (const w of mapBumperWorldPositions(mapId)) this.addBumper(w.x, w.z, mapId);
  }

  private addArenaBarriers(mapId: MapId) {
    const theme = MAPS[mapId].theme;
    const materials = new Map<string, { base: THREE.MeshStandardMaterial; screen: THREE.LineBasicMaterial }>();
    const forTone = (tone: ArenaBarrierWorld['tone']) => {
      const cached = materials.get(tone);
      if (cached) return cached;
      const side = tone === 'leftGoal' ? 'left' : tone === 'rightGoal' ? 'right' : null;
      const color = side === 'left' ? theme.leftGoal : side === 'right' ? theme.rightGoal : theme.plinth;
      const cacheKey = `arenaBarrier:${mapId}:${tone}`;
      const material = <T extends THREE.Material>(suffix: string, make: () => T): T => {
        const existing = this.matCache.get(`${cacheKey}:${suffix}`) as T | undefined;
        if (existing) return existing;
        const created = make();
        this.matCache.set(`${cacheKey}:${suffix}`, created);
        return created;
      };
      const set = {
        base: material('base', () => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05 })),
        screen: material('screen', () => new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: side ? ARENA_GOAL_SCREEN_OPACITY : ARENA_FRAME_SCREEN_OPACITY,
          depthWrite: false
        }))
      };
      if (side) {
        if (!this.goalTint[side].includes(set.base)) this.goalTint[side].push(set.base);
        if (!this.goalLineTint[side].includes(set.screen)) this.goalLineTint[side].push(set.screen);
      }
      materials.set(tone, set);
      return set;
    };

    for (const barrier of arenaBarrierWorldLayout()) {
      const mat = forTone(barrier.tone);
      const visual = arenaBarrierVisualProfile(barrier);
      const baseGeometry = this.geo(`arenaBarrierBase:${barrier.id}`, () => new THREE.BoxGeometry(barrier.width, visual.baseHeight, barrier.depth));
      this.mesh(this.board, baseGeometry, mat.base, barrier.x, TURF_Y + visual.baseHeight / 2, barrier.z, true);
      const screenGeometry = this.geo(`arenaBarrierScreen:${barrier.id}`, () => {
        const box = new THREE.BoxGeometry(barrier.width, visual.screenHeight, barrier.depth);
        const edges = new THREE.EdgesGeometry(box);
        box.dispose();
        return edges;
      });
      const screen = arenaBarrierScreenObject(screenGeometry, mat.screen, visual.primitive);
      screen.position.set(barrier.x, TURF_Y + visual.baseHeight + visual.screenHeight / 2, barrier.z);
      this.board.add(screen);
    }
  }

  private addTournamentExterior(mapId: MapId) {
    const g = this.board;
    const theme = MAPS[mapId].theme;
    const skyline = arenaSkylineLayout();
    const pylons = resourcePylonLayout();
    const block = this.geo('planetBallSkylineBlock', () => new THREE.BoxGeometry(1, 1, 1));
    const trim = this.geo('planetBallSkylineTrim', () => new THREE.BoxGeometry(1, 0.16, 1.06));
    const windowGeo = this.geo('planetBallOfficeWindow', () => new THREE.BoxGeometry(0.42, 0.34, 0.06));

    if (this.lowPower) {
      const office = skyline.find(prop => prop.office)!;
      const building = this.mesh(g, block, this.mat(PLANETBALL.cobalt, 0.78, { flat: true }), office.x, office.height / 2 - 0.15, office.z);
      building.scale.set(office.width, office.height, office.depth);
      const officeSign = this.text('BALL OFFICE', 28, '#fffdf5');
      officeSign.position.set(office.x, office.height - 0.8, office.z + office.depth / 2 + 0.1);
      officeSign.scale.multiplyScalar(1.45);
      g.add(officeSign);
      const simplePylon = this.geo('resourcePylonLow', () => new THREE.CylinderGeometry(0.18, pylons[0].radius, 1.35, 6));
      pylons.forEach((position, index) => {
        if (index % 2 === 0) this.mesh(g, simplePylon, this.mat(PLANETBALL.coral, 0.5, { flat: true }), position.x, 1.52, position.z);
      });
      const broadcast = this.text(`UNICAP // ${MAPS[mapId].shortLabel.toUpperCase()}`, 24, '#fffdf5');
      broadcast.position.set(0, 2.08, -FIELD_Z / 2 - 0.56);
      broadcast.scale.multiplyScalar(1.35);
      g.add(broadcast);
      return;
    }

    skyline.forEach((position, index) => {
      const { office, height, width, depth } = position;
      const color = office ? PLANETBALL.cobalt : index % 2 ? PLANETBALL.coral : PLANETBALL.charcoal;
      const building = this.mesh(g, block, this.mat(color, 0.78, { flat: true }), position.x, height / 2 - 0.15, position.z, !this.lowPower);
      building.scale.set(width, height, depth);
      const roofBand = this.mesh(g, trim, this.mat(office ? PLANETBALL.signal : PLANETBALL.white, 0.62, { flat: true }), position.x, height - 0.18, position.z, !this.lowPower);
      roofBand.scale.set(width + 0.22, 1, depth + 0.08);

      if (office) {
        for (const x of [-1.65, -0.82, 0, 0.82, 1.65]) {
          this.mesh(g, windowGeo, this.mat(PLANETBALL.aqua, 0.28, { emissive: 0x0c4d54 }), position.x + x, height * 0.55, position.z + depth / 2 + 0.04);
        }
        const door = this.mesh(g, block, this.mat(PLANETBALL.coral, 0.58, { flat: true }), position.x, 0.55, position.z + depth / 2 + 0.05);
        door.scale.set(0.72, 1.4, 0.08);
        const sign = this.text('BALL OFFICE', 28, '#fffdf5');
        sign.position.set(position.x, height - 0.8, position.z + depth / 2 + 0.1);
        sign.scale.multiplyScalar(1.45);
        g.add(sign);
      } else {
        for (const y of [0.65, 1.15, 1.65].filter(y => y < height - 0.35)) {
          this.mesh(g, windowGeo, this.mat(index % 2 ? PLANETBALL.white : PLANETBALL.aqua, 0.34), position.x, y, position.z + depth / 2 + 0.04);
        }
      }

      const beaconY = position.visualTop - 0.16;
      const mastHeight = beaconY - height + 0.12;
      const mast = this.mesh(g, this.geo('planetBallBroadcastMast', () => new THREE.CylinderGeometry(0.055, 0.075, 0.77, 8)), this.mat(PLANETBALL.charcoal, 0.5), position.x, height + (beaconY - height) / 2, position.z, false);
      mast.scale.y = mastHeight / 0.77;
      mast.castShadow = false;
      const beacon = this.mesh(g, this.geo('planetBallBroadcastBeacon', () => new THREE.SphereGeometry(0.16, 10, 6)), this.mat(index % 2 ? PLANETBALL.aqua : PLANETBALL.signal, 0.32, { emissive: index % 2 ? 0x0c4d54 : 0x6b5100 }), position.x, beaconY, position.z);
      beacon.castShadow = false;
    });

    const pylonBody = this.geo('resourcePylonBody', () => new THREE.CylinderGeometry(0.18, pylons[0].radius, 1.35, 10));
    const pylonCore = this.geo('resourcePylonCore', () => new THREE.CylinderGeometry(0.09, 0.09, 0.92, 10));
    const pylonCap = this.geo('resourcePylonCap', () => new THREE.OctahedronGeometry(0.26, 0));
    pylons.forEach((position, index) => {
      const bodyColor = index % 2 ? theme.leftGoal : theme.rightGoal;
      this.mesh(g, pylonBody, this.mat(bodyColor, 0.46, { flat: true }), position.x, 1.52, position.z, !this.lowPower);
      this.mesh(g, pylonCore, this.mat(PLANETBALL.aqua, 0.26, { emissive: 0x0c4d54 }), position.x, 1.62, position.z);
      this.mesh(g, pylonCap, this.mat(PLANETBALL.signal, 0.3, { flat: true, emissive: 0x5a4300 }), position.x, 2.38, position.z, !this.lowPower);
    });

    const broadcast = this.text(`UNICAP // ${MAPS[mapId].shortLabel.toUpperCase()}`, 24, '#fffdf5');
    broadcast.position.set(0, 2.08, -FIELD_Z / 2 - 0.56);
    broadcast.scale.multiplyScalar(1.35);
    g.add(broadcast);
  }

  private addGoal(side: -1 | 1, mapId: MapId) {
    const g = this.board;
    const theme = MAPS[mapId].theme;
    const key = side < 0 ? 'left' : 'right';
    const col = key === 'left' ? theme.leftGoal : theme.rightGoal;
    const metrics = goalVisualMetrics();
    const x = side < 0 ? metrics.leftGoalLineX : metrics.rightGoalLineX;
    const halfGoal = metrics.mouthHalfHeight;
    const pocketFloor = arenaFloorWorldLayout().find(floor => floor.id === `${key}-goal-pocket`);
    if (!pocketFloor) throw new Error(`Shared arena is missing its ${key} goal floor`);
    const pocketHalf = pocketFloor.depth / 2;
    const depth = pocketFloor.width;
    const backX = x + side * depth;
    // dedicated tintable materials so Swap Goals can visibly recolor the gates
    const frameTint = this.texturedMat(`goalFrame:${mapId}:${key}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.32, metalness: 0.06 })) as THREE.MeshStandardMaterial;
    const mouthTint = this.texturedMat(`goalMouth:${mapId}:${key}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.55, metalness: 0.03, transparent: true, opacity: 0.46 })) as THREE.MeshStandardMaterial;
    this.goalTint[key].push(frameTint, mouthTint);
    // The floor line is the scoring aperture. The surrounding cage is rendered
    // separately from the exact shared collider rectangles.
    const mouth = this.mesh(g, new THREE.BoxGeometry(0.12, 0.05, halfGoal * 2), mouthTint, x, TURF_Y + 0.03, 0);
    mouth.receiveShadow = false;
    // Extend the board and textured turf through the complete physical pocket.
    // A goalie therefore remains visibly supported after crossing the line.
    this.mesh(
      g,
      this.geo('arenaFloorSlab:goal-pocket', () => new THREE.BoxGeometry(pocketFloor.width, 0.24, pocketFloor.depth)),
      this.mat(theme.fieldBase, 0.85),
      pocketFloor.x,
      0.82,
      pocketFloor.z
    );
    const pocketTurf = new THREE.Mesh(
      this.geo('arenaFloorTurf:goal-pocket', () => new THREE.PlaneGeometry(pocketFloor.width, pocketFloor.depth)),
      this.matCache.get(`turfSurface:${mapId}`)!
    );
    pocketTurf.rotation.x = -Math.PI / 2;
    pocketTurf.position.set(pocketFloor.x, TURF_Y + 0.002, pocketFloor.z);
    pocketTurf.receiveShadow = true;
    g.add(pocketTurf);
    // inward chevrons mark the trigger line without implying circular physics.
    for (const zOff of [-halfGoal * 0.55, 0, halfGoal * 0.55]) {
      const chev = new THREE.Mesh(this.geo('goalChevron', () => new THREE.ConeGeometry(0.22, 0.5, 4)), frameTint);
      chev.position.set(x - side * 0.52, TURF_Y + 0.07, zOff);
      chev.rotation.set(0, Math.PI / 4, side * -Math.PI / 2);
      chev.castShadow = false;
      g.add(chev);
    }
    if (theme.gateStyle === 'sciFi') {
      for (const y of [1.28, 2.62]) {
        this.mesh(g, new THREE.BoxGeometry(0.08, 0.08, pocketHalf * 1.8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65 }), backX - side * 0.04, y, 0);
      }
    } else if (theme.gateStyle === 'volcanic') {
      for (const s of [-1, 1] as const) {
        const spike = this.mesh(g, new THREE.ConeGeometry(0.24, 0.72, 6), this.mat(0x1f0b08, 0.7, { flat: true, emissive: 0x3b1006 }), backX - side * 0.12, 3.15, s * pocketHalf * 0.82, true);
        spike.rotation.x = Math.PI;
      }
    } else if (theme.gateStyle === 'orbital') {
      for (const s of [-1, 1] as const) {
        const orbit = new THREE.Mesh(this.geo('goalOrbitalPostRing', () => new THREE.TorusGeometry(0.42, 0.035, 8, 40)), frameTint);
        orbit.position.set(backX, 1.78, s * pocketHalf * 0.82);
        orbit.rotation.y = Math.PI / 2;
        orbit.castShadow = true;
        g.add(orbit);
      }
      const mouthOrbit = new THREE.Mesh(this.geo('goalOrbitalMouthRing', () => new THREE.TorusGeometry(1, 0.025, 8, 64)), mouthTint);
      mouthOrbit.position.set(backX - side * 0.04, TURF_Y + 0.08, 0);
      mouthOrbit.rotation.y = Math.PI / 2;
      mouthOrbit.scale.set(halfGoal * 0.16, halfGoal * 0.82, halfGoal * 0.82);
      mouthOrbit.castShadow = false;
      g.add(mouthOrbit);
    }
  }

  // Swap Goals power play: recolor the gates while active so everyone can see
  // which direction currently scores, plus rectangular mouth highlights and a
  // center banner. The effect follows the goal mouth/back-wall footprint.
  private applyGoalSwap(state: GameState) {
    const swapped = state.swappedGoalsUntilTurn !== null && state.swappedGoalsUntilTurn >= state.turn;
    const theme = MAPS[normalizeMapId(state.mapId)].theme;
    const cols = swapped
      ? { left: theme.rightGoal, right: theme.leftGoal }
      : { left: theme.leftGoal, right: theme.rightGoal };
    for (const m of this.goalTint.left) { m.color.setHex(cols.left); m.emissive.setHex(swapped ? cols.left : 0x000000); m.emissiveIntensity = swapped ? 0.45 : 0; }
    for (const m of this.goalTint.right) { m.color.setHex(cols.right); m.emissive.setHex(swapped ? cols.right : 0x000000); m.emissiveIntensity = swapped ? 0.45 : 0; }
    for (const m of this.goalLineTint.left) m.color.setHex(cols.left);
    for (const m of this.goalLineTint.right) m.color.setHex(cols.right);
    if (!swapped) return;
    const t = performance.now() / 1000;
    const metrics = goalVisualMetrics();
    const halfGoal = metrics.mouthHalfHeight;
    const pocketHalf = metrics.collisionHalfHeight;
    const pulse = 0.54 + Math.sin(t * 5) * 0.22;
    for (const side of [-1, 1] as const) {
      const lineX = side < 0 ? metrics.leftGoalLineX : metrics.rightGoalLineX;
      const color = side < 0 ? cols.left : cols.right;
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: pulse, depthWrite: false });
      this.mesh(this.dynamic, this.geo('goalSwapMouthStrip', () => new THREE.BoxGeometry(0.1, 0.08, 1)), mat, lineX, TURF_Y + 0.09, 0).scale.z = halfGoal * 2;
      this.mesh(this.dynamic, this.geo('goalSwapBackStrip', () => new THREE.BoxGeometry(0.08, 0.08, 1)), mat, lineX + side * metrics.depth, TURF_Y + 0.13, 0).scale.z = pocketHalf * 2;
      for (const z of [metrics.collisionTopZ, metrics.collisionBottomZ] as const) {
        this.mesh(this.dynamic, this.geo('goalSwapSideStrip', () => new THREE.BoxGeometry(1, 0.06, 0.08)), mat, lineX + side * metrics.depth / 2, TURF_Y + 0.11, z).scale.x = metrics.depth;
      }
    }
    const banner = this.text('GOALS SWAPPED!', 40, '#ffda36');
    banner.position.set(0, 3.4, 0);
    banner.scale.multiplyScalar(1.2);
    this.dynamic.add(banner);
  }

  private addBumper(x: number, z: number, mapId: MapId) {
    const g = this.board;
    const theme = MAPS[mapId].theme;
    const radii = bumperVisualRadii(mapId, false);
    const sx = Math.sign(x) || 1;
    const sz = Math.sign(z) || 1;
    const colliderVisual = bumperColliderVisualProfile(mapId, false);
    const colliderMaterial = this.texturedMat(`bumperCollider:${mapId}:normal`, () => new THREE.LineBasicMaterial({
      color: theme.bumperCap,
      transparent: true,
      opacity: 0.32,
      depthWrite: false
    }));
    const collider = new THREE.LineSegments(
      this.geo(`bumperCollider:${mapId}:normal`, () => this.bumperColliderOutlineGeometry(colliderVisual.radius, colliderVisual.height)),
      colliderMaterial
    );
    collider.position.set(x, TURF_Y + colliderVisual.height / 2, z);
    g.add(collider);
    // Round contact socket only: rectangular plates read as stray artifacts
    // around circular bumpers, especially near the corner rim.
    this.mesh(g, this.geo(`bumperSocket:${mapId}`, () => new THREE.CylinderGeometry(radii.socket, radii.socket, 0.14, 48)), this.mat(theme.bumperCap, 0.42), x, 1.08, z, true);
    this.mesh(g, this.geo(`bumperBase:${mapId}`, () => new THREE.CylinderGeometry(radii.base, radii.base, 0.18, 48)), this.mat(theme.bumperBase, 0.55), x, 1.14, z, true);
    this.mesh(g, this.geo(`bumperCollar:${mapId}`, () => new THREE.CylinderGeometry(radii.collider * 0.92, radii.base, 0.28, 44)), this.mat(theme.frameDark, 0.5), x, 1.24, z, true);
    this.mesh(g, this.geo(`bumperDrum:${mapId}`, () => new THREE.CylinderGeometry(radii.drum * 0.94, radii.drum, 0.42, 44)), this.mat(theme.bumperDrum, 0.4, { emissive: mapId === 'moon' ? 0x12334a : mapId === 'volcano' ? 0x54140c : 0 }), x, 1.56, z, true);
    this.mesh(g, this.geo(`bumperCap:${mapId}`, () => new THREE.CylinderGeometry(radii.cap, radii.cap, 0.1, 44)), this.mat(theme.plinth, 0.35), x, 1.8, z, true);
    this.mesh(g, this.geo(`bumperDome:${mapId}`, () => new THREE.SphereGeometry(radii.dome, 28, 16)), this.mat(theme.bumperCap, 0.3, { emissive: mapId === 'volcano' ? 0x7a2e08 : 0x12304a }), x, 1.9, z, true);
    const rimRing = new THREE.Mesh(this.geo(`bumperSocketRing:${mapId}`, () => new THREE.TorusGeometry(1, 0.035, 8, 48)), this.mat(theme.frameDark, 0.42));
    rimRing.position.set(x, TURF_Y + 0.08, z);
    rimRing.rotation.x = Math.PI / 2;
    rimRing.scale.setScalar(radii.socket);
    g.add(rimRing);
    if (mapId === 'moon') {
      for (const a of [Math.PI * 0.18, Math.PI * 0.86, Math.PI * 1.54]) {
        this.mesh(g, this.geo('moonBumperStud', () => new THREE.SphereGeometry(0.07, 12, 8)), this.mat(theme.bumperDrum, 0.35, { emissive: 0x12334a }), x + Math.cos(a) * radii.collider * 0.82, TURF_Y + 0.12, z + Math.sin(a) * radii.collider * 0.82);
      }
    } else if (mapId === 'volcano') {
      for (const a of [0, Math.PI * 0.67, Math.PI * 1.34]) {
        const rock = this.mesh(g, this.geo('volcanoBumperRock', () => new THREE.ConeGeometry(0.18, 0.45, 5)), this.mat(0x1f0b08, 0.76, { flat: true }), x + Math.cos(a) * radii.socket, 1.35, z + Math.sin(a) * radii.socket, true);
        rock.rotation.x = Math.PI;
      }
    } else if (mapId === 'saturn') {
      const orbit = new THREE.Mesh(this.geo('saturnBumperOrbit', () => new THREE.TorusGeometry(1, 0.025, 8, 64)),
        new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.58 }));
      orbit.position.set(x + sx * radii.collider * 0.1, TURF_Y + 0.11, z + sz * radii.collider * 0.1);
      orbit.rotation.x = Math.PI / 2;
      orbit.scale.set(radii.collider * 1.25, radii.collider * 0.78, 1);
      g.add(orbit);
    }
  }

  // -- dynamic actors ---------------------------------------------------
  private contactShadowTexture() {
    const key = 'contactShadowTexture';
    let tex = this.textCache.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(34,37,46,.72)');
    grad.addColorStop(0.56, 'rgba(34,37,46,.22)');
    grad.addColorStop(1, 'rgba(34,37,46,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(c);
    this.textCache.set(key, tex);
    return tex;
  }

  private soccerBallTexture() {
    const key = 'planetBallTournamentTextureV1';
    let tex = this.textCache.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d')!;
    const spots = [
      [512, 72], [258, 142], [766, 142],
      [405, 250], [620, 238], [188, 286], [836, 286],
      [298, 398], [530, 412], [742, 392]
    ] as const;
    g.fillStyle = '#fffdf5';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#2cc7c1';
    g.lineWidth = 6;
    g.lineCap = 'round';
    const links = [[0,1],[0,2],[0,3],[0,4],[1,3],[1,5],[2,4],[2,6],[3,4],[3,7],[3,8],[4,8],[4,9],[4,6],[5,7],[6,9],[7,8],[8,9]] as const;
    for (const [a, b] of links) {
      g.beginPath(); g.moveTo(spots[a][0], spots[a][1]); g.lineTo(spots[b][0], spots[b][1]); g.stroke();
    }
    const pentagon = (x: number, y: number, radius: number, rotation: number) => {
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = rotation + i * Math.PI * 2 / 5;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = '#3152c9'; g.fill();
      g.strokeStyle = '#22252e'; g.lineWidth = 4; g.stroke();
    };
    spots.forEach(([x, y], i) => pentagon(x, y, i === 0 || i > 6 ? 38 : 34, -Math.PI / 2 + i * 0.17));
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = this.lowPower ? 1 : 8;
    this.textCache.set(key, tex);
    return tex;
  }

  private contactShadowMaterial(opacity: number) {
    const key = `contactShadow:${opacity.toFixed(2)}`;
    return this.texturedMat(key, () => new THREE.MeshBasicMaterial({
      map: this.contactShadowTexture(),
      color: PLANETBALL.charcoal,
      transparent: true,
      opacity,
      depthWrite: false
    }));
  }

  private blobShadow(x: number, z: number, r: number, opacity = 0.18, yAboveTurf = 0.025) {
    const m = new THREE.Mesh(this.geo('blob', () => new THREE.CircleGeometry(1, 48)), this.contactShadowMaterial(opacity));
    m.position.set(x, TURF_Y + yAboveTurf, z);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(r, r * 0.72, 1);
    m.receiveShadow = false;
    this.dynamic.add(m);
  }

  private addBabble(b: GameState['babbles'][number], state: GameState, you: string, selectedBabbleId?: string | null, targetable = false) {
    const player = Object.values(state.players).find(p => p.side === b.side && p.controlledBabbleIds.includes(b.id)) ?? Object.values(state.players).find(p => p.side === b.side);
    const team = TEAMS[state.sideTeams[b.side] ?? player?.team ?? 'pigs'];
    const robot = team.robot;
    const w = fieldToWorld(b.pos);
    const r = fieldRadiusToWorld(b.radius);
    const t = performance.now() / 1000 + hashId(b.id) * 7;
    const bobY = Math.sin(t * 3.1) * 0.05;
    const wobble = Math.sin(t * 2.4) * 0.025;
    const ghosted = babbleGhosted(b.effects, state.turn);
    const bmat = (color: number | string, roughness: number) =>
      ghosted ? this.mat(color, roughness, { transparent: true, opacity: GHOST_OPACITY }) : this.mat(color, roughness);
    const surfaceTexture = ghosted ? null : this.imageTexture(robot.texture);
    const chassisMat = surfaceTexture
      ? this.texturedMat(`robotSurface:${robot.texture}`, () => new THREE.MeshStandardMaterial({
          map: surfaceTexture,
          color: new THREE.Color(team.primary).lerp(new THREE.Color(0xffffff), 0.2),
          roughness: Math.max(0.2, 0.62 - robot.smoothness * 0.38),
          metalness: 0.36
        }))
      : bmat(team.primary, 0.38);
    const trimMat = bmat(team.secondary, 0.32);
    const darkMat = bmat(PLANETBALL.charcoal, 0.5);
    const lightMat = bmat(PLANETBALL.white, 0.34);
    const solid = !ghosted;
    this.blobShadow(w.x, w.z, babbleContactShadowRadius(b.radius), ghosted ? 0.08 : 0.18);

    const physicsHop = Number.isFinite(b.height) ? Math.max(0, b.height - babbleRestHeight(b.radius)) : 0;
    const hop = physicsHop;
    const grp = new THREE.Group(); grp.position.set(w.x, hop, w.z); this.dynamic.add(grp);
    const base = babbleContactBaseMetrics(b.radius);
    const radialSegments = this.lowPower ? 18 : 40;
    const mobilePresentationScale = this.canvas.clientWidth <= 720 ? 1.18 : 1;
    const scale = r / fieldRadiusToWorld(FIELD.babbleRadius) * mobilePresentationScale;
    const width = robot.width * scale;
    const depth = robot.depth * scale;
    const height = robot.height * scale;
    this.mesh(grp, new THREE.CylinderGeometry(base.topRadius, base.radius, base.height, radialSegments), darkMat, 0, TURF_Y + base.height / 2, 0, solid);
    const baseRotor = new THREE.Group();
    baseRotor.rotation.y = robot.motion === 'rotatingBase' ? t * 1.45 : 0;
    grp.add(baseRotor);
    const driveRing = this.mesh(baseRotor, new THREE.TorusGeometry(r * 0.77, r * 0.09, 10, radialSegments), trimMat, 0, TURF_Y + base.height + 0.03, 0, solid);
    driveRing.rotation.x = Math.PI / 2;
    if (robot.motion === 'rotatingBase') {
      for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3;
        const marker = this.mesh(baseRotor, new THREE.CapsuleGeometry(r * 0.07, r * 0.2, 4, 10), lightMat, Math.cos(angle) * r * 0.7, TURF_Y + base.height + 0.08, Math.sin(angle) * r * 0.7, solid);
        marker.rotation.z = Math.PI / 2;
        marker.rotation.y = -angle;
      }
    }

    const chassis = new THREE.Group();
    chassis.position.set(0, 0, 0);
    chassis.rotation.z = wobble;
    chassis.rotation.x = Math.sin(t * 2.1) * 0.012;
    grp.add(chassis);
    const bodyY = TURF_Y + base.height + height / 2 + bobY;
    const frontZ = depth * 0.48;

    if (robot.shape === 'orb') {
      const body = this.mesh(chassis, new THREE.SphereGeometry(1, this.lowPower ? 20 : 48, this.lowPower ? 14 : 32), chassisMat, 0, bodyY, 0, solid);
      body.scale.set(width / 2, height / 2, depth / 2);
      const gyro = this.mesh(chassis, new THREE.TorusGeometry(1, 0.08, 8, this.lowPower ? 24 : 48), bmat(team.primary, 0.3), 0, bodyY, 0, solid);
      gyro.scale.set(width * 0.56, height * 0.46, depth * 0.56);
      gyro.rotation.x = Math.PI / 2;
      const visor = this.mesh(chassis, new THREE.SphereGeometry(1, 24, 16), darkMat, 0, bodyY + height * 0.09, frontZ, solid);
      visor.scale.set(width * 0.3, height * 0.13, depth * 0.08);
    } else if (robot.shape === 'block') {
      const body = this.mesh(chassis, new RoundedBoxGeometry(1, 1, 1, this.lowPower ? 2 : 5, 0.16), chassisMat, 0, bodyY, 0, solid);
      body.scale.set(width, height * 0.78, depth);
      const crown = this.mesh(chassis, new RoundedBoxGeometry(1, 1, 1, 3, 0.18), bmat(team.primary, 0.3), 0, bodyY + height * 0.43, 0, solid);
      crown.scale.set(width * 0.78, height * 0.16, depth * 0.84);
      for (const side of [-1, 1]) {
        const shoulder = this.mesh(chassis, new RoundedBoxGeometry(1, 1, 1, 3, 0.2), bmat(team.primary, 0.34), side * width * 0.5, bodyY, 0, solid);
        shoulder.scale.set(width * 0.16, height * 0.46, depth * 0.78);
      }
      const visor = this.mesh(chassis, new RoundedBoxGeometry(1, 1, 1, 3, 0.22), lightMat, 0, bodyY + height * 0.13, frontZ, solid);
      visor.scale.set(width * 0.55, height * 0.13, depth * 0.08);
    } else if (robot.shape === 'wedge') {
      const rampShape = new THREE.Shape();
      rampShape.moveTo(-0.5, -0.5);
      rampShape.lineTo(0.5, -0.5);
      rampShape.lineTo(0.5, 0.5);
      rampShape.closePath();
      const rampGeometry = new THREE.ExtrudeGeometry(rampShape, { depth: 1, steps: 1, bevelEnabled: true, bevelSegments: this.lowPower ? 1 : 4, bevelSize: 0.055, bevelThickness: 0.055 });
      rampGeometry.translate(0, 0, -0.5);
      const body = this.mesh(chassis, rampGeometry, chassisMat, 0, bodyY, 0, solid);
      body.scale.set(width, height, depth);
      body.rotation.y = b.side === 'left' ? 0 : Math.PI;
      const spine = this.mesh(chassis, new RoundedBoxGeometry(1, 1, 1, 3, 0.18), trimMat, 0, bodyY + height * 0.2, 0, solid);
      spine.scale.set(width * 0.13, height * 0.62, depth * 0.86);
      const visor = this.mesh(chassis, new RoundedBoxGeometry(1, 1, 1, 3, 0.2), darkMat, 0, bodyY + height * 0.08, frontZ * 0.9, solid);
      visor.scale.set(width * 0.38, height * 0.12, depth * 0.08);
    } else {
      const ring = this.mesh(chassis, new THREE.TorusGeometry(0.5, 0.15, this.lowPower ? 8 : 14, this.lowPower ? 24 : 48), chassisMat, 0, bodyY + height * 0.08, 0, solid);
      ring.scale.set(width, height * 0.78, depth);
      const core = this.mesh(chassis, new THREE.SphereGeometry(1, 20, 14), trimMat, 0, bodyY + height * 0.08, depth * 0.04, solid);
      core.scale.set(width * 0.2, height * 0.18, depth * 0.24);
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
        const foot = this.mesh(baseRotor, new THREE.CapsuleGeometry(0.13, height * 0.24, 4, this.lowPower ? 8 : 14), darkMat, Math.cos(a) * width * 0.37, TURF_Y + base.height + height * 0.18, Math.sin(a) * depth * 0.37, solid);
        foot.rotation.z = Math.cos(a) * 0.16;
      }
    }

    const eyeY = bodyY + height * 0.13;
    for (const side of [-1, 1]) {
      const eye = this.mesh(chassis, new THREE.SphereGeometry(1, this.lowPower ? 10 : 18, this.lowPower ? 7 : 12), lightMat, side * width * 0.12, eyeY, frontZ * 1.09, solid);
      eye.scale.set(width * 0.085, height * 0.075, depth * 0.045);
      const pupil = this.mesh(chassis, new THREE.SphereGeometry(1, 10, 7), darkMat, side * width * 0.12, eyeY, frontZ * 1.145, solid);
      pupil.scale.set(width * 0.034, height * 0.034, depth * 0.022);
    }
    const antenna = this.mesh(chassis, new THREE.CapsuleGeometry(0.025, height * 0.14, 3, 8), trimMat, 0, bodyY + height * 0.56, 0, solid);
    antenna.rotation.z = wobble * 3;
    const antennaTip = this.mesh(chassis, new THREE.SphereGeometry(height * 0.065, 14, 10), lightMat, 0, bodyY + height * 0.67, 0, solid);
    antennaTip.scale.set(1, 0.85, 1);

    if (ghosted) {
      const shell = new THREE.Mesh(this.geo('ghostShell', () => new THREE.SphereGeometry(1, 24, 16)),
        new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.16 + Math.sin(t * 3.4) * 0.06, depthWrite: false }));
      shell.position.set(0, bodyY, 0);
      shell.scale.set(width * 0.75, height * 0.68 + Math.sin(t * 3.4) * 0.05, depth * 0.75);
      grp.add(shell);
      const halo = new THREE.Mesh(this.geo('ghostHalo', () => new THREE.TorusGeometry(1, 0.05, 8, 48)),
        new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.55 + Math.sin(t * 3.4) * 0.2 }));
      halo.position.set(w.x, TURF_Y + 0.06, w.z); halo.rotation.x = Math.PI / 2; halo.scale.setScalar(babbleIndicatorRingRadius(b.radius, 'ghost')); this.dynamic.add(halo);
      const tag = this.text('👻 GHOSTED', 24, '#e9d5ff');
      tag.position.set(w.x, TURF_Y + height + 0.75 + hop + bobY, w.z);
      this.dynamic.add(tag);
    }
    if (player) {
      const nameTag = this.text(player.name, 20, '#fffdf5');
      nameTag.position.set(w.x, TURF_Y + height + 0.62 + hop + bobY, w.z);
      nameTag.scale.set(2.6, 0.82, 1);
      nameTag.renderOrder = 24;
      this.dynamic.add(nameTag);
      if (player.avatarUrl) {
        const avatar = this.imageSprite(player.avatarUrl);
        if (avatar) {
          avatar.scale.set(0.62, 0.62, 1);
          avatar.position.set(w.x - 1.02, TURF_Y + height + 0.62 + hop + bobY, w.z);
          this.dynamic.add(avatar);
        }
      }
    }
    // control ring for your babbles
    if (state.players[you]?.controlledBabbleIds.includes(b.id)) {
      // X-ray ring remains visible when a mystery box overlaps the babble.
      const ring = new THREE.Mesh(this.geo('ctrlRing', () => new THREE.TorusGeometry(1, 0.06, 8, 48)),
        this.texturedMat('ctrlRingXrayMat', () => new THREE.MeshBasicMaterial({ color: PLANETBALL.signal, depthTest: false, depthWrite: false })));
      ring.renderOrder = 20;
      ring.position.set(w.x, TURF_Y + 0.04, w.z); ring.rotation.x = Math.PI / 2; ring.scale.setScalar(babbleIndicatorRingRadius(b.radius, 'control')); this.dynamic.add(ring);
    }
    if (targetable) {
      const targetableRing = new THREE.Mesh(this.geo('targetableRing', () => new THREE.TorusGeometry(1, 0.075, 8, 48)),
        this.texturedMat('targetableRingXrayMat', () => new THREE.MeshBasicMaterial({ color: PLANETBALL.aqua, transparent: true, opacity: 0.88, depthTest: false, depthWrite: false })));
      targetableRing.renderOrder = 21;
      targetableRing.position.set(w.x, TURF_Y + 0.08, w.z);
      targetableRing.rotation.x = Math.PI / 2;
      targetableRing.scale.setScalar(babbleIndicatorRingRadius(b.radius, 'target'));
      this.dynamic.add(targetableRing);
    }
    // Click-to-select box target: pulsing aqua ring plus TARGET label.
    if (selectedBabbleId === b.id) {
      const pulse = 1.8 + Math.sin(performance.now() / 180) * 0.12;
      const sel = new THREE.Mesh(this.geo('targetRing', () => new THREE.TorusGeometry(1, 0.09, 8, 48)),
        new THREE.MeshBasicMaterial({ color: PLANETBALL.aqua, transparent: true, opacity: 0.9 }));
      sel.position.set(w.x, TURF_Y + 0.07, w.z); sel.rotation.x = Math.PI / 2; sel.scale.setScalar(babbleIndicatorRingRadius(b.radius, 'target') + (pulse - 1.8) * 0.12); this.dynamic.add(sel);
      const label = this.text('TARGET', 26, '#2cc7c1');
      label.position.set(w.x, TURF_Y + height + 0.42 + hop + bobY, w.z);
      this.dynamic.add(label);
    }
  }

  private addBall(state: GameState) {
    const p = state.ball.pos;
    const radius = state.ball.radius;
    const w = fieldToWorld(p); const r = fieldRadiusToWorld(radius);
    // Prefer the authoritative Rapier quaternion: unlike planar roll inferred
    // from displacement, it preserves pitch, roll and yaw from glancing hits,
    // walls, ramps and airborne spin. Keep displacement roll only as a fallback
    // for old protocol snapshots that predate the quaternion fields.
    const authoritative = authoritativeBallQuaternion(state.ball);
    if (authoritative) {
      this.ballQuat.set(authoritative.x, authoritative.y, authoritative.z, authoritative.w);
    } else if (this.lastBallPos) {
      const delta = { x: p.x - this.lastBallPos.x, y: p.y - this.lastBallPos.y };
      const distField = Math.hypot(delta.x, delta.y);
      if (distField > 0 && distField < ROLL_TELEPORT_FIELD_DIST) {
        const { axis, angle } = rollDelta(delta, r);
        this.ballQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(axis.x, axis.y, axis.z), angle));
      }
    }
    this.lastBallPos = { x: p.x, y: p.y };
    const elevation = ballRenderElevation(state.ball);
    const visual = ballVisualProfile(this.lowPower);
    if (visual.blobShadow) this.blobShadow(w.x, w.z, elevation.shadowRadius, elevation.shadowOpacity, elevation.shadowYAboveTurf);
    const grp = new THREE.Group(); grp.position.set(w.x, TURF_Y + elevation.centerYAboveTurf, w.z);
    grp.quaternion.copy(this.ballQuat);
    this.dynamic.add(grp);
    const material = this.texturedMat('planetBallTournamentSurfaceV1', () => new THREE.MeshStandardMaterial({
      map: this.soccerBallTexture(),
      roughness: 0.62,
      metalness: 0,
      color: 0xffffff
    }));
    const ball = this.mesh(grp, this.geo(`planetBallTournamentSphere:${this.lowPower ? 'low' : 'high'}`, () => new THREE.SphereGeometry(1, this.lowPower ? 24 : 48, this.lowPower ? 16 : 32)), material, 0, 0, 0, true);
    ball.scale.setScalar(r);
    ball.castShadow = true;
    ball.receiveShadow = false;
  }

  private addPowerBox(p: Vec, color: string) {
    const w = fieldToWorld(p);
    const t = performance.now() / 1000;
    this.blobShadow(w.x, w.z, 0.48, 0.17);
    const bobY = Math.sin(t * 2.4 + w.x) * 0.07;
    const grp = new THREE.Group();
    grp.position.set(w.x, TURF_Y + 0.66 + bobY, w.z);
    grp.rotation.y = t * 0.9 + w.x;
    this.dynamic.add(grp);
    // Notched tournament ticket: a floating Unicap power capsule whose band
    // hints at category without exposing the hidden ability.
    const ticketGeo = this.geo(`powerTicket:${this.lowPower ? 'low' : 'high'}`, () => this.ticketCapsuleGeometry());
    if (!this.lowPower) {
      const backing = this.mesh(grp, ticketGeo, this.mat(PLANETBALL.cobalt, 0.42, { flat: true }), 0, 0, -0.055, true);
      backing.scale.set(1.1, 1.08, 1.08);
    }
    this.mesh(grp, ticketGeo, this.mat(PLANETBALL.white, 0.5, { flat: true }), 0, 0, 0.015, true);
    const categoryBand = this.mesh(grp, this.geo('powerTicketBand', () => new THREE.BoxGeometry(0.78, 0.18, 0.34)), this.mat(color, 0.36, { flat: true }), 0, 0, 0.02, true);
    categoryBand.castShadow = !this.lowPower;
    const spine = this.mesh(grp, this.geo('powerTicketSpine', () => new THREE.BoxGeometry(0.1, 0.76, 0.32)), this.mat(PLANETBALL.cobalt, 0.4, { flat: true }), 0, 0, 0.03);
    spine.castShadow = false;
    if (!this.lowPower) {
      const seal = this.mesh(grp, this.geo('powerTicketSeal', () => new THREE.CylinderGeometry(0.14, 0.14, 0.045, 16)), this.mat(PLANETBALL.signal, 0.3, { emissive: 0x5a4300 }), 0, 0.29, 0.2);
      seal.rotation.x = Math.PI / 2;
    }
    // Pulsing signal ring stays a visual affordance, never a collider.
    const glow = new THREE.Mesh(this.geo(`powerTicketGlow:${this.lowPower ? 'low' : 'high'}`, () => new THREE.TorusGeometry(1, 0.05, this.lowPower ? 5 : 8, this.lowPower ? 20 : 40)),
      new THREE.MeshBasicMaterial({ color: PLANETBALL.signal, transparent: true, opacity: 0.5 + Math.sin(t * 3) * 0.2 }));
    glow.position.set(w.x, TURF_Y + 0.05, w.z);
    glow.rotation.x = Math.PI / 2;
    glow.scale.setScalar(0.75 + Math.sin(t * 3) * 0.06);
    this.dynamic.add(glow);
    const q = this.text('?', 34, '#fffdf5');
    q.position.set(w.x, TURF_Y + 0.66 + bobY, w.z + 0.26);
    q.scale.multiplyScalar(0.72);
    this.dynamic.add(q);
  }

  private ticketCapsuleGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.42, -0.5);
    shape.lineTo(0.42, -0.5);
    shape.lineTo(0.42, -0.12);
    shape.lineTo(0.31, 0);
    shape.lineTo(0.42, 0.12);
    shape.lineTo(0.42, 0.5);
    shape.lineTo(-0.42, 0.5);
    shape.lineTo(-0.42, 0.12);
    shape.lineTo(-0.31, 0);
    shape.lineTo(-0.42, -0.12);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.24,
      bevelEnabled: !this.lowPower,
      bevelSegments: this.lowPower ? 1 : 2,
      bevelSize: 0.035,
      bevelThickness: 0.035,
      curveSegments: this.lowPower ? 2 : 4
    }).center();
  }

  private addFieldObject(type: string, p: Vec, angle: number, ghost = false) {
    const colors: Record<string, number> = { stickyGoo: 0x239f9e, block: PLANETBALL.white, ramp: PLANETBALL.coral, boost: PLANETBALL.cobalt };
    const w = fieldToWorld(p);
    const col = colors[type] ?? 0xffffff;
    const fx = (color: number, rough = 0.34) => ghost
      ? new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, transparent: true, opacity: 0.45, depthWrite: false })
      : this.mat(color, rough);
    const grp = new THREE.Group();
    grp.position.set(w.x, 0, w.z);
    grp.rotation.y = -angle;
    this.dynamic.add(grp);
    if (type === 'stickyGoo') {
      // sticky slow puddle (physics radius 80 -> 1.6 world units)
      const puddle = this.mesh(grp, new THREE.CylinderGeometry(1.6, 1.72, 0.1, 36), fx(col, 0.6), 0, TURF_Y + 0.06, 0);
      puddle.castShadow = false;
      for (let i = 0; i < 5; i++) this.mesh(grp, new THREE.SphereGeometry(0.14 + (i % 3) * 0.05, 12, 8), fx(PLANETBALL.aqua, 0.5), Math.cos(i * 2.4) * 1.05, TURF_Y + 0.14, Math.sin(i * 2.4) * 1.05, !ghost);
    } else if (type === 'block') {
      // wall segment (halfLen 60 -> 2.4 long)
      this.mesh(grp, new THREE.BoxGeometry(2.5, 0.62, 0.5), fx(col, 0.4), 0, TURF_Y + 0.32, 0, !ghost);
      this.mesh(grp, new THREE.BoxGeometry(2.62, 0.14, 0.62), fx(PLANETBALL.charcoal, 0.5), 0, TURF_Y + 0.08, 0);
    } else if (type === 'ramp') {
      // true wedge shape matching physics zone: low lip at -x rising to the
      // launch lip at +x (local +x == ramp facing/launch direction)
      const hx = fieldRadiusToWorld(RAMP_HALF_LEN), hz = fieldRadiusToWorld(RAMP_HALF_WIDTH);
      const wedge = new THREE.Mesh(this.geo('rampWedge', () => this.wedgeGeometry()), fx(col, 0.35));
      wedge.position.y = TURF_Y + 0.01; wedge.castShadow = !ghost; wedge.receiveShadow = true; grp.add(wedge);
      // base plate, raised side rails and a hazard-striped launch lip
      this.mesh(grp, new THREE.BoxGeometry(hx * 2 + 0.24, 0.08, hz * 2 + 0.24), fx(PLANETBALL.cobalt, 0.45), 0, TURF_Y + 0.04, 0);
      for (const s of [-1, 1] as const) {
        const rail = this.mesh(grp, new THREE.BoxGeometry(Math.hypot(hx * 2, 0.82) + 0.1, 0.14, 0.12), fx(PLANETBALL.charcoal, 0.4), 0, TURF_Y + 0.45, s * (hz + 0.05), !ghost);
        rail.rotation.z = Math.atan2(0.82, hx * 2); // follow the slope up to the lip
      }
      const lip = this.mesh(grp, new THREE.BoxGeometry(0.18, 0.94, hz * 2 + 0.2), ghost ? fx(0xfde047, 0.35) : this.texturedMat('hazardLip', () => new THREE.MeshStandardMaterial({ map: this.hazardTexture(), roughness: 0.4 })), hx - 0.04, TURF_Y + 0.42, 0, !ghost);
      lip.castShadow = !ghost;
      // launch direction chevrons up the slope
      for (const [off, h] of [[-0.7, 0.28], [0, 0.52], [0.7, 0.76]] as const) {
        const arrow = new THREE.Mesh(this.geo('rampArrow', () => new THREE.ConeGeometry(0.18, 0.44, 4)), ghost ? fx(PLANETBALL.white, 0.3) : this.mat(PLANETBALL.white, 0.3, { emissive: 0x4d201c }));
        arrow.position.set(off, TURF_Y + h, 0);
        arrow.rotation.set(0, Math.PI / 4, -Math.PI / 2);
        grp.add(arrow);
      }
    } else {
      // boost pad (physics radius 70 -> 1.4): glowing turbine ring + animated chevrons
      const t = performance.now() / 1000;
      const pad = this.mesh(grp, new THREE.CylinderGeometry(1.4, 1.5, 0.1, 36), fx(col, 0.45), 0, TURF_Y + 0.06, 0);
      pad.castShadow = false;
      const rim = this.mesh(grp, new THREE.CylinderGeometry(1.46, 1.52, 0.06, 36), ghost ? fx(PLANETBALL.aqua, 0.3) : this.mat(PLANETBALL.aqua, 0.3, { emissive: 0x0b4a66 }), 0, TURF_Y + 0.12, 0);
      rim.castShadow = false;
      // speed streak decals sweeping with time so the pad reads as powered-on
      if (!ghost) {
        const swirl = new THREE.Mesh(this.geo('boostSwirl', () => new THREE.TorusGeometry(1.05, 0.05, 6, 40, Math.PI * 0.9)),
          new THREE.MeshBasicMaterial({ color: PLANETBALL.white, transparent: true, opacity: 0.75 }));
        swirl.position.set(0, TURF_Y + 0.13, 0); swirl.rotation.x = Math.PI / 2; swirl.rotation.z = -t * 3.2;
        grp.add(swirl);
      }
      for (const [i, off] of [-0.55, 0.1, 0.75].entries()) {
        const pulse = ghost ? 0 : Math.max(0, Math.sin(t * 5 - i * 1.1)) * 0.12;
        const arrow = new THREE.Mesh(this.geo('boostArrow', () => new THREE.ConeGeometry(0.24, 0.62, 4)), ghost ? fx(PLANETBALL.white, 0.3) : this.mat(PLANETBALL.white, 0.3, { emissive: 0x0c4d54 }));
        arrow.position.set(off + pulse, TURF_Y + 0.18, 0);
        arrow.rotation.set(0, Math.PI / 4, -Math.PI / 2);
        arrow.scale.setScalar(1 + pulse);
        grp.add(arrow);
      }
    }
  }

  // yellow/black hazard stripes for the ramp launch lip
  private hazardTexture() {
    const key = 'hazardTexture';
    let tex = this.textCache.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffda36'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#22252e';
    for (let i = -2; i < 6; i++) { g.save(); g.translate(i * 32, 0); g.rotate(Math.PI / 4); g.fillRect(0, -64, 16, 256); g.restore(); }
    tex = new THREE.CanvasTexture(c); tex.anisotropy = this.lowPower ? 1 : 4;
    this.textCache.set(key, tex);
    return tex;
  }

  // wedge prism: flat low edge at local -x rising to a tall launch lip at +x
  private wedgeGeometry() {
    const hx = fieldRadiusToWorld(RAMP_HALF_LEN);
    const hz = fieldRadiusToWorld(RAMP_HALF_WIDTH);
    const H = 0.82;
    const a = [-hx, 0, -hz], b = [hx, 0, -hz], c = [hx, H, -hz];
    const d = [-hx, 0, hz], e = [hx, 0, hz], f = [hx, H, hz];
    const tris = [
      a, c, b, // side z-
      d, e, f, // side z+
      a, d, f, a, f, c, // slope
      b, c, f, b, f, e, // tall back face
      a, b, e, a, e, d // bottom
    ].flat();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
    geo.computeVertexNormals();
    return geo;
  }

  private bumperColliderOutlineGeometry(radius: number, height: number) {
    const segments = 16;
    const positions: number[] = [];
    const halfHeight = height / 2;
    for (let index = 0; index < segments; index++) {
      const angle = index * Math.PI * 2 / segments;
      const next = (index + 1) * Math.PI * 2 / segments;
      for (const y of [-halfHeight, halfHeight]) {
        positions.push(
          Math.cos(angle) * radius, y, Math.sin(angle) * radius,
          Math.cos(next) * radius, y, Math.sin(next) * radius
        );
      }
      if (index % 4 === 0) {
        positions.push(
          Math.cos(angle) * radius, -halfHeight, Math.sin(angle) * radius,
          Math.cos(angle) * radius, halfHeight, Math.sin(angle) * radius
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }

  // -- bumper hit FX ------------------------------------------------------
  private addBumperFx(state: GameState) {
    const now = Date.now();
    const big = state.bigBumpersUntilTurn !== null && state.bigBumpersUntilTurn >= state.turn;
    const map = MAPS[normalizeMapId(state.mapId)];
    if (big) {
      const t = performance.now() / 1000;
      const radii = bumperVisualRadii(map.id, true);
      const colliderVisual = bumperColliderVisualProfile(map.id, true);
      const colliderMaterial = this.texturedMat(`bumperCollider:${map.id}:super`, () => new THREE.LineBasicMaterial({
        color: map.theme.accent,
        transparent: true,
        opacity: 0.58,
        depthWrite: false
      }));
      for (const w of mapBumperWorldPositions(map.id)) {
        const collider = new THREE.LineSegments(
          this.geo(`bumperCollider:${map.id}:super`, () => this.bumperColliderOutlineGeometry(colliderVisual.radius, colliderVisual.height)),
          colliderMaterial
        );
        collider.position.set(w.x, TURF_Y + colliderVisual.height / 2, w.z);
        this.dynamic.add(collider);
        // persistent super-charged bumper shell: enlarged glowing drum + dome
        this.mesh(this.dynamic, this.geo(`bigBumperBase:${map.id}`, () => new THREE.CylinderGeometry(radii.base, radii.socket, 0.34, 40)), this.mat(map.theme.bumperBase, 0.5), w.x, 1.2, w.z, true);
        this.mesh(this.dynamic, this.geo(`bigBumperDrum:${map.id}`, () => new THREE.CylinderGeometry(radii.drum * 0.96, radii.drum, 0.52, 40)), this.mat(map.theme.bumperDrum, 0.35, { emissive: map.theme.bumperBase }), w.x, 1.6, w.z, true);
        this.mesh(this.dynamic, this.geo(`bigBumperCap:${map.id}`, () => new THREE.CylinderGeometry(radii.cap, radii.cap, 0.12, 40)), this.mat(map.theme.bumperCap, 0.3, { emissive: map.theme.frameDark }), w.x, 1.9, w.z, true);
        const dome = this.mesh(this.dynamic, this.geo(`bigBumperDome:${map.id}`, () => new THREE.SphereGeometry(radii.dome, 28, 16)), this.mat(map.theme.bumperCap, 0.25, { emissive: map.theme.frameDark }), w.x, 2.12, w.z, true);
        dome.scale.setScalar(1 + Math.sin(t * 6) * 0.05);
        const ring = new THREE.Mesh(this.geo('bumperBigRing', () => new THREE.TorusGeometry(1, 0.07, 8, 48)),
          new THREE.MeshBasicMaterial({ color: map.theme.bumperCap, transparent: true, opacity: 0.55 + Math.sin(t * 6) * 0.25 }));
        ring.position.set(w.x, TURF_Y + 0.08, w.z);
        ring.rotation.x = Math.PI / 2;
        ring.scale.setScalar(radii.energyRing);
        this.dynamic.add(ring);
      }
      const banner = this.text('BIG BUMPERS!', 34, map.theme.accent);
      banner.position.set(0, 4.2, FIELD_Z / 2 + 0.6);
      this.dynamic.add(banner);
    }
    for (const ev of state.bumperEvents ?? []) {
      const age = (now - ev.at) / 650;
      if (age < 0 || age > 1) continue;
      const w = fieldToWorld(ev.pos);
      const fade = 1 - age;
      const ring = new THREE.Mesh(this.geo('bumperPulse', () => new THREE.TorusGeometry(1, 0.06, 8, 48)),
        new THREE.MeshBasicMaterial({ color: map.theme.bumperCap, transparent: true, opacity: 0.85 * fade }));
      ring.position.set(w.x, TURF_Y + 0.1 + age * 0.5, w.z);
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(fieldRadiusToWorld(map.layout.bumperRadius) + age * 1.9);
      this.dynamic.add(ring);
      const glow = new THREE.Mesh(this.geo('bumperGlow', () => new THREE.SphereGeometry(1, 20, 12)),
        new THREE.MeshBasicMaterial({ color: map.theme.accent, transparent: true, opacity: 0.5 * fade, depthWrite: false }));
      glow.position.set(w.x, 1.9, w.z);
      glow.scale.setScalar(0.45 + age * 0.6);
      this.dynamic.add(glow);
    }
  }

  // -- ramp launch FX ------------------------------------------------------
  private addRampFx(state: GameState) {
    const now = Date.now();
    for (const ev of state.rampEvents ?? []) {
      const age = (now - ev.at) / 900;
      if (age < 0 || age > 1) continue;
      const w = fieldToWorld(ev.pos);
      const fade = 1 - age;
      // Rising coral-and-signal broadcast burst at the lip.
      const ring = new THREE.Mesh(this.geo('rampPulse', () => new THREE.TorusGeometry(1, 0.06, 8, 48)),
        new THREE.MeshBasicMaterial({ color: PLANETBALL.coral, transparent: true, opacity: 0.8 * fade }));
      ring.position.set(w.x, TURF_Y + 0.15 + age * 1.4, w.z);
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(0.5 + age * 1.6);
      this.dynamic.add(ring);
      const spark = new THREE.Mesh(this.geo('rampSpark', () => new THREE.SphereGeometry(1, 16, 10)),
        new THREE.MeshBasicMaterial({ color: PLANETBALL.signal, transparent: true, opacity: 0.55 * fade, depthWrite: false }));
      spark.position.set(w.x, TURF_Y + 0.6 + age * 1.6, w.z);
      spark.scale.setScalar(0.3 + age * 0.5);
      this.dynamic.add(spark);
    }
  }

  // -- rotation affordance --------------------------------------------------
  // Dashed ring + ⟳ handle over your own rotatable pads: hold LMB and drag to spin.
  private addRotateAffordance(pos: Vec, active: boolean) {
    const w = fieldToWorld(pos);
    const t = performance.now() / 1000;
    const ring = new THREE.Mesh(this.geo('rotateRing', () => new THREE.TorusGeometry(1, 0.045, 8, 48)),
      new THREE.MeshBasicMaterial({ color: active ? PLANETBALL.aqua : PLANETBALL.white, transparent: true, opacity: active ? 0.95 : 0.4 + Math.sin(t * 2.4) * 0.12 }));
    ring.position.set(w.x, TURF_Y + 0.06, w.z);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = active ? t * 2 : 0;
    ring.scale.setScalar(1.75);
    this.dynamic.add(ring);
    if (!active) {
      const handle = this.text('⟳', 30, '#fffdf5');
      handle.position.set(w.x + 1.35, TURF_Y + 0.9, w.z - 1.1);
      handle.scale.multiplyScalar(0.7);
      this.dynamic.add(handle);
    }
  }

  // -- aiming affordance --------------------------------------------------
  private addAimAffordance(state: GameState, drag: { babbleId: string; start: Vec; current: Vec }) {
    const babble = state.babbles.find(b => b.id === drag.babbleId);
    const origin = babble?.pos ?? drag.start;
    const dx = origin.x - drag.current.x, dy = origin.y - drag.current.y;
    const pull = Math.hypot(dx, dy);
    if (pull < 4) return;
    const power = Math.min(1, pull / 150);
    const o = toV3(origin, TURF_Y + 0.14);

    // dashed pull-back tether to the pointer
    const tether = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([o.clone(), toV3(drag.current, TURF_Y + 0.14)]),
      new THREE.LineDashedMaterial({ color: PLANETBALL.white, dashSize: 0.28, gapSize: 0.2, transparent: true, opacity: 0.85 })
    );
    tether.computeLineDistances(); this.dynamic.add(tether);

    this.drawLaunchArrow(origin, Math.atan2(dy, dx), power, 1);
  }

  // committed intents stay visible for every aimed babble on your side until resolution begins
  private addCommittedIntents(state: GameState, you: string, skipBabbleId?: string) {
    const mySide = state.players[you]?.side;
    if (!mySide) return;
    for (const intent of Object.values(state.pendingIntents)) {
      if (intent.babbleId === skipBabbleId) continue;
      const babble = state.babbles.find(b => b.id === intent.babbleId);
      if (!babble) continue;
      const revealedOpponent = babble.side !== mySide;
      this.drawLaunchArrow(babble.pos, intent.aimAngle, Math.min(1, intent.impulse / 900), revealedOpponent ? 0.88 : 0.72, revealedOpponent);
    }
  }

  // chunky launch arrow (shaft + head + trajectory dots + power ring)
  private drawLaunchArrow(origin: Vec, angle: number, power: number, opacity: number, revealedOpponent = false) {
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const o = toV3(origin, TURF_Y + 0.14);
    const len = 1.1 + power * 3.4;
    const color = revealedOpponent
      ? new THREE.Color(PLANETBALL.aqua)
      : new THREE.Color().lerpColors(new THREE.Color(PLANETBALL.signal), new THREE.Color(PLANETBALL.coral), power);
    const basic = (op: number) => new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op });

    const shaftLen = len * 0.72;
    const shaft = new THREE.Mesh(this.geo('aimShaft', () => new THREE.CylinderGeometry(0.09, 0.09, 1, 12)), basic(opacity));
    shaft.scale.y = shaftLen;
    shaft.position.copy(o.clone().add(dir.clone().multiplyScalar(shaftLen / 2)));
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); this.dynamic.add(shaft);
    const head = new THREE.Mesh(this.geo('aimHead', () => new THREE.ConeGeometry(0.28, 0.65, 16)), basic(opacity));
    head.position.copy(o.clone().add(dir.clone().multiplyScalar(shaftLen + 0.32)));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); this.dynamic.add(head);

    // trajectory dots fading out past the arrow
    for (let i = 1; i <= 5; i++) {
      const d = new THREE.Mesh(this.geo('aimDot', () => new THREE.SphereGeometry(0.09, 10, 8)), basic((0.7 - i * 0.12) * opacity));
      d.position.copy(o.clone().add(dir.clone().multiplyScalar(len + 0.5 + i * 0.55)));
      this.dynamic.add(d);
    }
    // power ring pulsing around the babble
    const ring = new THREE.Mesh(this.geo('aimRing', () => new THREE.TorusGeometry(1, 0.05, 8, 48)), basic(0.9 * opacity));
    ring.position.set(o.x, TURF_Y + 0.05, o.z); ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(0.7 + power * 0.9); this.dynamic.add(ring);
  }

  // -- HUD ---------------------------------------------------------------
  private buildHud(_state: GameState) {
    // The live score/turn HUD is DOM-only so it remains sharp, accessible and
    // never competes with a second in-scene TURN or WINNER panel.
  }

  private turfTexture(mapId: MapId) {
    const key = `turfTexture:${mapId}`;
    let tex = this.textCache.get(key);
    if (tex) return tex;
    const theme = MAPS[mapId].theme;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i % 2 ? theme.stripeA : theme.stripeB;
      g.fillRect(i * c.width / 10, 0, c.width / 10, c.height);
    }
    if (theme.pattern === 'craters') {
      const craters = [[160, 120, 46], [360, 380, 34], [540, 135, 58], [720, 330, 44], [875, 170, 28]];
      for (const [x, y, r] of craters) {
        g.fillStyle = 'rgba(34,37,46,.18)';
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,253,245,.42)';
        g.lineWidth = 7;
        g.stroke();
      }
    } else if (theme.pattern === 'lava') {
      g.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const y = 72 + i * 92;
        g.strokeStyle = i % 2 ? 'rgba(241,102,85,.88)' : 'rgba(255,218,54,.82)';
        g.lineWidth = 12 + (i % 3) * 4;
        g.beginPath();
        g.moveTo(40, y);
        for (let x = 120; x < c.width; x += 110) g.lineTo(x, y + Math.sin((x + i * 77) / 90) * 34);
        g.stroke();
        g.strokeStyle = 'rgba(255,253,245,.55)';
        g.lineWidth = 3;
        g.stroke();
      }
    } else if (theme.pattern === 'rings') {
      g.save();
      g.translate(c.width / 2, c.height / 2);
      g.rotate(-0.18);
      for (const [rx, ry, alpha] of [[330, 88, 0.5], [250, 62, 0.42], [145, 38, 0.36]] as const) {
        g.strokeStyle = `rgba(255,218,54,${alpha + 0.18})`;
        g.lineWidth = 10;
        g.beginPath();
        g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = `rgba(44,199,193,${alpha * 0.82})`;
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(0, 0, rx + 22, ry + 7, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      for (const [index, [x, y, r]] of [[214, 135, 18], [812, 370, 16], [520, 257, 32]].entries()) {
        g.fillStyle = index % 2 ? 'rgba(241,102,85,.7)' : 'rgba(255,253,245,.72)';
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(34,37,46,.48)';
        g.lineWidth = 4;
        g.stroke();
      }
    }
    g.strokeStyle = theme.line;
    g.lineWidth = 8;
    g.strokeRect(22, 22, c.width - 44, c.height - 44);
    g.beginPath(); g.moveTo(c.width / 2, 22); g.lineTo(c.width / 2, c.height - 22); g.stroke();
    g.beginPath(); g.arc(c.width / 2, c.height / 2, 72, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath(); g.arc(c.width / 2, c.height / 2, 8, 0, Math.PI * 2); g.fill();
    for (const side of [1, -1]) {
      const x = side > 0 ? c.width - 190 : 22;
      g.strokeRect(x, c.height / 2 - 115, 168, 230);
      g.strokeRect(side > 0 ? c.width - 92 : 22, c.height / 2 - 68, 70, 136);
      g.beginPath();
      const cx = side > 0 ? c.width - 190 : 190;
      g.arc(cx, c.height / 2, 56, -Math.PI / 2, Math.PI / 2, side < 0);
      g.stroke();
    }
    tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = this.lowPower ? 1 : 4;
    this.textCache.set(key, tex);
    return tex;
  }

  private text(text: string, size = 32, fill = '#fffdf5') {
    const key = `${text}|${size}|${fill}`;
    let tex = this.textCache.get(key);
    if (!tex) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 256;
      const g = c.getContext('2d')!;
      const lines = text.split('\n');
      const requestedFontPx = size * 2;
      g.font = `900 ${requestedFontPx}px Fredoka, Arial`;
      const measuredWidth = Math.max(...lines.map(line => g.measureText(line).width));
      const fittedFontPx = fitCanvasTextFontSize(requestedFontPx, measuredWidth);
      g.font = `900 ${fittedFontPx}px Fredoka, Arial`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(34,37,46,.52)'; g.shadowBlur = 0; g.shadowOffsetY = 7;
      g.strokeStyle = 'rgba(34,37,46,.92)'; g.lineWidth = 14; g.lineJoin = 'round';
      g.fillStyle = fill;
      lines.forEach((line, i) => {
        const y = 128 + (i - (lines.length - 1) / 2) * fittedFontPx * 0.95;
        g.strokeText(line, 256, y, TEXT_DRAW_MAX_WIDTH);
        g.fillText(line, 256, y, TEXT_DRAW_MAX_WIDTH);
      });
      tex = new THREE.CanvasTexture(c); tex.anisotropy = this.lowPower ? 1 : 4;
      this.textCache.set(key, tex);
    }
    const spriteMaterial = this.texturedMat(`textSprite:${key}`, () => new THREE.SpriteMaterial({ map: tex, transparent: true })) as THREE.SpriteMaterial;
    const sp = new THREE.Sprite(spriteMaterial);
    sp.scale.set(size / 12, size / 24, 1);
    return sp;
  }
}
