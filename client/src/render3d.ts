import * as THREE from 'three';
import { ActiveEffect, BIG_BUMPER_RADIUS, BOX_TYPES, BUMPER_RADIUS, BUMPERS, FIELD, FieldObjectType, GameState, RAMP_HALF_LEN, RAMP_HALF_WIDTH, RampEvent, ROTATABLE_FIELD_OBJECTS, TEAMS, Vec } from '../../shared/types';

export type WorldXZ = { x: number; z: number };
export type PlacingGhost = { type: FieldObjectType; pos: Vec; angle: number };
export type RenderInput = {
  state: GameState;
  you: string;
  drag: { babbleId: string; start: Vec; current: Vec } | null;
  placing?: PlacingGhost | null;
  selectedBabbleId?: string | null;
  // optimistic hold-LMB rotation: pad follows the cursor before the server echoes
  rotatingPad?: { id: string; angle: number } | null;
};

export function fieldToWorld(p: Vec): WorldXZ { return { x: (p.x - FIELD.width / 2) / 50, z: (p.y - FIELD.height / 2) / 50 }; }
export function worldToField(p: WorldXZ): Vec { return { x: p.x * 50 + FIELD.width / 2, y: p.z * 50 + FIELD.height / 2 }; }
export function fieldRadiusToWorld(r: number): number { return r / 50; }
export const BUMPER_WORLD_POSITIONS: WorldXZ[] = BUMPERS.map(fieldToWorld);

// Deterministic ball rotation from the authoritative spin state so the visual
// roll always matches travel direction (field x -> world x, field y -> world z).
export function ballSpinToRotation(spin: Vec): { x: number; z: number } {
  return { x: spin.y, z: -spin.x };
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

// Ramp launch hop: parabolic vertical offset (world units) for a mover that
// just flew off a ramp lip. age is seconds since the launch event.
export const RAMP_HOP_SECONDS = 0.7;
export function rampHopOffset(ageSeconds: number): number {
  if (ageSeconds < 0 || ageSeconds > RAMP_HOP_SECONDS) return 0;
  const t = ageSeconds / RAMP_HOP_SECONDS;
  return Math.sin(Math.PI * t) * 1.15;
}
export function latestRampEvent(events: readonly RampEvent[] | undefined, mover: 'ball' | 'babble', moverId: string | undefined, now: number): RampEvent | null {
  if (!events) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.mover === mover && e.moverId === moverId && (now - e.at) / 1000 <= RAMP_HOP_SECONDS) return e;
  }
  return null;
}

// Ghosted power play: the whole babble renders translucent so everyone can see
// it phases through other babbleheads, plus a pulsing ghost aura and label.
export const GHOST_OPACITY = 0.38;
export function babbleGhosted(effects: readonly ActiveEffect[] | undefined, turn: number): boolean {
  return !!effects?.some(e => e.type === 'ghosted' && e.untilTurn >= turn);
}

