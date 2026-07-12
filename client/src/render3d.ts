import * as THREE from 'three';
import { ActiveEffect, BOX_TYPES, BUMPERS, FIELD, FieldObjectType, GameState, MAPS, MapId, RAMP_HALF_LEN, RAMP_HALF_WIDTH, ROTATABLE_FIELD_OBJECTS, TEAMS, Vec, normalizeMapId } from '../../shared/types';
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
  const halfFieldX = FIELD.width / 100;
  const farRimZ = -FIELD.height / 100;
  return [
    { x: -halfFieldX - 3.8, z: farRimZ - 2.6, width: 1.55, height: 2.7, depth: 1.15, visualTop: 3.51, office: false },
    { x: -8.7, z: farRimZ - 2.85, width: 5.2, height: 3, depth: 1.5, visualTop: 3.81, office: true },
    { x: 0, z: farRimZ - 3, width: 2.2, height: 2.4, depth: 1.15, visualTop: 3.21, office: false },
    { x: 6.4, z: farRimZ - 2.85, width: 2.2, height: 2.4, depth: 1.15, visualTop: 3.21, office: false },
    { x: halfFieldX + 3.8, z: farRimZ - 2.6, width: 1.55, height: 2.7, depth: 1.15, visualTop: 3.51, office: false }
  ];
}

export function arenaSkylinePositions(): WorldXZ[] {
  return arenaSkylineLayout().map(({ x, z }) => ({ x, z }));
}

export type ResourcePylonProp = WorldXZ & { radius: number };

export function resourcePylonLayout(): ResourcePylonProp[] {
  const farRimZ = -FIELD.height / 100;
  return [-8.6, -4.3, 0, 4.3, 8.6].map(x => ({ x, z: farRimZ - 1.45, radius: 0.34 }));
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
  position: { x: 0, y: 16.2, z: 14.4 },
  target: { x: 0, y: 0.4, z: 0 }
};

const WIDE_CAMERA_ASPECT = 16 / 9;
const FIT_CAMERA_ASPECT = 16 / 10;
const PORTRAIT_CAMERA_ASPECT = 390 / 844;
const PORTRAIT_CAMERA_FOV = 70;

