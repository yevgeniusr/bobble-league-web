import * as THREE from 'three';
import { BOX_TYPES, FIELD, GameState, TEAMS, Vec } from '../../shared/types';

export type WorldXZ = { x: number; z: number };
export type RenderInput = { state: GameState; you: string; drag: { bobbleId: string; start: Vec; current: Vec } | null };

export function fieldToWorld(p: Vec): WorldXZ { return { x: (p.x - FIELD.width / 2) / 50, z: (p.y - FIELD.height / 2) / 50 }; }
export function worldToField(p: WorldXZ): Vec { return { x: p.x * 50 + FIELD.width / 2, y: p.z * 50 + FIELD.height / 2 }; }
export function fieldRadiusToWorld(r: number): number { return r / 50; }

const FIELD_X = FIELD.width / 50;
const FIELD_Z = FIELD.height / 50;
const toV3 = (p: Vec, y = 0) => { const w = fieldToWorld(p); return new THREE.Vector3(w.x, y, w.z); };

export class BobbleLeague3DRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private textCache = new Map<string, THREE.CanvasTexture>();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xf16845, 1);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 16.2, 14.4);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f4a46, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 3.4);
    sun.position.set(-5, 14, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left=-18; sun.shadow.camera.right=18; sun.shadow.camera.top=14; sun.shadow.camera.bottom=-14;
    this.scene.add(sun);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  dispose() { window.removeEventListener('resize', this.resize); this.renderer.dispose(); for (const t of this.textCache.values()) t.dispose(); }
  private resize = () => { const rect = this.canvas.getBoundingClientRect(); const w = Math.max(320, rect.width || window.innerWidth); const h = Math.max(180, rect.height || window.innerHeight); this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); };

  pointFromClient(clientX: number, clientY: number): Vec | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const hit = new THREE.Vector3();
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, hit) ? worldToField({ x: hit.x, z: hit.z }) : null;
  }

  render({ state, you, drag }: RenderInput) {
    this.clearDynamic();
    this.buildBoard();
    this.buildHud(state);
    for (const obj of state.fieldObjects) this.addFieldObject(obj.type, obj.pos, obj.angle);
    for (const box of state.boxes) this.addPowerBox(box.pos, BOX_TYPES[box.type].color);
    const actors = [...state.bobbles.map(b => ({ y: b.pos.y, kind: 'bobble' as const, b })), { y: state.ball.pos.y, kind: 'ball' as const, b: null }].sort((a,b)=>a.y-b.y);
    for (const actor of actors) actor.kind === 'ball' ? this.addBall(state.ball.pos, state.ball.radius) : this.addBobble(actor.b, state, you);
    if (drag) this.addAimLine(drag.start, drag.current);
    this.renderer.render(this.scene, this.camera);
  }

  private clearDynamic() { [...this.scene.children].forEach(o => { if (!['Camera','HemisphereLight','DirectionalLight'].includes(o.type)) this.scene.remove(o); }); }
  private mat(color: number | string, roughness=.5) { return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0.03 }); }
  private box(color: number | string, pos: THREE.Vector3, scale: THREE.Vector3, cast=false) { const m = new THREE.Mesh(new THREE.BoxGeometry(scale.x, scale.y, scale.z), this.mat(color)); m.position.copy(pos); m.castShadow=cast; m.receiveShadow=true; this.scene.add(m); return m; }
  private line(a: Vec, b: Vec, color=0xffe86a) { const g = new THREE.BufferGeometry().setFromPoints([toV3(a,2.25), toV3(b,2.25)]); this.scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color }))); }

  private buildBoard() {
    this.box(0xf16845, new THREE.Vector3(-FIELD_X/4, -0.45, 0), new THREE.Vector3(FIELD_X/2, .7, FIELD_Z+3.2));
    this.box(0xef5b43, new THREE.Vector3(FIELD_X/4, -0.45, 0), new THREE.Vector3(FIELD_X/2, .7, FIELD_Z+3.2));
    this.box(0xfff3be, new THREE.Vector3(0, 0, 0), new THREE.Vector3(FIELD_X+2.4, .76, FIELD_Z+2.2), true);
    this.box(0xf7b43a, new THREE.Vector3(0, .44, 0), new THREE.Vector3(FIELD_X+1, .84, FIELD_Z+.8), true);
    this.box(0x44b84f, new THREE.Vector3(0, .82, 0), new THREE.Vector3(FIELD_X-2.2, .24, FIELD_Z-2.7), true);
    for (let i=0;i<8;i++) this.box(i%2?0x57c761:0x38a947, new THREE.Vector3(-FIELD_X/2+2.2+i*(FIELD_X-4.4)/8+(FIELD_X-4.4)/16, .98, 0), new THREE.Vector3((FIELD_X-4.4)/8, .08, FIELD_Z-3));
    this.addFieldLine(new THREE.Vector3(0,1.08,-FIELD_Z/2+1.6), new THREE.Vector3(0,1.08,FIELD_Z/2-1.6));
    this.addRing(new THREE.Vector3(0,1.09,0), 1.45, 0xffffff);
    this.addGoal(-1); this.addGoal(1); this.addBumper(-FIELD_X/2+2.35, -FIELD_Z/2+2.1); this.addBumper(FIELD_X/2-2.35, -FIELD_Z/2+2.1);
  }
  private addFieldLine(a: THREE.Vector3, b: THREE.Vector3) { this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]), new THREE.LineBasicMaterial({ color: 0xffffff }))); }
  private addRing(pos: THREE.Vector3, r: number, color: number) { const mesh = new THREE.Mesh(new THREE.TorusGeometry(r,.04,8,96), new THREE.MeshBasicMaterial({ color })); mesh.position.copy(pos); mesh.rotation.x=Math.PI/2; this.scene.add(mesh); }
  private addGoal(side: -1|1) { const x = side*(FIELD_X/2-.55); const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.65,.13,14,64,Math.PI), this.mat(side<0?0x4a5ad6:0xf05d48,.36)); hoop.position.set(x,1.25,0); hoop.rotation.set(Math.PI/2,0,side<0?Math.PI/2:-Math.PI/2); hoop.castShadow=true; this.scene.add(hoop); }
  private addBumper(x:number,z:number) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.68,.68,.5,48), this.mat(0xc94d5b,.38)); c.position.set(x,1.35,z); c.castShadow=true; this.scene.add(c); const top = new THREE.Mesh(new THREE.SphereGeometry(.38,32,16), this.mat(0xf4d3b0,.32)); top.position.set(x,1.75,z); top.castShadow=true; this.scene.add(top); }
  private shadow(x:number,z:number,r:number){const m=new THREE.Mesh(new THREE.CircleGeometry(r,48),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.22,depthWrite:false})); m.position.set(x,1.105,z); m.rotation.x=-Math.PI/2; this.scene.add(m);}

  private addBobble(b: GameState['bobbles'][number], state: GameState, you: string) { const player = Object.values(state.players).find(p => p.side === b.side && p.controlledBobbleIds.includes(b.id)) ?? Object.values(state.players).find(p => p.side === b.side); const team = TEAMS[player?.team ?? 'pigs']; const w = fieldToWorld(b.pos); this.shadow(w.x,w.z,fieldRadiusToWorld(b.radius)*1.45); const base = new THREE.Mesh(new THREE.CylinderGeometry(fieldRadiusToWorld(b.radius)*1.1, fieldRadiusToWorld(b.radius)*1.25, .38, 48), this.mat(b.side==='left'?0xe25a4c:0x5147a8,.38)); base.position.set(w.x,1.36,w.z); base.castShadow=true; this.scene.add(base); const head = new THREE.Mesh(new THREE.SphereGeometry(fieldRadiusToWorld(b.radius)*.96,48,32), this.mat(team.primary,.32)); head.position.set(w.x,1.86,w.z); head.scale.y=1.08; head.castShadow=true; this.scene.add(head); const sprite = this.text(team.emoji, 42); sprite.position.set(w.x,1.92,w.z+.5); this.scene.add(sprite); if (state.players[you]?.controlledBobbleIds.includes(b.id)) this.addRing(new THREE.Vector3(w.x,1.05,w.z), fieldRadiusToWorld(b.radius)*1.5, 0xffe86a); }
  private addBall(p: Vec, r: number) { const w=fieldToWorld(p); this.shadow(w.x,w.z,fieldRadiusToWorld(r)*1.5); const ball = new THREE.Mesh(new THREE.SphereGeometry(fieldRadiusToWorld(r),32,20), this.mat(0xffffff,.28)); ball.position.set(w.x,1.35,w.z); ball.castShadow=true; this.scene.add(ball); for(let i=0;i<6;i++){const spot=new THREE.Mesh(new THREE.SphereGeometry(fieldRadiusToWorld(r)*.18,12,8),new THREE.MeshBasicMaterial({color:0x171717})); const a=i*Math.PI*2/6; spot.position.set(w.x+Math.cos(a)*fieldRadiusToWorld(r)*.62,1.35+Math.sin(a)*fieldRadiusToWorld(r)*.2,w.z+fieldRadiusToWorld(r)*.75); this.scene.add(spot);} }
  private addPowerBox(p: Vec, color: string) { const w=fieldToWorld(p); const cube = new THREE.Mesh(new THREE.BoxGeometry(.7,.7,.7), this.mat(color,.22)); cube.position.set(w.x,1.55,w.z); cube.rotation.y=.7; cube.castShadow=true; this.scene.add(cube); const q=this.text('?',36); q.position.set(w.x,1.85,w.z+.5); this.scene.add(q); }
  private addFieldObject(type:string,p:Vec,angle:number){const colors:Record<string,number>={stickyGoo:0x84cc16,block:0xdbeafe,ramp:0xa78bfa,boost:0x38bdf8}; const w=fieldToWorld(p); const o=new THREE.Mesh(new THREE.BoxGeometry(1.2,.28,.65),this.mat(colors[type]??0xffffff,.34)); o.position.set(w.x,1.25,w.z); o.rotation.y=-angle; o.castShadow=true; this.scene.add(o);}
  private addAimLine(start: Vec, current: Vec) { this.line(start,current,0xffe86a); }
  private buildHud(state:GameState){const s=this.text(`${state.score.left}     ${state.turn}/${state.config.maxTurns}     ${state.score.right}`,38); s.position.set(0,4.05,-FIELD_Z/2+1.2); this.scene.add(s); const logo=this.text('Bobble\nLeague',32); logo.position.set(FIELD_X/2-1.9,4.05,-FIELD_Z/2+1.35); this.scene.add(logo);}
  private text(text:string,size=32){let tex=this.textCache.get(text+size); if(!tex){const c=document.createElement('canvas'); c.width=256; c.height=128; const g=c.getContext('2d')!; g.font=`900 ${size}px Fredoka, Arial`; g.textAlign='center'; g.textBaseline='middle'; g.fillStyle='#fff8cf'; g.strokeStyle='rgba(80,40,35,.75)'; g.lineWidth=5; text.split('\n').forEach((line,i,arr)=>{const y=64+(i-(arr.length-1)/2)*size*.85; g.strokeText(line,128,y); g.fillText(line,128,y);}); tex=new THREE.CanvasTexture(c); this.textCache.set(text+size,tex);} const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true})); sp.scale.set(size/15,size/30,1); return sp;}
}