export const GOAL_COLORS = { left: 0x4a5ad6, right: 0xf05d48 } as const;
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(this.lowPower ? 0.5 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xf16845, 1);
    this.scene.fog = new THREE.Fog(0xf16845, 34, 70);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 16.2, 14.4);
    this.camera.lookAt(0, 0.4, 0);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x7a4a40, 1.9));
    const sun = new THREE.DirectionalLight(0xfff2df, 3.1);
    sun.position.set(-6, 15, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16; sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fb8ff, 0.7);
    fill.position.set(7, 9, -11);
    this.scene.add(fill);
    this.buildBoard();
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

  private resize = () => { const rect = this.canvas.getBoundingClientRect(); const w = Math.max(320, rect.width || window.innerWidth); const h = Math.max(180, rect.height || window.innerHeight); this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); };

  pointFromClient(clientX: number, clientY: number): Vec | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const hit = new THREE.Vector3();
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, hit) ? worldToField({ x: hit.x, z: hit.z }) : null;
  }

  render({ state, you, drag, placing, selectedBabbleId, rotatingPad }: RenderInput) {
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
    for (const b of state.babbles) this.addBabble(b, state, you, selectedBabbleId);
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
  private buildBoard() {
    const g = this.board;
    // warm two-tone table backdrop with soft vignette panels
    this.mesh(g, new THREE.BoxGeometry(FIELD_X / 2 + 4, 0.7, FIELD_Z + 7), this.mat(0xf3714d, 0.85), -(FIELD_X / 4 + 2), -0.45, 0);
    this.mesh(g, new THREE.BoxGeometry(FIELD_X / 2 + 4, 0.7, FIELD_Z + 7), this.mat(0xea5a41, 0.85), FIELD_X / 4 + 2, -0.45, 0);
    // cream plinth + chamfered golden frame
    this.mesh(g, new THREE.BoxGeometry(FIELD_X + 3, 0.76, FIELD_Z + 2.9), this.mat(0xfff3be, 0.7), 0, 0, 0, true);
    this.mesh(g, new THREE.BoxGeometry(FIELD_X + 1.4, 0.9, FIELD_Z + 1.2), this.mat(0xf7b43a, 0.55), 0, 0.42, 0, true);
    this.mesh(g, new THREE.BoxGeometry(FIELD_X + 0.5, 0.34, FIELD_Z + 0.3), this.mat(0xe89a2b, 0.5), 0, 0.9, 0, true);
    // raised rim walls (top/bottom + short corner returns beside goals)
    const rimMat = this.mat(0xf7c452, 0.45);
    for (const s of [-1, 1] as const) {
      this.mesh(g, new THREE.BoxGeometry(FIELD_X + 0.5, 0.6, 0.42), rimMat, 0, 1.22, s * (FIELD_Z / 2 + 0.03), true);
      for (const e of [-1, 1] as const) this.mesh(g, new THREE.BoxGeometry(0.42, 0.6, 2.2), rimMat, e * (FIELD_X / 2 + 0.03), 1.22, s * (FIELD_Z / 2 - 1.05), true);
    }
    // rounded studs along the frame corners
    const stud = new THREE.SphereGeometry(0.22, 20, 12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.mesh(g, stud, this.mat(0xffe08a, 0.35), sx * (FIELD_X / 2 + 0.55), 1.02, sz * (FIELD_Z / 2 + 0.55), true);
    // signature teal turf slab; the striped/marked surface is a canvas texture on top
    this.mesh(g, new THREE.BoxGeometry(FIELD_X, 0.24, FIELD_Z), this.mat(0x2c9297, 0.85), 0, 0.82, 0);
    const turfMat = new THREE.MeshStandardMaterial({ map: this.turfTexture(), roughness: 0.88, metalness: 0.02 });
    this.matCache.set('turfSurface', turfMat);
    const turf = new THREE.Mesh(this.geo('turfPlane', () => new THREE.PlaneGeometry(FIELD_X, FIELD_Z)), turfMat);
    turf.rotation.x = -Math.PI / 2; turf.position.y = TURF_Y; turf.receiveShadow = true; g.add(turf);
    this.addGoal(-1); this.addGoal(1);
    // all four corner bumpers, aligned with the authoritative physics colliders
    for (const w of BUMPER_WORLD_POSITIONS) this.addBumper(w.x, w.z);
    // decorative pennant posts behind the far rim
    for (let i = -2; i <= 2; i++) {
      const post = this.mesh(g, new THREE.CylinderGeometry(0.07, 0.09, 1.7, 10), this.mat(0xfff3be, 0.5), i * 4.4, 1.6, -FIELD_Z / 2 - 1.7, true);
      post.castShadow = true;
      const flag = this.mesh(g, new THREE.ConeGeometry(0.3, 0.55, 4), this.mat(i % 2 ? 0x5c64d1 : 0xde4f49, 0.5, { flat: true }), i * 4.4, 2.45, -FIELD_Z / 2 - 1.7, true);
      flag.rotation.x = Math.PI;
    }
  }

  private addGoal(side: -1 | 1) {
    const g = this.board;
    const x = side * (FIELD_X / 2 - 0.35);
    const key = side < 0 ? 'left' : 'right';
    const col = GOAL_COLORS[key];
    const halfGoal = fieldRadiusToWorld(FIELD.goalHeight) / 2;
    // dedicated tintable materials so Swap Goals can visibly recolor the gates
    const frameTint = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.32, metalness: 0.06 });
    const mouthTint = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.55, metalness: 0.03, transparent: true, opacity: 0.5 });
    const panelTint = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), roughness: 0.62, metalness: 0.03 });
    this.goalTint[key].push(frameTint, mouthTint, panelTint);
    this.matCache.set(`goalFrame:${key}`, frameTint);
    this.matCache.set(`goalMouth:${key}`, mouthTint);
    this.matCache.set(`goalPanel:${key}`, panelTint);
    const cream = this.mat(0xfff3be, 0.35);
    // chunky posts with cream collars and finials
    for (const s of [-1, 1] as const) {
      this.mesh(g, new THREE.CylinderGeometry(0.17, 0.23, 1.9, 20), frameTint, x, 1.78, s * halfGoal, true);
      this.mesh(g, new THREE.CylinderGeometry(0.3, 0.34, 0.2, 20), cream, x, 0.98, s * halfGoal, true);
      this.mesh(g, new THREE.SphereGeometry(0.24, 20, 12), cream, x, 2.82, s * halfGoal, true);
    }
    // crossbar
    const bar = new THREE.Mesh(this.geo(`goalBar${halfGoal.toFixed(2)}`, () => new THREE.CylinderGeometry(0.14, 0.14, halfGoal * 2, 16)), frameTint);
    bar.position.set(x, 2.62, 0); bar.rotation.x = Math.PI / 2; bar.castShadow = true; g.add(bar);
    // solid coloured back wall + side cheeks close the pocket so the gate reads as a real box
    this.mesh(g, new THREE.BoxGeometry(0.18, 1.7, halfGoal * 2 + 0.34), panelTint, x + side * 0.95, 1.6, 0, true);
    for (const s of [-1, 1] as const) this.mesh(g, new THREE.BoxGeometry(1.0, 1.15, 0.15), panelTint, x + side * 0.5, 1.42, s * (halfGoal + 0.09), true);
    // sloped canopy roof in the gate colour
    const roof = this.mesh(g, new THREE.BoxGeometry(1.2, 0.12, halfGoal * 2 + 0.34), panelTint, x + side * 0.52, 2.52, 0, true);
    roof.rotation.z = side * 0.32;
    // net: translucent wireframe box sunk into the goal mouth
    const net = new THREE.Mesh(
      this.geo(`net${halfGoal.toFixed(2)}`, () => new THREE.BoxGeometry(0.8, 1.35, halfGoal * 2 - 0.2, 3, 4, 8)),
      new THREE.MeshBasicMaterial({ color: 0xfff8e6, wireframe: true, transparent: true, opacity: 0.45 })
    );
    net.position.set(x + side * 0.55, 1.7, 0); g.add(net);
    // glowing goal mouth strip on the turf plus inward chevrons marking the trigger line
    const mouth = this.mesh(g, new THREE.BoxGeometry(1.0, 0.04, halfGoal * 2), mouthTint, x - side * 0.15, TURF_Y + 0.02, 0);
    mouth.receiveShadow = false;
    for (const zOff of [-halfGoal * 0.55, 0, halfGoal * 0.55]) {
      const chev = new THREE.Mesh(this.geo('goalChevron', () => new THREE.ConeGeometry(0.22, 0.5, 4)), frameTint);
      chev.position.set(x - side * 0.95, TURF_Y + 0.07, zOff);
      chev.rotation.set(0, Math.PI / 4, side * -Math.PI / 2);
      chev.castShadow = false;
      g.add(chev);
    }
  }

  // Swap Goals power play: recolor the gates while active so everyone can see
  // which direction currently scores, plus a pulsing halo and center banner.
  private applyGoalSwap(state: GameState) {
    const swapped = state.swappedGoalsUntilTurn !== null && state.swappedGoalsUntilTurn >= state.turn;
    const cols = goalDisplayColors(swapped);
    for (const m of this.goalTint.left) { m.color.setHex(cols.left); m.emissive.setHex(swapped ? cols.left : 0x000000); m.emissiveIntensity = swapped ? 0.45 : 0; }
    for (const m of this.goalTint.right) { m.color.setHex(cols.right); m.emissive.setHex(swapped ? cols.right : 0x000000); m.emissiveIntensity = swapped ? 0.45 : 0; }
    if (!swapped) return;
    const t = performance.now() / 1000;
    const halfGoal = fieldRadiusToWorld(FIELD.goalHeight) / 2;
    for (const side of [-1, 1] as const) {
      const halo = new THREE.Mesh(this.geo('goalSwapHalo', () => new THREE.TorusGeometry(1, 0.07, 8, 48)),
        new THREE.MeshBasicMaterial({ color: side < 0 ? cols.left : cols.right, transparent: true, opacity: 0.5 + Math.sin(t * 5) * 0.25 }));
      halo.position.set(side * (FIELD_X / 2 - 0.35), TURF_Y + 0.08, 0);
      halo.rotation.x = Math.PI / 2;
      halo.scale.setScalar(halfGoal * 0.9 + Math.sin(t * 5) * 0.08);
      this.dynamic.add(halo);
    }
    const banner = this.text('GOALS SWAPPED!', 40, '#f9a8f9');
    banner.position.set(0, 3.4, 0);
    banner.scale.multiplyScalar(1.2);
    this.dynamic.add(banner);
  }

  private addBumper(x: number, z: number) {
    const g = this.board;
    this.mesh(g, new THREE.CylinderGeometry(0.74, 0.82, 0.28, 40), this.mat(0x8f3644, 0.5), x, 1.16, z, true);
    this.mesh(g, new THREE.CylinderGeometry(0.66, 0.7, 0.42, 40), this.mat(0xc94d5b, 0.4), x, 1.48, z, true);
    this.mesh(g, new THREE.CylinderGeometry(0.7, 0.7, 0.1, 40), this.mat(0xf4d3b0, 0.35), x, 1.72, z, true);
    this.mesh(g, new THREE.SphereGeometry(0.34, 28, 16), this.mat(0xffe08a, 0.3, { emissive: 0x694312 }), x, 1.9, z, true);
  }

  // -- dynamic actors ---------------------------------------------------
  private blobShadow(x: number, z: number, r: number, opacity = 0.24) {
    const m = new THREE.Mesh(this.geo('blob', () => new THREE.CircleGeometry(1, 40)),
      this.mat(0x143317, 0.9, { transparent: true, opacity }));
    m.position.set(x, TURF_Y + 0.03, z); m.rotation.x = -Math.PI / 2; m.scale.setScalar(r); m.receiveShadow = false; this.dynamic.add(m);
  }

  private addBabble(b: GameState['babbles'][number], state: GameState, you: string, selectedBabbleId?: string | null) {
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
    this.blobShadow(w.x, w.z, r * 1.5, ghosted ? 0.1 : 0.24);

    const hop = rampHopOffset((Date.now() - (latestRampEvent(state.rampEvents, 'babble', b.id, Date.now())?.at ?? -1e12)) / 1000);
    const grp = new THREE.Group(); grp.position.set(w.x, hop, w.z); this.dynamic.add(grp);
    const sideCol = b.side === 'left' ? 0xe25a4c : 0x5147a8;
    // pedestal base
    this.mesh(grp, new THREE.CylinderGeometry(r * 1.05, r * 1.3, 0.22, 36), bmat(sideCol, 0.45), 0, TURF_Y + 0.12, 0, solid);
    this.mesh(grp, new THREE.CylinderGeometry(r * 0.85, r * 1.05, 0.2, 36), bmat(0xfff3be, 0.4), 0, TURF_Y + 0.32, 0, solid);
    // torso in team colors
    const torso = this.mesh(grp, new THREE.SphereGeometry(r * 0.62, 28, 18), bmat(team.primary, 0.4), 0, TURF_Y + 0.6, 0, solid);
    torso.scale.set(1, 1.15, 0.9);
    this.mesh(grp, new THREE.SphereGeometry(r * 0.4, 22, 14), bmat(team.secondary, 0.45), 0, TURF_Y + 0.56, r * 0.32, solid);
    // oversized wobbling babble head
    const head = new THREE.Group(); head.position.set(0, TURF_Y + 1.18 + bobY, 0); head.rotation.z = wobble; head.rotation.x = wobble * 0.5; grp.add(head);
    const skull = this.mesh(head, new THREE.SphereGeometry(r * 0.98, 40, 26), bmat(team.primary, 0.32), 0, 0, 0, solid);
    skull.scale.set(1, 1.08, 0.96);
    // muzzle, ears, eyes
    this.mesh(head, new THREE.SphereGeometry(r * 0.42, 22, 14), bmat(team.secondary, 0.4), 0, -r * 0.18, r * 0.72, solid);
    for (const s of [-1, 1]) {
      this.mesh(head, new THREE.SphereGeometry(r * 0.3, 18, 12), bmat(team.primary, 0.35), s * r * 0.66, r * 0.82, 0, solid);
      this.mesh(head, new THREE.SphereGeometry(r * 0.16, 14, 10), bmat(team.secondary, 0.4), s * r * 0.66, r * 0.82, r * 0.12);
      const eye = this.mesh(head, new THREE.SphereGeometry(r * 0.19, 16, 10), bmat(0xffffff, 0.25), s * r * 0.34, r * 0.22, r * 0.78);
      eye.castShadow = false;
      this.mesh(head, new THREE.SphereGeometry(r * 0.09, 10, 8), bmat(0x1c1310, 0.3), s * r * 0.34, r * 0.22, r * 0.94);
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
      halo.position.set(w.x, TURF_Y + 0.06, w.z); halo.rotation.x = Math.PI / 2; halo.scale.setScalar(r * 1.8); this.dynamic.add(halo);
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
      const ring = new THREE.Mesh(this.geo('ctrlRing', () => new THREE.TorusGeometry(1, 0.06, 8, 48)), this.mat(0xffe86a, 0.4, { emissive: 0x6b5410 }));
      ring.position.set(w.x, TURF_Y + 0.04, w.z); ring.rotation.x = Math.PI / 2; ring.scale.setScalar(r * 1.55); this.dynamic.add(ring);
    }
    // click-to-select box target: pulsing cyan ring plus TARGET label
    if (selectedBabbleId === b.id) {
      const pulse = 1.8 + Math.sin(performance.now() / 180) * 0.12;
      const sel = new THREE.Mesh(this.geo('targetRing', () => new THREE.TorusGeometry(1, 0.09, 8, 48)),
        new THREE.MeshBasicMaterial({ color: 0x38f0e6, transparent: true, opacity: 0.9 }));
      sel.position.set(w.x, TURF_Y + 0.07, w.z); sel.rotation.x = Math.PI / 2; sel.scale.setScalar(r * pulse); this.dynamic.add(sel);
      const label = this.text('TARGET', 26, '#7ff7ee');
      label.position.set(w.x, TURF_Y + 2.6 + bobY, w.z);
      this.dynamic.add(label);
    }
  }

  private addBall(state: GameState) {
    const p = state.ball.pos;
    const radius = state.ball.radius;
    const w = fieldToWorld(p); const r = fieldRadiusToWorld(radius);
    // physically-correct rolling: rotate about the axis perpendicular to the
    // actual travel delta, by distance/radius, accumulated in a quaternion
    if (this.lastBallPos) {
      const delta = { x: p.x - this.lastBallPos.x, y: p.y - this.lastBallPos.y };
      const distField = Math.hypot(delta.x, delta.y);
      if (distField > 0 && distField < ROLL_TELEPORT_FIELD_DIST) {
        const { axis, angle } = rollDelta(delta, r);
        this.ballQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(axis.x, axis.y, axis.z), angle));
      }
    }
    this.lastBallPos = { x: p.x, y: p.y };
    this.blobShadow(w.x, w.z, r * 1.5);
    // ramp launch hop: the ball visibly pops off the wedge lip
    const hop = rampHopOffset((Date.now() - (latestRampEvent(state.rampEvents, 'ball', undefined, Date.now())?.at ?? -1e12)) / 1000);
    const grp = new THREE.Group(); grp.position.set(w.x, TURF_Y + r + 0.06 + hop, w.z);
    grp.quaternion.copy(this.ballQuat);
    this.dynamic.add(grp);
    const ball = this.mesh(grp, new THREE.SphereGeometry(r, 36, 24), this.mat(0xfdfdfa, 0.3), 0, 0, 0, true);
    ball.castShadow = true;
    // pentagon patches placed on the surface
    const patch = this.geo('ballPatch', () => new THREE.CircleGeometry(0.32, 5));
    const dirs = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0.35, 0.4), new THREE.Vector3(-1, 0.35, -0.4), new THREE.Vector3(0.4, -0.2, 1), new THREE.Vector3(-0.4, -0.2, -1), new THREE.Vector3(1, -0.4, -0.8), new THREE.Vector3(-1, -0.4, 0.8)];
    for (const d of dirs) {
      const spot = new THREE.Mesh(patch, this.mat(0x22201e, 0.6));
      const n = d.clone().normalize();
      spot.position.copy(n.clone().multiplyScalar(r * 1.001));
      spot.lookAt(n.clone().multiplyScalar(2));
      spot.scale.setScalar(r);
      grp.add(spot);
    }
    // thin seam rings so the roll reads clearly even from far away
    for (const rx of [0, Math.PI / 2]) {
      const seam = new THREE.Mesh(this.geo('ballSeam', () => new THREE.TorusGeometry(1, 0.035, 8, 40)), this.mat(0xd8d5cf, 0.5));
      seam.scale.setScalar(r * 0.998); seam.rotation.x = rx; seam.castShadow = false; grp.add(seam);
    }
  }

  private addPowerBox(p: Vec, color: string) {
    const w = fieldToWorld(p);
    const t = performance.now() / 1000;
    this.blobShadow(w.x, w.z, 0.6);
    const bobY = Math.sin(t * 2.4 + w.x) * 0.07;
    const grp = new THREE.Group();
    grp.position.set(w.x, TURF_Y + 0.66 + bobY, w.z);
    grp.rotation.y = t * 0.9 + w.x;
    this.dynamic.add(grp);
    // wooden crate body with a big stencilled ? on every side face
    const cube = this.mesh(grp, this.geo('crateBody', () => new THREE.BoxGeometry(0.8, 0.8, 0.8)), this.texturedMat('crateSurface', () => new THREE.MeshStandardMaterial({ map: this.crateTexture(), roughness: 0.6, metalness: 0.02 })), 0, 0, 0, true);
    cube.castShadow = true;
    // coloured straps hint at the power category without revealing the type
    const strap = this.mat(color, 0.35, { emissive: 0x221304 });
    this.mesh(grp, this.geo('crateStrapX', () => new THREE.BoxGeometry(0.86, 0.18, 0.86)), strap, 0, 0, 0, true);
    this.mesh(grp, this.geo('crateStrapY', () => new THREE.BoxGeometry(0.18, 0.86, 0.86)), strap, 0, 0, 0, true);
    // golden corner caps
    const cap = this.geo('crateCap', () => new THREE.SphereGeometry(0.09, 12, 8));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) this.mesh(grp, cap, this.mat(0xffd166, 0.3), sx * 0.4, sy * 0.4, sz * 0.4);
    // pulsing glow ring on the turf under the crate
    const glow = new THREE.Mesh(this.geo('crateGlow', () => new THREE.TorusGeometry(1, 0.05, 8, 40)),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.5 + Math.sin(t * 3) * 0.2 }));
    glow.position.set(w.x, TURF_Y + 0.05, w.z);
    glow.rotation.x = Math.PI / 2;
    glow.scale.setScalar(0.75 + Math.sin(t * 3) * 0.06);
    this.dynamic.add(glow);
    const q = this.text('?', 46); q.position.set(w.x, TURF_Y + 1.55 + bobY, w.z); this.dynamic.add(q);
  }

  // hand-painted crate texture: warm planks, nails and a stencilled ?
  private crateTexture() {
    const key = 'crateTexture';
    let tex = this.textCache.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c98a3e'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#b97a33' : '#d29a49';
      g.fillRect(0, i * 64, 256, 60);
      g.fillStyle = 'rgba(90,50,15,.55)';
      g.fillRect(0, i * 64 + 60, 256, 4);
    }
    // wood grain streaks
    g.strokeStyle = 'rgba(120,70,25,.35)'; g.lineWidth = 3;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(10 + i * 28, 8); g.bezierCurveTo(20 + i * 28, 80, 2 + i * 28, 170, 14 + i * 28, 248); g.stroke(); }
    // frame + nails
    g.strokeStyle = '#8a5a22'; g.lineWidth = 14; g.strokeRect(7, 7, 242, 242);
    g.fillStyle = '#ffd166';
    for (const [x, y] of [[24, 24], [232, 24], [24, 232], [232, 232]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
    // stencilled question mark
    g.font = '900 150px Fredoka, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(70,35,5,.9)'; g.lineWidth = 12; g.strokeText('?', 128, 136);
    g.fillStyle = '#fff3be'; g.fillText('?', 128, 136);
    tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
    this.textCache.set(key, tex);
    return tex;
  }

  private addFieldObject(type: string, p: Vec, angle: number, ghost = false) {
    const colors: Record<string, number> = { stickyGoo: 0x84cc16, block: 0xdbeafe, ramp: 0xa78bfa, boost: 0x38bdf8 };
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
      for (let i = 0; i < 5; i++) this.mesh(grp, new THREE.SphereGeometry(0.14 + (i % 3) * 0.05, 12, 8), fx(0xa3e635, 0.5), Math.cos(i * 2.4) * 1.05, TURF_Y + 0.14, Math.sin(i * 2.4) * 1.05, !ghost);
    } else if (type === 'block') {
      // wall segment (halfLen 60 -> 2.4 long)
      this.mesh(grp, new THREE.BoxGeometry(2.5, 0.62, 0.5), fx(col, 0.4), 0, TURF_Y + 0.32, 0, !ghost);
      this.mesh(grp, new THREE.BoxGeometry(2.62, 0.14, 0.62), fx(0x64748b, 0.5), 0, TURF_Y + 0.08, 0);
    } else if (type === 'ramp') {
      // true wedge shape matching physics zone: low lip at -x rising to the
      // launch lip at +x (local +x == ramp facing/launch direction)
      const hx = fieldRadiusToWorld(RAMP_HALF_LEN), hz = fieldRadiusToWorld(RAMP_HALF_WIDTH);
      const wedge = new THREE.Mesh(this.geo('rampWedge', () => this.wedgeGeometry()), fx(col, 0.35));
      wedge.position.y = TURF_Y + 0.01; wedge.castShadow = !ghost; wedge.receiveShadow = true; grp.add(wedge);
      // base plate, raised side rails and a hazard-striped launch lip
      this.mesh(grp, new THREE.BoxGeometry(hx * 2 + 0.24, 0.08, hz * 2 + 0.24), fx(0x7c6ae8, 0.45), 0, TURF_Y + 0.04, 0);
      for (const s of [-1, 1] as const) {
        const rail = this.mesh(grp, new THREE.BoxGeometry(Math.hypot(hx * 2, 0.82) + 0.1, 0.14, 0.12), fx(0x5b4bc4, 0.4), 0, TURF_Y + 0.45, s * (hz + 0.05), !ghost);
        rail.rotation.z = Math.atan2(0.82, hx * 2); // follow the slope up to the lip
      }
      const lip = this.mesh(grp, new THREE.BoxGeometry(0.18, 0.94, hz * 2 + 0.2), ghost ? fx(0xfde047, 0.35) : this.texturedMat('hazardLip', () => new THREE.MeshStandardMaterial({ map: this.hazardTexture(), roughness: 0.4 })), hx - 0.04, TURF_Y + 0.42, 0, !ghost);
      lip.castShadow = !ghost;
      // launch direction chevrons up the slope
      for (const [off, h] of [[-0.7, 0.28], [0, 0.52], [0.7, 0.76]] as const) {
        const arrow = new THREE.Mesh(this.geo('rampArrow', () => new THREE.ConeGeometry(0.18, 0.44, 4)), ghost ? fx(0xf5f3ff, 0.3) : this.mat(0xf5f3ff, 0.3, { emissive: 0x4c3d99 }));
        arrow.position.set(off, TURF_Y + h, 0);
        arrow.rotation.set(0, Math.PI / 4, -Math.PI / 2);
        grp.add(arrow);
      }
    } else {
      // boost pad (physics radius 70 -> 1.4): glowing turbine ring + animated chevrons
      const t = performance.now() / 1000;
      const pad = this.mesh(grp, new THREE.CylinderGeometry(1.4, 1.5, 0.1, 36), fx(col, 0.45), 0, TURF_Y + 0.06, 0);
      pad.castShadow = false;
      const rim = this.mesh(grp, new THREE.CylinderGeometry(1.46, 1.52, 0.06, 36), ghost ? fx(0x0ea5e9, 0.3) : this.mat(0x0ea5e9, 0.3, { emissive: 0x0b4a66 }), 0, TURF_Y + 0.12, 0);
      rim.castShadow = false;
      // speed streak decals sweeping with time so the pad reads as powered-on
      if (!ghost) {
        const swirl = new THREE.Mesh(this.geo('boostSwirl', () => new THREE.TorusGeometry(1.05, 0.05, 6, 40, Math.PI * 0.9)),
          new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.75 }));
        swirl.position.set(0, TURF_Y + 0.13, 0); swirl.rotation.x = Math.PI / 2; swirl.rotation.z = -t * 3.2;
        grp.add(swirl);
      }
      for (const [i, off] of [-0.55, 0.1, 0.75].entries()) {
        const pulse = ghost ? 0 : Math.max(0, Math.sin(t * 5 - i * 1.1)) * 0.12;
        const arrow = new THREE.Mesh(this.geo('boostArrow', () => new THREE.ConeGeometry(0.24, 0.62, 4)), ghost ? fx(0xf0f9ff, 0.3) : this.mat(0xf0f9ff, 0.3, { emissive: 0x2a6f8f }));
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
    g.fillStyle = '#fbbf24'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#1f2937';
    for (let i = -2; i < 6; i++) { g.save(); g.translate(i * 32, 0); g.rotate(Math.PI / 4); g.fillRect(0, -64, 16, 256); g.restore(); }
    tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
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
    if (big) {
      const t = performance.now() / 1000;
      const bigR = fieldRadiusToWorld(BIG_BUMPER_RADIUS);
      for (const w of BUMPER_WORLD_POSITIONS) {
        // persistent super-charged bumper shell: enlarged glowing drum + dome
        this.mesh(this.dynamic, this.geo('bigBumperBase', () => new THREE.CylinderGeometry(1.02, 1.14, 0.34, 40)), this.mat(0xb3421f, 0.5), w.x, 1.2, w.z, true);
        this.mesh(this.dynamic, this.geo('bigBumperDrum', () => new THREE.CylinderGeometry(0.94, 1.0, 0.52, 40)), this.mat(0xf97316, 0.35, { emissive: 0x7a2e08 }), w.x, 1.6, w.z, true);
        this.mesh(this.dynamic, this.geo('bigBumperCap', () => new THREE.CylinderGeometry(1.0, 1.0, 0.12, 40)), this.mat(0xffd166, 0.3, { emissive: 0x6b4d0a }), w.x, 1.9, w.z, true);
        const dome = this.mesh(this.dynamic, this.geo('bigBumperDome', () => new THREE.SphereGeometry(0.5, 28, 16)), this.mat(0xffe08a, 0.25, { emissive: 0x8a5a12 }), w.x, 2.12, w.z, true);
        dome.scale.setScalar(1 + Math.sin(t * 6) * 0.05);
        const ring = new THREE.Mesh(this.geo('bumperBigRing', () => new THREE.TorusGeometry(1, 0.07, 8, 48)),
          new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.55 + Math.sin(t * 6) * 0.25 }));
        ring.position.set(w.x, TURF_Y + 0.08, w.z);
        ring.rotation.x = Math.PI / 2;
        ring.scale.setScalar(bigR + 0.25 + Math.sin(t * 6) * 0.08);
        this.dynamic.add(ring);
      }
      const banner = this.text('BIG BUMPERS!', 34, '#ffb454');
      banner.position.set(0, 4.2, FIELD_Z / 2 + 0.6);
      this.dynamic.add(banner);
    }
    for (const ev of state.bumperEvents ?? []) {
      const age = (now - ev.at) / 650;
      if (age < 0 || age > 1) continue;
      const w = fieldToWorld(ev.pos);
      const fade = 1 - age;
      const ring = new THREE.Mesh(this.geo('bumperPulse', () => new THREE.TorusGeometry(1, 0.06, 8, 48)),
        new THREE.MeshBasicMaterial({ color: 0xffe86a, transparent: true, opacity: 0.85 * fade }));
      ring.position.set(w.x, TURF_Y + 0.1 + age * 0.5, w.z);
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(fieldRadiusToWorld(BUMPER_RADIUS) + age * 1.9);
      this.dynamic.add(ring);
      const glow = new THREE.Mesh(this.geo('bumperGlow', () => new THREE.SphereGeometry(1, 20, 12)),
        new THREE.MeshBasicMaterial({ color: 0xfff3be, transparent: true, opacity: 0.5 * fade, depthWrite: false }));
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
      // rising violet burst ring at the lip
      const ring = new THREE.Mesh(this.geo('rampPulse', () => new THREE.TorusGeometry(1, 0.06, 8, 48)),
        new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.8 * fade }));
      ring.position.set(w.x, TURF_Y + 0.15 + age * 1.4, w.z);
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(0.5 + age * 1.6);
      this.dynamic.add(ring);
      const spark = new THREE.Mesh(this.geo('rampSpark', () => new THREE.SphereGeometry(1, 16, 10)),
        new THREE.MeshBasicMaterial({ color: 0xede9fe, transparent: true, opacity: 0.55 * fade, depthWrite: false }));
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
      new THREE.MeshBasicMaterial({ color: active ? 0x38f0e6 : 0xfff3be, transparent: true, opacity: active ? 0.95 : 0.4 + Math.sin(t * 2.4) * 0.12 }));
    ring.position.set(w.x, TURF_Y + 0.06, w.z);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = active ? t * 2 : 0;
    ring.scale.setScalar(1.75);
    this.dynamic.add(ring);
    if (!active) {
      const handle = this.text('⟳', 30, '#fff3be');
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
      new THREE.LineDashedMaterial({ color: 0xfff3be, dashSize: 0.28, gapSize: 0.2, transparent: true, opacity: 0.85 })
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
    const color = new THREE.Color().lerpColors(new THREE.Color(0xffe86a), new THREE.Color(0xff5340), power);
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
  private buildHud(state: GameState) {
    const left = Object.values(state.players).find(p => p.side === 'left');
    const right = Object.values(state.players).find(p => p.side === 'right');
    const board = this.scorePanel(state.score.left, state.score.right, state.turn, state.config.maxTurns, TEAMS[left?.team ?? 'pigs'].emoji, TEAMS[right?.team ?? 'snow'].emoji);
    board.position.set(0, 4.6, -FIELD_Z / 2 - 1.4);
    this.dynamic.add(board);
    const logo = this.text('BABBLE\nLEAGUE', 52, '#ffd94f');
    logo.position.set(FIELD_X / 2 - 1.3, 4.4, -FIELD_Z / 2 - 1.2);
    logo.scale.multiplyScalar(0.85);
    this.dynamic.add(logo);
    if (state.phase === 'finished' && state.winner) {
      const banner = this.text(`${state.winner === 'left' ? 'LEFT' : 'RIGHT'} WINS!`, 58, '#ffe86a');
      banner.position.set(0, 3.2, 0); banner.scale.multiplyScalar(1.6); this.dynamic.add(banner);
    }
  }

  private scorePanel(l: number, r: number, turn: number, maxTurns: number, le: string, re: string) {
    const key = `panel:${l}:${r}:${turn}:${maxTurns}:${le}${re}`;
    let tex = this.textCache.get(key);
    if (!tex) {
      const c = document.createElement('canvas'); c.width = 640; c.height = 224;
      const g = c.getContext('2d')!;
      // chunky rounded slab
      g.fillStyle = 'rgba(60,26,22,.92)';
      this.roundRect(g, 10, 14, 620, 150, 34); g.fill();
      g.strokeStyle = '#ffd94f'; g.lineWidth = 8;
      this.roundRect(g, 10, 14, 620, 150, 34); g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 64px Fredoka, Arial';
      g.fillStyle = '#fff8cf';
      g.fillText(le, 110, 88);
      g.fillText(re, 530, 88);
      g.font = '900 84px Fredoka, Arial';
      g.strokeStyle = 'rgba(20,8,6,.8)'; g.lineWidth = 8;
      g.strokeText(`${l}`, 220, 90); g.fillText(`${l}`, 220, 90);
      g.strokeText(`${r}`, 420, 90); g.fillText(`${r}`, 420, 90);
      g.fillStyle = '#ffd94f'; g.font = '900 44px Fredoka, Arial';
      g.fillText('–', 320, 84);
      g.font = '800 34px Fredoka, Arial'; g.fillStyle = '#ffe9a8';
      g.fillText(`TURN ${turn} / ${maxTurns}`, 320, 196);
      tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
      this.textCache.set(key, tex);
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(6.4, 2.24, 1);
    return sp;
  }

  private roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  private turfTexture() {
    const key = 'turfTexture';
    let tex = this.textCache.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i % 2 ? '#56c6c8' : '#32adb2';
      g.fillRect(i * c.width / 10, 0, c.width / 10, c.height);
    }
    g.strokeStyle = 'rgba(255,255,255,.85)';
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
    tex.anisotropy = 4;
    this.textCache.set(key, tex);
    return tex;
  }

  private text(text: string, size = 32, fill = '#fff8cf') {
    const key = `${text}|${size}|${fill}`;
    let tex = this.textCache.get(key);
    if (!tex) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 256;
      const g = c.getContext('2d')!;
      g.font = `900 ${size * 2}px Fredoka, Arial`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(40,14,10,.55)'; g.shadowBlur = 0; g.shadowOffsetY = 7;
      g.strokeStyle = 'rgba(62,26,20,.9)'; g.lineWidth = 14; g.lineJoin = 'round';
      g.fillStyle = fill;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const y = 128 + (i - (lines.length - 1) / 2) * size * 1.9;
        g.strokeText(line, 256, y);
        g.fillText(line, 256, y);
      });
      tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
      this.textCache.set(key, tex);
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(size / 12, size / 24, 1);
    return sp;
  }
}