function smoothstep(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function cameraFitEnvelope(): THREE.Vector3[] {
  const halfFieldX = FIELD.width / 100;
  const halfFieldZ = FIELD.height / 100;
  const goalBackX = halfFieldX + fieldRadiusToWorld(FIELD.goalDepth);
  const goalTopZ = fieldToWorld({ x: 0, y: FIELD.goalY }).z;
  const goalBottomZ = fieldToWorld({ x: 0, y: FIELD.goalY + FIELD.goalHeight }).z;
  const points: THREE.Vector3[] = [];

  for (const x of [-halfFieldX, halfFieldX]) {
    for (const z of [-halfFieldZ, halfFieldZ]) {
      points.push(new THREE.Vector3(x, 1.02, z), new THREE.Vector3(x, 3, z));
    }
  }
  for (const x of [-goalBackX, goalBackX]) {
    for (const z of [goalTopZ, goalBottomZ]) {
      points.push(new THREE.Vector3(x, 1.02, z), new THREE.Vector3(x, 3, z));
    }
  }

  return points;
}

function cameraDistanceScaleForFit(aspect: number, fov: number): number {
  const position = new THREE.Vector3(DESKTOP_CAMERA.position.x, DESKTOP_CAMERA.position.y, DESKTOP_CAMERA.position.z);
  const target = new THREE.Vector3(DESKTOP_CAMERA.target.x, DESKTOP_CAMERA.target.y, DESKTOP_CAMERA.target.z);
  const distance = position.distanceTo(target);
  const forward = target.clone().sub(position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanHalfFov = Math.tan(fov * Math.PI / 360);
  let extraDistance = 0;

  // Moving the camera backward along its view ray only increases view-space
  // depth, so the exact extra distance needed for each envelope point is direct.
  for (const point of cameraFitEnvelope()) {
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
  const fullFitScale = cameraDistanceScaleForFit(aspect, fov);
  const fitProgress = smoothstep((WIDE_CAMERA_ASPECT - aspect) / (WIDE_CAMERA_ASPECT - FIT_CAMERA_ASPECT));
  const distanceScale = THREE.MathUtils.lerp(1, fullFitScale, fitProgress);
  return {
    fov,
    position: {
      x: DESKTOP_CAMERA.target.x + (DESKTOP_CAMERA.position.x - DESKTOP_CAMERA.target.x) * distanceScale,
      y: DESKTOP_CAMERA.target.y + (DESKTOP_CAMERA.position.y - DESKTOP_CAMERA.target.y) * distanceScale,
      z: DESKTOP_CAMERA.target.z + (DESKTOP_CAMERA.position.z - DESKTOP_CAMERA.target.z) * distanceScale
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

export function goalVisualMetrics(): { leftGoalLineX: number; rightGoalLineX: number; mouthTopZ: number; mouthBottomZ: number; mouthHalfHeight: number; depth: number; pocketFloorDepth: number; pocketFloorWidth: number; sideWallLength: number } {
  const mouthTopZ = fieldToWorld({ x: 0, y: FIELD.goalY }).z;
  const mouthBottomZ = fieldToWorld({ x: 0, y: FIELD.goalY + FIELD.goalHeight }).z;
  return {
    leftGoalLineX: -FIELD_X / 2,
    rightGoalLineX: FIELD_X / 2,
    mouthTopZ,
    mouthBottomZ,
    mouthHalfHeight: (mouthBottomZ - mouthTopZ) / 2,
    depth: fieldRadiusToWorld(FIELD.goalDepth),
    pocketFloorDepth: fieldRadiusToWorld(FIELD.goalDepth),
    pocketFloorWidth: mouthBottomZ - mouthTopZ,
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
  private textCache = new Map<string, THREE.CanvasTexture>();
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.Material>();
  private board = new THREE.Group();
  private dynamic = new THREE.Group();
  private goalTint: Record<'left' | 'right', THREE.MeshStandardMaterial[]> = { left: [], right: [] };
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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowPower, preserveDrawingBuffer: true });
    this.renderer.shadowMap.enabled = !this.lowPower;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(this.lowPower ? 0.5 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(MAPS.stadium.theme.sky, 1);
    this.scene.fog = new THREE.Fog(MAPS.stadium.theme.fog, 34, 70);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 16.2, 14.4);
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
      // Match addBabble's visible oversized-head centre exactly. Turf clicks are
      // handled by the planar fallback; this path exists for clicking the model.
      const projected = new THREE.Vector3(w.x, TURF_Y + 1.18 + hop, w.z).project(this.camera);
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
  private clearDynamic() {
    this.dynamic.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !this.geoCacheHas(mesh.geometry)) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) { if (!this.matCacheHas(m)) { const tex = (m as THREE.MeshBasicMaterial).map; if (tex && !this.texCacheHas(tex)) tex.dispose(); m.dispose(); } }
    });
    this.dynamic.clear();
  }
  private geoCacheHas(g: THREE.BufferGeometry) { for (const v of this.geoCache.values()) if (v === g) return true; return false; }
  private matCacheHas(m: THREE.Material) { for (const v of this.matCache.values()) if (v === m) return true; return false; }
  private texCacheHas(t: THREE.Texture) { for (const v of this.textCache.values()) if (v === t) return true; return false; }

  private mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, cast = false) {
    const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
  }

  // -- static arena -----------------------------------------------------
  private ensureBoard(mapId: MapId) {
    if (this.boardMapId === mapId) return;
    this.board.clear();
    this.goalTint = { left: [], right: [] };
    const theme = MAPS[mapId].theme;
    this.renderer.setClearColor(theme.sky, 1);
    this.scene.fog = new THREE.Fog(theme.fog, mapId === 'moon' ? 42 : 34, mapId === 'volcano' ? 62 : 70);
    this.buildBoard(mapId);
    this.boardMapId = mapId;
  }

  private buildBoard(mapId: MapId) {
    const g = this.board;
    const map = MAPS[mapId];
    const theme = map.theme;
    // Flat two-tone broadcast deck outside the authoritative field surface.
    this.mesh(g, new THREE.BoxGeometry(FIELD_X / 2 + 4, 0.7, FIELD_Z + 7), this.mat(theme.tableLeft, 0.85), -(FIELD_X / 4 + 2), -0.45, 0);
    this.mesh(g, new THREE.BoxGeometry(FIELD_X / 2 + 4, 0.7, FIELD_Z + 7), this.mat(theme.tableRight, 0.85), FIELD_X / 4 + 2, -0.45, 0);
    // White plinth and hard-color tournament frame.
    this.mesh(g, new THREE.BoxGeometry(FIELD_X + 3, 0.76, FIELD_Z + 2.9), this.mat(theme.plinth, 0.7), 0, 0, 0, true);
    this.mesh(g, new THREE.BoxGeometry(FIELD_X + 1.4, 0.9, FIELD_Z + 1.2), this.mat(theme.frame, 0.55, { emissive: mapId === 'volcano' ? 0x3b1208 : 0 }), 0, 0.42, 0, true);
    this.mesh(g, new THREE.BoxGeometry(FIELD_X + 0.5, 0.34, FIELD_Z + 0.3), this.mat(theme.frameDark, 0.5), 0, 0.9, 0, true);
    // raised rim walls (top/bottom + short corner returns beside goals)
    const rimMat = this.mat(theme.frame, 0.45, { emissive: mapId === 'volcano' ? 0x4a1608 : 0 });
    for (const s of [-1, 1] as const) {
      this.mesh(g, new THREE.BoxGeometry(FIELD_X + 0.5, 0.6, 0.42), rimMat, 0, 1.22, s * (FIELD_Z / 2 + 0.03), true);
      for (const e of [-1, 1] as const) this.mesh(g, new THREE.BoxGeometry(0.42, 0.6, 2.2), rimMat, e * (FIELD_X / 2 + 0.03), 1.22, s * (FIELD_Z / 2 - 1.05), true);
    }
    // Rounded signal studs along the frame corners.
    const stud = new THREE.SphereGeometry(0.22, this.lowPower ? 10 : 20, this.lowPower ? 6 : 12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.mesh(g, stud, this.mat(theme.bumperCap, 0.35), sx * (FIELD_X / 2 + 0.55), 1.02, sz * (FIELD_Z / 2 + 0.55), true);
    // Map-specific PlanetBall court slab; markings stay texture-only.
    this.mesh(g, new THREE.BoxGeometry(FIELD_X, 0.24, FIELD_Z), this.mat(theme.fieldBase, 0.85), 0, 0.82, 0);
    const turfMat = new THREE.MeshStandardMaterial({ map: this.turfTexture(mapId), roughness: 0.88, metalness: 0.02, emissive: new THREE.Color(mapId === 'volcano' ? 0x180604 : 0x000000), emissiveIntensity: mapId === 'volcano' ? 0.25 : 0 });
    this.matCache.set(`turfSurface:${mapId}`, turfMat);
    const turf = new THREE.Mesh(this.geo('turfPlane', () => new THREE.PlaneGeometry(FIELD_X, FIELD_Z)), turfMat);
    turf.rotation.x = -Math.PI / 2; turf.position.y = TURF_Y; turf.receiveShadow = true; g.add(turf);
    this.addGoal(-1, mapId); this.addGoal(1, mapId);
    // Every bumper remains aligned with the authoritative physics colliders.
    for (const w of mapBumperWorldPositions(mapId)) this.addBumper(w.x, w.z, mapId);
    this.addTournamentExterior(mapId);
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
    const depth = metrics.depth;
    const pocketX = x + side * depth / 2;
    const backX = x + side * depth;
    // dedicated tintable materials so Swap Goals can visibly recolor the gates
    const frameTint = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.32, metalness: 0.06 });
    const mouthTint = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.55, metalness: 0.03, transparent: true, opacity: 0.46 });
    const panelTint = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.62, metalness: 0.03, transparent: true, opacity: 0.28, depthWrite: false });
    this.goalTint[key].push(frameTint, mouthTint, panelTint);
    this.matCache.set(`goalFrame:${key}`, frameTint);
    this.matCache.set(`goalMouth:${key}`, mouthTint);
    this.matCache.set(`goalPanel:${key}`, panelTint);
    const cream = this.mat(PLANETBALL.white, 0.35);
    // Rectangular goal mouth and pocket, aligned to the Rapier mouth strip and
    // back-wall depth. Circular hoops looked like bogus colliders here.
    const mouth = this.mesh(g, new THREE.BoxGeometry(0.12, 0.05, halfGoal * 2), mouthTint, x, TURF_Y + 0.03, 0);
    mouth.receiveShadow = false;
    // Extend the board and textured turf through the complete physical pocket.
    // A goalie therefore remains visibly supported after crossing the line.
    this.mesh(g, new THREE.BoxGeometry(depth, 0.24, halfGoal * 2), this.mat(theme.fieldBase, 0.85), pocketX, 0.82, 0);
    const pocketTurf = new THREE.Mesh(
      this.geo(`goalPocketTurf:${mapId}`, () => new THREE.PlaneGeometry(depth, halfGoal * 2)),
      this.matCache.get(`turfSurface:${mapId}`)!
    );
    pocketTurf.rotation.x = -Math.PI / 2;
    pocketTurf.position.set(pocketX, TURF_Y + 0.002, 0);
    pocketTurf.receiveShadow = true;
    g.add(pocketTurf);
    const backPanel = this.mesh(g, new THREE.BoxGeometry(0.08, 1.34, halfGoal * 2 + 0.22), panelTint, backX, 1.78, 0);
    backPanel.castShadow = false;
    for (const z of [-halfGoal, halfGoal] as const) {
      const sideNet = this.mesh(g, new THREE.BoxGeometry(depth, 1.68, 0.06), panelTint, pocketX, 1.78, z);
      sideNet.castShadow = false;
    }
    // chunky posts with cream collars and finials aligned to the mouth edges
    for (const s of [-1, 1] as const) {
      this.mesh(g, new THREE.CylinderGeometry(0.17, 0.23, 1.9, 20), frameTint, x, 1.78, s * halfGoal, true);
      this.mesh(g, new THREE.CylinderGeometry(0.3, 0.34, 0.2, 20), cream, x, 0.98, s * halfGoal, true);
      this.mesh(g, new THREE.SphereGeometry(0.24, 20, 12), cream, x, 2.82, s * halfGoal, true);
      this.mesh(g, new THREE.BoxGeometry(depth + 0.16, 0.16, 0.16), frameTint, pocketX, 1.15, s * halfGoal, true);
      this.mesh(g, new THREE.BoxGeometry(depth + 0.16, 0.14, 0.12), frameTint, pocketX, 2.55, s * halfGoal, true);
    }
    // Front crossbar and rear uprights frame a roofless pocket. No mesh covers
    // the interior, so players remain visible and selectable from above.
    const bar = new THREE.Mesh(this.geo(`goalBar${halfGoal.toFixed(2)}`, () => new THREE.CylinderGeometry(0.14, 0.14, halfGoal * 2, 16)), frameTint);
    bar.position.set(x, 2.62, 0); bar.rotation.x = Math.PI / 2; bar.castShadow = true; g.add(bar);
    for (const s of [-1, 1] as const) {
      this.mesh(g, new THREE.BoxGeometry(0.14, 1.4, 0.12), frameTint, backX, 1.78, s * halfGoal, true);
    }
    // translucent net ribs in the pocket; all render-only and safely outside
    // the physics mouth strip/back wall.
    for (let i = -3; i <= 3; i++) {
      const z = (i / 3) * halfGoal * 0.82;
      const rib = new THREE.Mesh(this.geo('goalNetRib', () => new THREE.CylinderGeometry(0.022, 0.022, 1.24, 8)), cream);
      rib.position.set(backX + side * 0.02, 1.78, z);
      rib.castShadow = false;
      g.add(rib);
    }
    for (const y of [1.25, 1.62, 1.99, 2.36]) {
      const cord = new THREE.Mesh(this.geo('goalNetCord', () => new THREE.CylinderGeometry(0.022, 0.022, halfGoal * 1.7, 8)), cream);
      cord.position.set(backX + side * 0.03, y, 0);
      cord.rotation.x = Math.PI / 2;
      cord.castShadow = false;
      g.add(cord);
    }
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
        this.mesh(g, new THREE.BoxGeometry(0.08, 0.08, halfGoal * 2.05), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65 }), x - side * 0.08, y, 0);
      }
    } else if (theme.gateStyle === 'volcanic') {
      for (const s of [-1, 1] as const) {
        const spike = this.mesh(g, new THREE.ConeGeometry(0.24, 0.72, 6), this.mat(0x1f0b08, 0.7, { flat: true, emissive: 0x3b1006 }), x + side * 0.22, 3.15, s * halfGoal, true);
        spike.rotation.x = Math.PI;
      }
    } else if (theme.gateStyle === 'orbital') {
      for (const s of [-1, 1] as const) {
        const orbit = new THREE.Mesh(this.geo('goalOrbitalPostRing', () => new THREE.TorusGeometry(0.42, 0.035, 8, 40)), frameTint);
        orbit.position.set(x, 1.78, s * halfGoal);
        orbit.rotation.y = Math.PI / 2;
        orbit.castShadow = true;
        g.add(orbit);
      }
      const mouthOrbit = new THREE.Mesh(this.geo('goalOrbitalMouthRing', () => new THREE.TorusGeometry(1, 0.025, 8, 64)), mouthTint);
      mouthOrbit.position.set(x - side * 0.08, TURF_Y + 0.08, 0);
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
    if (!swapped) return;
    const t = performance.now() / 1000;
    const metrics = goalVisualMetrics();
    const halfGoal = metrics.mouthHalfHeight;
    const pulse = 0.54 + Math.sin(t * 5) * 0.22;
    for (const side of [-1, 1] as const) {
      const lineX = side < 0 ? metrics.leftGoalLineX : metrics.rightGoalLineX;
      const color = side < 0 ? cols.left : cols.right;
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: pulse, depthWrite: false });
      this.mesh(this.dynamic, this.geo('goalSwapMouthStrip', () => new THREE.BoxGeometry(0.1, 0.08, 1)), mat, lineX, TURF_Y + 0.09, 0).scale.z = halfGoal * 2;
      this.mesh(this.dynamic, this.geo('goalSwapBackStrip', () => new THREE.BoxGeometry(0.08, 0.08, 1)), mat, lineX + side * metrics.depth, TURF_Y + 0.13, 0).scale.z = halfGoal * 2 + 0.2;
      for (const z of [-halfGoal, halfGoal] as const) {
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
    // Round contact socket only: rectangular plates read as stray artifacts
    // around circular bumpers, especially near the corner rim.
    this.mesh(g, new THREE.CylinderGeometry(radii.socket, radii.socket, 0.14, 48), this.mat(theme.bumperCap, 0.42), x, 1.08, z, true);
    this.mesh(g, new THREE.CylinderGeometry(radii.base, radii.base, 0.18, 48), this.mat(theme.bumperBase, 0.55), x, 1.14, z, true);
    this.mesh(g, new THREE.CylinderGeometry(radii.collider * 0.92, radii.base, 0.28, 44), this.mat(theme.frameDark, 0.5), x, 1.24, z, true);
    this.mesh(g, new THREE.CylinderGeometry(radii.drum * 0.94, radii.drum, 0.42, 44), this.mat(theme.bumperDrum, 0.4, { emissive: mapId === 'moon' ? 0x12334a : mapId === 'volcano' ? 0x54140c : 0 }), x, 1.56, z, true);
    this.mesh(g, new THREE.CylinderGeometry(radii.cap, radii.cap, 0.1, 44), this.mat(theme.plinth, 0.35), x, 1.8, z, true);
    this.mesh(g, new THREE.SphereGeometry(radii.dome, 28, 16), this.mat(theme.bumperCap, 0.3, { emissive: mapId === 'volcano' ? 0x7a2e08 : 0x12304a }), x, 1.9, z, true);
    const rimRing = new THREE.Mesh(this.geo(`bumperSocketRing:${mapId}`, () => new THREE.TorusGeometry(1, 0.035, 8, 48)), this.mat(theme.frameDark, 0.42));
    rimRing.position.set(x, TURF_Y + 0.08, z);
    rimRing.rotation.x = Math.PI / 2;
    rimRing.scale.setScalar(radii.socket);
    g.add(rimRing);
    if (mapId === 'moon') {
      for (const a of [Math.PI * 0.18, Math.PI * 0.86, Math.PI * 1.54]) {
        this.mesh(g, new THREE.SphereGeometry(0.07, 12, 8), this.mat(theme.bumperDrum, 0.35, { emissive: 0x12334a }), x + Math.cos(a) * radii.collider * 0.82, TURF_Y + 0.12, z + Math.sin(a) * radii.collider * 0.82);
      }
    } else if (mapId === 'volcano') {
      for (const a of [0, Math.PI * 0.67, Math.PI * 1.34]) {
        const rock = this.mesh(g, new THREE.ConeGeometry(0.18, 0.45, 5), this.mat(0x1f0b08, 0.76, { flat: true }), x + Math.cos(a) * radii.socket, 1.35, z + Math.sin(a) * radii.socket, true);
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
    const team = TEAMS[player?.team ?? 'pigs'];
    const w = fieldToWorld(b.pos);
    const r = fieldRadiusToWorld(b.radius);
    const t = performance.now() / 1000 + hashId(b.id) * 7;
    const bobY = Math.sin(t * 3.1) * 0.05;
    const wobble = Math.sin(t * 2.4) * 0.09;
    // Ghosted babbles render translucent with a faint shadow and no cast shadow
    const ghosted = babbleGhosted(b.effects, state.turn);
    const bmat = (color: number | string, roughness: number) =>
      ghosted ? this.mat(color, roughness, { transparent: true, opacity: GHOST_OPACITY }) : this.mat(color, roughness);
    const solid = !ghosted;
    this.blobShadow(w.x, w.z, babbleContactShadowRadius(b.radius), ghosted ? 0.08 : 0.18);

    const physicsHop = Number.isFinite(b.height) ? Math.max(0, b.height - babbleRestHeight(b.radius)) : 0;
    // Trampoline elevation is authoritative Rapier 3D state; ramp events only
    // drive rings/sparks and never add a second render-only hop.
    const hop = physicsHop;
    const grp = new THREE.Group(); grp.position.set(w.x, hop, w.z); this.dynamic.add(grp);
    const sideCol = b.side === 'left' ? PLANETBALL.coral : PLANETBALL.cobalt;
    const base = babbleContactBaseMetrics(b.radius);
    const radialSegments = this.lowPower ? 16 : 30;
    const sphereWidth = this.lowPower ? 18 : 32;
    const sphereHeight = this.lowPower ? 12 : 20;
    // Small solid contact skirt: its footprint matches the authoritative
    // physics radius, while selection rings remain separate affordances.
    this.mesh(grp, new THREE.CylinderGeometry(base.topRadius, base.radius, base.height, radialSegments), bmat(sideCol, 0.45), 0, TURF_Y + base.height / 2, 0, solid);
    this.mesh(grp, new THREE.CylinderGeometry(r * 0.72, r * 0.78, 0.18, radialSegments), bmat(PLANETBALL.white, 0.4), 0, TURF_Y + 0.25, 0, solid);
    // Compact broadcast kit. Babbles are intentionally armless: no limb mesh
    // is added outside the torso/contact skirt silhouette.
    const torso = this.mesh(grp, new THREE.SphereGeometry(r * 0.62, sphereWidth, sphereHeight), bmat(team.primary, 0.4), 0, TURF_Y + 0.6, 0, solid);
    torso.scale.set(1, 1.15, 0.9);
    const bib = this.mesh(grp, new THREE.SphereGeometry(r * 0.4, this.lowPower ? 14 : 22, this.lowPower ? 9 : 14), bmat(team.secondary, 0.45), 0, TURF_Y + 0.56, r * 0.32, solid);
    bib.scale.set(0.86, 0.92, 0.55);
    if (!this.lowPower) {
      const kitStripe = this.mesh(grp, this.geo('planetBallKitStripe', () => new THREE.BoxGeometry(1, 1, 1)), bmat(PLANETBALL.white, 0.38), 0, TURF_Y + 0.58, r * 0.62);
      kitStripe.scale.set(r * 0.76, 0.055, 0.055);
    }

    // Oversized anime head. Its center is the existing picking contract.
    const head = new THREE.Group(); head.position.set(0, TURF_Y + 1.18 + bobY, 0); head.rotation.z = wobble; head.rotation.x = wobble * 0.5; grp.add(head);
    const skinTones = [0xffd9c2, 0xf2b58d, 0xc98262, 0x8c5545] as const;
    const skin = skinTones[Math.min(skinTones.length - 1, Math.floor(hashId(b.id) * skinTones.length))];
    const skull = this.mesh(head, new THREE.SphereGeometry(r * 0.98, this.lowPower ? 22 : 40, this.lowPower ? 14 : 26), bmat(skin, 0.42), 0, 0, 0, solid);
    skull.scale.set(1, 1.08, 0.96);
    const hair = this.mesh(head, new THREE.SphereGeometry(r, this.lowPower ? 18 : 30, this.lowPower ? 10 : 18), bmat(team.primary, 0.38), 0, r * 0.38, -r * 0.04, solid);
    hair.scale.set(1.02, 0.64, 0.98);
    if (!this.lowPower) {
      for (const s of [-1, 0, 1]) {
        const spike = this.mesh(head, this.geo('planetBallHairSpike', () => new THREE.ConeGeometry(1, 1, 8)), bmat(team.primary, 0.38), s * r * 0.28, r * 0.37 - Math.abs(s) * r * 0.05, r * 0.79, solid);
        spike.scale.set(r * 0.13, r * (s === 0 ? 0.42 : 0.31), r * 0.12);
        spike.rotation.z = s * 0.3;
      }
    }
    // Ears, wide anime eyes, brows, nose, and a small determined smile.
    for (const s of [-1, 1]) {
      if (!this.lowPower) this.mesh(head, new THREE.SphereGeometry(r * 0.18, 16, 10), bmat(skin, 0.44), s * r * 0.9, 0, 0, solid);
      const eye = this.mesh(head, new THREE.SphereGeometry(r * 0.2, this.lowPower ? 12 : 18, this.lowPower ? 8 : 12), bmat(PLANETBALL.white, 0.25), s * r * 0.34, r * 0.13, r * 0.79);
      eye.castShadow = false;
      this.mesh(head, new THREE.SphereGeometry(r * 0.11, this.lowPower ? 8 : 12, this.lowPower ? 6 : 8), bmat(this.lowPower ? PLANETBALL.charcoal : team.secondary, 0.28), s * r * 0.34, r * 0.12, r * 0.94);
      if (!this.lowPower) {
        this.mesh(head, new THREE.SphereGeometry(r * 0.055, 8, 6), bmat(PLANETBALL.charcoal, 0.3), s * r * 0.34, r * 0.12, r * 1.025);
        const brow = this.mesh(head, this.geo('planetBallBrow', () => new THREE.BoxGeometry(1, 1, 1)), bmat(PLANETBALL.charcoal, 0.5), s * r * 0.34, r * 0.41, r * 0.88);
        brow.scale.set(r * 0.32, r * 0.055, r * 0.055);
        brow.rotation.z = -s * 0.1;
      }
    }
    if (!this.lowPower) {
      this.mesh(head, new THREE.SphereGeometry(r * 0.075, 10, 7), bmat(0xe59a79, 0.46), 0, -r * 0.03, r * 0.98);
      const smile = this.mesh(head, this.geo('planetBallSmile', () => new THREE.TorusGeometry(1, 0.12, 6, 18, Math.PI)), bmat(PLANETBALL.charcoal, 0.46), 0, -r * 0.3, r * 0.91);
      smile.scale.setScalar(r * 0.15);
      smile.rotation.z = Math.PI;
    }
    // ghost aura: pulsing translucent shell + floating GHOSTED tag
    if (ghosted) {
      const shell = new THREE.Mesh(this.geo('ghostShell', () => new THREE.SphereGeometry(1, 24, 16)),
        new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.16 + Math.sin(t * 3.4) * 0.06, depthWrite: false }));
      shell.position.set(0, TURF_Y + 1.05, 0);
      shell.scale.set(r * 1.55, r * 2.15 + Math.sin(t * 3.4) * 0.05, r * 1.55);
      grp.add(shell);
      const halo = new THREE.Mesh(this.geo('ghostHalo', () => new THREE.TorusGeometry(1, 0.05, 8, 48)),
        new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.55 + Math.sin(t * 3.4) * 0.2 }));
      halo.position.set(w.x, TURF_Y + 0.06, w.z); halo.rotation.x = Math.PI / 2; halo.scale.setScalar(babbleIndicatorRingRadius(b.radius, 'ghost')); this.dynamic.add(halo);
      const tag = this.text('👻 GHOSTED', 24, '#e9d5ff');
      tag.position.set(w.x, TURF_Y + 2.65 + bobY, w.z);
      this.dynamic.add(tag);
    }

    // team emoji badge on the chest (hidden while ghosted so the see-through body reads clearly)
    if (!ghosted) {
      const badge = this.text(team.emoji, 44);
      badge.scale.setScalar(0.9);
      badge.position.set(w.x, TURF_Y + 0.66, w.z + r * 0.66);
      this.dynamic.add(badge);
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
      label.position.set(w.x, TURF_Y + 2.6 + bobY, w.z);
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

  // -- bumper hit FX ------------------------------------------------------
  private addBumperFx(state: GameState) {
    const now = Date.now();
    const big = state.bigBumpersUntilTurn !== null && state.bigBumpersUntilTurn >= state.turn;
    const map = MAPS[normalizeMapId(state.mapId)];
    if (big) {
      const t = performance.now() / 1000;
      const radii = bumperVisualRadii(map.id, true);
      for (const w of mapBumperWorldPositions(map.id)) {
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
      if (!babble || babble.side !== mySide) continue;
      this.drawLaunchArrow(babble.pos, intent.aimAngle, Math.min(1, intent.impulse / 900), 0.72);
    }
  }

  // chunky launch arrow (shaft + head + trajectory dots + power ring)
  private drawLaunchArrow(origin: Vec, angle: number, power: number, opacity: number) {
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const o = toV3(origin, TURF_Y + 0.14);
    const len = 1.1 + power * 3.4;
    const color = new THREE.Color().lerpColors(new THREE.Color(PLANETBALL.signal), new THREE.Color(PLANETBALL.coral), power);
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
      g.font = `900 ${size * 2}px Fredoka, Arial`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(34,37,46,.52)'; g.shadowBlur = 0; g.shadowOffsetY = 7;
      g.strokeStyle = 'rgba(34,37,46,.92)'; g.lineWidth = 14; g.lineJoin = 'round';
      g.fillStyle = fill;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const y = 128 + (i - (lines.length - 1) / 2) * size * 1.9;
        g.strokeText(line, 256, y);
        g.fillText(line, 256, y);
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
