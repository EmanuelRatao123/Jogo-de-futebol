import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GENERATED_ASSETS } from './assets';
import { audioEngine } from './audio';
import {
  buildWallForSpot,
  chooseKeeperDecision,
  computeShotLaunch,
  createInitialBallState,
  createInitialKeeperState,
  sampleTrajectoryPreview,
  stepBallAndActors,
} from './physics';
import { loadChromaKeyedSpritesheet } from './spritesheetProcessor';
import {
  BALL_RADIUS,
  BallSimState,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GOAL_Z,
  GameMode,
  GameScreenState,
  KeeperPose,
  KeeperSimState,
  KickSpot,
  POST_RADIUS,
  SHOT_TYPES,
  ShotOutcome,
  ShotParams,
  WallDefender,
} from './types';

export interface RadarTelemetry {
  ball: { x: number; y: number; z: number };
  trail: Array<{ x: number; y: number; z: number }>;
  keeper: { x: number; z: number; pose: KeeperPose };
  wall: Array<{ x: number; z: number; y: number }>;
  spot: KickSpot;
  preview: Array<{ x: number; y: number; z: number }>;
}

export interface StadiumCallbacks {
  onShotComplete: (outcome: ShotOutcome, hitPost: boolean, speedKmh: number) => void;
  onAimChange: (aimX: number, aimY: number) => void;
  onLiveTelemetry: (telemetry: RadarTelemetry) => void;
  onSpritesReady?: (keeperFrames: HTMLCanvasElement[], defenderFrames: HTMLCanvasElement[]) => void;
}

const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

interface ParticleSlot {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

function detectSoftwareGl(): boolean {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param) ?? '');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

function createPitchMarkingsTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 1024);

  // Maps onto a 74m wide x 60m deep half-pitch plane centered at (0, -27)
  // X range: -37 to +37 (74m), Z range: -57 to +3 (60m)
  const toPxX = (x: number) => ((x + 37) / 74) * 1024;
  const toPxZ = (z: number) => ((z + 57) / 60) * 1024;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 4;

  // Touchlines & Goal line (pitch width 68m -> -34 to 34, goal line at -52.5)
  const left = toPxX(-34);
  const right = toPxX(34);
  const goalY = toPxZ(GOAL_Z);
  const midY = toPxZ(0);

  ctx.strokeRect(left, goalY, right - left, midY - goalY);

  // Penalty Area (40.32m wide x 16.5m deep)
  const penLeft = toPxX(-20.16);
  const penW = toPxX(20.16) - penLeft;
  const penH = toPxZ(GOAL_Z + 16.5) - goalY;
  ctx.strokeRect(penLeft, goalY, penW, penH);

  // 6-yard box (18.32m wide x 5.5m deep)
  const sixLeft = toPxX(-9.16);
  const sixW = toPxX(9.16) - sixLeft;
  const sixH = toPxZ(GOAL_Z + 5.5) - goalY;
  ctx.strokeRect(sixLeft, goalY, sixW, sixH);

  // Penalty spot
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.arc(toPxX(0), toPxZ(GOAL_Z + 11), 5, 0, Math.PI * 2);
  ctx.fill();

  // Penalty Arc (radius 9.15m centered on penalty spot, outside 16.5m box)
  const arcR = (9.15 / 74) * 1024;
  ctx.beginPath();
  ctx.arc(toPxX(0), toPxZ(GOAL_Z + 11), arcR, 0.64, Math.PI - 0.64);
  ctx.stroke();

  // Halfway circle top
  ctx.beginPath();
  ctx.arc(toPxX(0), midY, arcR, Math.PI, 0);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createAdBoardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#091826';
  ctx.fillRect(0, 0, 1024, 128);

  const panels = [
    { bg: '#064e3b', fg: '#ecfdf5', text: 'CAMISA 10' },
    { bg: '#0f172a', fg: '#f59e0b', text: 'COPA ESTADIO' },
    { bg: '#1e293b', fg: '#38bdf8', text: 'PRECISÃO & CURVA' },
    { bg: '#78350f', fg: '#fef3c7', text: 'BOLA PARADA' },
  ];

  const pw = 256;
  panels.forEach((p, idx) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(idx * pw + 4, 8, pw - 8, 112);
    ctx.clip();

    ctx.fillStyle = p.bg;
    ctx.fillRect(idx * pw + 4, 8, pw - 8, 112);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 3;
    ctx.strokeRect(idx * pw + 4, 8, pw - 8, 112);

    ctx.fillStyle = p.fg;
    ctx.font = 'bold 24px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text, idx * pw + pw / 2, 64);
    ctx.restore();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

function createProceduralBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 256);

  // Subtle geometric championship stripes so spin is super legible
  ctx.fillStyle = '#0f172a';
  for (let i = 0; i < 6; i++) {
    const cx = (i + 0.5) * (512 / 6);
    ctx.beginPath();
    ctx.arc(cx, 128, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  ctx.fillStyle = '#1e293b';
  for (let i = 0; i < 6; i++) {
    const cx = i * (512 / 6);
    ctx.beginPath();
    ctx.arc(cx, 48, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, 208, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createPlaceholderSpriteTexture(label: 'keeper' | 'defender'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  ctx.fillStyle = label === 'keeper' ? '#f59e0b' : '#1d4ed8';
  ctx.beginPath();
  ctx.roundRect(92, 68, 72, 92, 16);
  ctx.fill();

  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(128, 46, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(96, 158, 26, 76);
  ctx.fillRect(134, 158, 26, 76);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class StadiumScene {
  private container: HTMLElement;
  private callbacks: StadiumCallbacks;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;

  private screenState: GameScreenState = 'title';
  private mode: GameMode = 'penalty';
  private roundIndex = 0;
  private spot: KickSpot;
  private shotParams: ShotParams = {
    aimX: 0.45,
    aimY: 0.55,
    power: 0.78,
    curve: 0.35,
    elevationBias: 0,
    shotType: 'placed',
  };

  private ballSim: BallSimState;
  private keeperSim: KeeperSimState;
  private wallSim: WallDefender[] = [];
  private keeperDecision = { diveDir: 0 as -1 | 0 | 1, targetX: 0, targetY: 0.8, reactionDelay: 0.1 };

  private postShotTimer = 0;
  private shotResolved = false;
  private hitstopTimer = 0;
  private cameraTrauma = 0;
  private cameraPos = new THREE.Vector3(0, 3.2, -32);
  private cameraTarget = new THREE.Vector3(0, 1.3, GOAL_Z);

  // Scene objects
  private ballMesh!: THREE.Mesh;
  private ballShadow!: THREE.Mesh;
  private keeperMesh!: THREE.Mesh;
  private keeperShadow!: THREE.Mesh;
  private wallMeshes: THREE.Mesh[] = [];
  private wallShadows: THREE.Mesh[] = [];
  private aimReticleGroup!: THREE.Group;
  private aimRingMat!: THREE.MeshBasicMaterial;
  private previewDots!: THREE.InstancedMesh;
  private netBackGeo!: THREE.PlaneGeometry;
  private netBaseZ!: Float32Array;
  private netRippleTime = 0;
  private netRippleOrigin = new THREE.Vector2(0, 1.2);

  // Particle pool
  private particleMesh!: THREE.InstancedMesh;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;

  // Spritesheet textures
  private keeperTextures: Record<KeeperPose, THREE.Texture>;
  private defenderTextures: Record<'guard' | 'jump' | 'celebrate', THREE.Texture>;

  // Raycaster for aiming on goal plane
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -GOAL_Z);
  private isDraggingAim = false;

  // Texture & disposable tracking
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(container: HTMLElement, spot: KickSpot, callbacks: StadiumCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.spot = spot;
    this.ballSim = createInitialBallState(spot);
    this.keeperSim = createInitialKeeperState(spot, this.mode);
    this.wallSim = buildWallForSpot(spot, this.mode);

    this.isSoftwareGl = detectSoftwareGl();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const rect = container.getBoundingClientRect();
    const w = Math.max(300, rect.width || window.innerWidth);
    const h = Math.max(200, rect.height || window.innerHeight);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1626);
    this.scene.fog = new THREE.FogExp2(0x0a1626, 0.0082);

    this.camera = new THREE.PerspectiveCamera(44, w / h, 0.2, 260);
    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.cameraTarget);

    // Mandatory studio environment map
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Default placeholder textures while generated spritesheets load
    const kFallback = createPlaceholderSpriteTexture('keeper');
    const dFallback = createPlaceholderSpriteTexture('defender');
    this.disposables.push(kFallback, dFallback);
    this.keeperTextures = {
      ready: kFallback,
      jump: kFallback,
      dive_right: kFallback,
      dive_left: kFallback,
    };
    this.defenderTextures = {
      guard: dFallback,
      jump: dFallback,
      celebrate: dFallback,
    };

    this.setupLighting();
    this.buildStadiumEnvironment();
    this.buildGoalAndNet();
    this.buildBallAndShadows();
    this.buildActors();
    this.buildAimAndTrajectory();
    this.buildParticles();
    this.loadGeneratedAssets();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.syncSceneToState(0.016);
    this.tick();
  }

  private setupLighting() {
    const hemi = new THREE.HemisphereLight(0x8ec5fc, 0x1e3a2f, 0.85);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    keyLight.position.set(22, 34, -18);
    keyLight.target.position.set(0, 0, GOAL_Z + 8);
    this.scene.add(keyLight.target);
    this.scene.add(keyLight);

    if (!this.isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 4;
      keyLight.shadow.camera.far = 95;
      keyLight.shadow.camera.left = -28;
      keyLight.shadow.camera.right = 28;
      keyLight.shadow.camera.top = 28;
      keyLight.shadow.camera.bottom = -28;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.9);
    rimLight.position.set(-24, 18, -66);
    this.scene.add(rimLight);
  }

  private buildStadiumEnvironment() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    // Extended stadium ground skirt so no void is ever visible
    const outerGroundGeo = new THREE.PlaneGeometry(240, 240);
    const outerGroundMat = new THREE.MeshStandardMaterial({
      color: 0x0e2a1e,
      roughness: 0.95,
      metalness: 0.0,
    });
    const outerGround = new THREE.Mesh(outerGroundGeo, outerGroundMat);
    outerGround.rotation.x = -Math.PI / 2;
    outerGround.position.set(0, -0.02, -25);
    outerGround.receiveShadow = true;
    this.scene.add(outerGround);
    this.disposables.push(outerGroundGeo, outerGroundMat);

    // Main playable pitch surface textured with generated pitch_grass_map
    const texLoader = new THREE.TextureLoader();
    const grassTex = texLoader.load(GENERATED_ASSETS.pitchGrassMap);
    grassTex.colorSpace = THREE.SRGBColorSpace;
    grassTex.wrapS = THREE.RepeatWrapping;
    grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(7, 6);
    grassTex.anisotropy = maxAniso;
    this.disposables.push(grassTex);

    const pitchGeo = new THREE.PlaneGeometry(74, 60);
    const pitchMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: grassTex,
      roughness: 0.88,
      metalness: 0.0,
    });
    const pitch = new THREE.Mesh(pitchGeo, pitchMat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(0, 0, -27);
    pitch.receiveShadow = true;
    this.scene.add(pitch);
    this.disposables.push(pitchGeo, pitchMat);

    // Pitch white lines overlay (+0.02m Y offset to prevent Z-fighting)
    const linesTex = createPitchMarkingsTexture();
    linesTex.anisotropy = maxAniso;
    const linesGeo = new THREE.PlaneGeometry(74, 60);
    const linesMat = new THREE.MeshBasicMaterial({
      map: linesTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const linesMesh = new THREE.Mesh(linesGeo, linesMat);
    linesMesh.rotation.x = -Math.PI / 2;
    linesMesh.position.set(0, 0.02, -27);
    this.scene.add(linesMesh);
    this.disposables.push(linesTex, linesGeo, linesMat);

    // Perimeter LED advertising boards
    const adTex = createAdBoardTexture();
    adTex.anisotropy = maxAniso;
    const adMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: adTex,
      emissive: 0xffffff,
      emissiveMap: adTex,
      emissiveIntensity: 0.35,
      roughness: 0.45,
    });

    const backAdGeo = new THREE.BoxGeometry(68, 1.05, 0.28);
    const backAd = new THREE.Mesh(backAdGeo, adMat);
    backAd.position.set(0, 0.525, GOAL_Z - 5.2);
    this.scene.add(backAd);

    const sideAdGeo = new THREE.BoxGeometry(0.28, 1.05, 58);
    const leftAd = new THREE.Mesh(sideAdGeo, adMat);
    leftAd.position.set(-36.5, 0.525, -28);
    const rightAd = new THREE.Mesh(sideAdGeo, adMat);
    rightAd.position.set(36.5, 0.525, -28);
    this.scene.add(leftAd, rightAd);
    this.disposables.push(adTex, adMat, backAdGeo, sideAdGeo);

    // Stadium tiered stands with generated stadium_crowd_map
    const crowdTex = texLoader.load(GENERATED_ASSETS.stadiumCrowdMap);
    crowdTex.colorSpace = THREE.SRGBColorSpace;
    crowdTex.wrapS = THREE.ClampToEdgeWrapping;
    crowdTex.wrapT = THREE.ClampToEdgeWrapping;
    // Crop ~4% margin to avoid outer border on generated illustration
    crowdTex.repeat.set(0.92, 0.92);
    crowdTex.offset.set(0.04, 0.04);
    crowdTex.anisotropy = maxAniso;
    this.disposables.push(crowdTex);

    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x1a2634,
      roughness: 0.85,
      metalness: 0.1,
    });
    const crowdMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: crowdTex,
      emissive: 0x223344,
      emissiveMap: crowdTex,
      emissiveIntensity: 0.45,
      roughness: 0.75,
    });

    // North Stand behind the goal
    const standGroup = new THREE.Group();
    const northBaseGeo = new THREE.BoxGeometry(82, 3.5, 10);
    const northBase = new THREE.Mesh(northBaseGeo, concreteMat);
    northBase.position.set(0, 1.75, GOAL_Z - 14);
    standGroup.add(northBase);

    const northCrowdGeo = new THREE.PlaneGeometry(78, 22);
    const northCrowd = new THREE.Mesh(northCrowdGeo, crowdMat);
    northCrowd.position.set(0, 11.5, GOAL_Z - 16);
    northCrowd.rotation.x = 0.24;
    standGroup.add(northCrowd);

    // Roof canopy over North Stand
    const roofGeo = new THREE.BoxGeometry(82, 0.6, 14);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.45,
      metalness: 0.65,
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, 22.8, GOAL_Z - 15.5);
    roof.rotation.x = 0.12;
    standGroup.add(roof);

    // Side Stands (West & East)
    const sideStandGeo = new THREE.PlaneGeometry(66, 18);
    const westStand = new THREE.Mesh(sideStandGeo, crowdMat);
    westStand.position.set(-46, 9.5, -28);
    westStand.rotation.y = Math.PI / 2;
    westStand.rotation.x = 0.22;
    standGroup.add(westStand);

    const eastStand = new THREE.Mesh(sideStandGeo, crowdMat);
    eastStand.position.set(46, 9.5, -28);
    eastStand.rotation.y = -Math.PI / 2;
    eastStand.rotation.x = 0.22;
    standGroup.add(eastStand);

    this.scene.add(standGroup);
    this.disposables.push(concreteMat, crowdMat, northBaseGeo, northCrowdGeo, roofGeo, roofMat, sideStandGeo);

    // 4 Composite Floodlight Towers framing the stadium sky
    const mastGeo = new THREE.CylinderGeometry(0.35, 0.7, 34, 8);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4, metalness: 0.7 });
    const headGeo = new THREE.BoxGeometry(6.5, 3.2, 0.7);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.6 });
    const bulbGeo = new THREE.PlaneGeometry(5.8, 2.5);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });

    const towerCoords = [
      [-43, GOAL_Z - 14],
      [43, GOAL_Z - 14],
      [-45, 5],
      [45, 5],
    ];
    towerCoords.forEach(([tx, tz]) => {
      const tower = new THREE.Group();
      tower.position.set(tx, 0, tz);

      const mast = new THREE.Mesh(mastGeo, mastMat);
      mast.position.y = 17;
      tower.add(mast);

      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, 34.5, 0);
      head.lookAt(0, 0, GOAL_Z + 12);
      tower.add(head);

      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.z = 0.38;
      head.add(bulb);

      this.scene.add(tower);
    });
    this.disposables.push(mastGeo, mastMat, headGeo, headMat, bulbGeo, bulbMat);
  }

  private buildGoalAndNet() {
    const goalGroup = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.22,
      metalness: 0.35,
    });
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.35,
      metalness: 0.7,
    });

    // Left & Right posts (bottom-center grounded at y=0)
    const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, GOAL_HEIGHT, 16);
    const leftPost = new THREE.Mesh(postGeo, postMat);
    leftPost.position.set(-GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, GOAL_Z);
    leftPost.castShadow = true;

    const rightPost = new THREE.Mesh(postGeo, postMat);
    rightPost.position.set(GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, GOAL_Z);
    rightPost.castShadow = true;

    // Crossbar
    const barGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, GOAL_HALF_WIDTH * 2, 16);
    const crossbar = new THREE.Mesh(barGeo, postMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, GOAL_HEIGHT, GOAL_Z);
    crossbar.castShadow = true;

    // Corner joint caps
    const cornerGeo = new THREE.SphereGeometry(POST_RADIUS * 1.15, 12, 12);
    const cornerL = new THREE.Mesh(cornerGeo, jointMat);
    cornerL.position.set(-GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_Z);
    const cornerR = new THREE.Mesh(cornerGeo, jointMat);
    cornerR.position.set(GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_Z);

    // Rear stanchion bars & ground frame
    const sideDepthBarGeo = new THREE.CylinderGeometry(0.032, 0.032, GOAL_DEPTH, 10);
    const topL = new THREE.Mesh(sideDepthBarGeo, jointMat);
    topL.rotation.x = Math.PI / 2;
    topL.position.set(-GOAL_HALF_WIDTH, GOAL_HEIGHT - 0.1, GOAL_Z - GOAL_DEPTH / 2);

    const topR = new THREE.Mesh(sideDepthBarGeo, jointMat);
    topR.rotation.x = Math.PI / 2;
    topR.position.set(GOAL_HALF_WIDTH, GOAL_HEIGHT - 0.1, GOAL_Z - GOAL_DEPTH / 2);

    const botL = new THREE.Mesh(sideDepthBarGeo, jointMat);
    botL.rotation.x = Math.PI / 2;
    botL.position.set(-GOAL_HALF_WIDTH, 0.035, GOAL_Z - GOAL_DEPTH / 2);

    const botR = new THREE.Mesh(sideDepthBarGeo, jointMat);
    botR.rotation.x = Math.PI / 2;
    botR.position.set(GOAL_HALF_WIDTH, 0.035, GOAL_Z - GOAL_DEPTH / 2);

    const backGroundBarGeo = new THREE.CylinderGeometry(0.032, 0.032, GOAL_HALF_WIDTH * 2, 10);
    const backGroundBar = new THREE.Mesh(backGroundBarGeo, jointMat);
    backGroundBar.rotation.z = Math.PI / 2;
    backGroundBar.position.set(0, 0.035, GOAL_Z - GOAL_DEPTH);

    const rearPostGeo = new THREE.CylinderGeometry(0.032, 0.032, GOAL_HEIGHT - 0.1, 10);
    const rearL = new THREE.Mesh(rearPostGeo, jointMat);
    rearL.position.set(-GOAL_HALF_WIDTH, (GOAL_HEIGHT - 0.1) / 2, GOAL_Z - GOAL_DEPTH);
    const rearR = new THREE.Mesh(rearPostGeo, jointMat);
    rearR.position.set(GOAL_HALF_WIDTH, (GOAL_HEIGHT - 0.1) / 2, GOAL_Z - GOAL_DEPTH);

    goalGroup.add(
      leftPost,
      rightPost,
      crossbar,
      cornerL,
      cornerR,
      topL,
      topR,
      botL,
      botR,
      backGroundBar,
      rearL,
      rearR
    );

    // Goal net procedural mesh texture
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 64;
    netCanvas.height = 64;
    const nCtx = netCanvas.getContext('2d')!;
    nCtx.clearRect(0, 0, 64, 64);
    nCtx.strokeStyle = 'rgba(241, 245, 249, 0.78)';
    nCtx.lineWidth = 4;
    nCtx.strokeRect(0, 0, 64, 64);
    const netTex = new THREE.CanvasTexture(netCanvas);
    netTex.wrapS = THREE.RepeatWrapping;
    netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(28, 10);

    const netMat = new THREE.MeshBasicMaterial({
      map: netTex,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Subdivided back net so it ripples physically when the ball hits
    this.netBackGeo = new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT, 16, 8);
    this.netBaseZ = new Float32Array(this.netBackGeo.attributes.position.count);
    for (let i = 0; i < this.netBaseZ.length; i++) {
      this.netBaseZ[i] = this.netBackGeo.attributes.position.getZ(i);
    }
    const netBack = new THREE.Mesh(this.netBackGeo, netMat);
    netBack.position.set(0, GOAL_HEIGHT / 2, GOAL_Z - GOAL_DEPTH);
    goalGroup.add(netBack);

    const sideNetGeo = new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HEIGHT);
    const netLeft = new THREE.Mesh(sideNetGeo, netMat);
    netLeft.rotation.y = Math.PI / 2;
    netLeft.position.set(-GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, GOAL_Z - GOAL_DEPTH / 2);

    const netRight = new THREE.Mesh(sideNetGeo, netMat);
    netRight.rotation.y = -Math.PI / 2;
    netRight.position.set(GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, GOAL_Z - GOAL_DEPTH / 2);

    const topNetGeo = new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_DEPTH);
    const netTop = new THREE.Mesh(topNetGeo, netMat);
    netTop.rotation.x = Math.PI / 2;
    netTop.position.set(0, GOAL_HEIGHT - 0.05, GOAL_Z - GOAL_DEPTH / 2);

    goalGroup.add(netLeft, netRight, netTop);
    this.scene.add(goalGroup);

    this.disposables.push(
      postMat,
      jointMat,
      postGeo,
      barGeo,
      cornerGeo,
      sideDepthBarGeo,
      backGroundBarGeo,
      rearPostGeo,
      netTex,
      netMat,
      this.netBackGeo,
      sideNetGeo,
      topNetGeo
    );
  }

  private buildBallAndShadows() {
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 24, 24);
    const ballTex = createProceduralBallTexture();
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: ballTex,
      roughness: 0.35,
      metalness: 0.05,
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    const shadowTex = createContactShadowTexture();
    const shadowGeo = new THREE.CircleGeometry(BALL_RADIUS * 2.1, 20);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    });
    this.ballShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.025;
    this.scene.add(this.ballShadow);

    this.disposables.push(ballGeo, ballMat, ballTex, shadowTex, shadowGeo, shadowMat);
  }

  private buildActors() {
    const shadowTex = createContactShadowTexture();

    // Goalkeeper 2D Billboard Plane (bottom-center pivot)
    const keeperGeo = new THREE.PlaneGeometry(2.1, 2.1);
    keeperGeo.translate(0, 1.05, 0);
    const keeperMat = new THREE.MeshBasicMaterial({
      map: this.keeperTextures.ready,
      transparent: true,
      alphaTest: 0.12,
      side: THREE.DoubleSide,
    });
    this.keeperMesh = new THREE.Mesh(keeperGeo, keeperMat);
    this.scene.add(this.keeperMesh);

    const kShadowGeo = new THREE.CircleGeometry(0.65, 20);
    const kShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    });
    this.keeperShadow = new THREE.Mesh(kShadowGeo, kShadowMat);
    this.keeperShadow.rotation.x = -Math.PI / 2;
    this.keeperShadow.position.y = 0.025;
    this.scene.add(this.keeperShadow);

    // Pool up to 5 Wall Defenders
    const defGeo = new THREE.PlaneGeometry(1.75, 1.98);
    defGeo.translate(0, 0.99, 0);
    const defShadowGeo = new THREE.CircleGeometry(0.46, 16);

    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.defenderTextures.guard,
        transparent: true,
        alphaTest: 0.12,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(defGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.wallMeshes.push(mesh);

      const sMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.45,
      });
      const sMesh = new THREE.Mesh(defShadowGeo, sMat);
      sMesh.rotation.x = -Math.PI / 2;
      sMesh.position.y = 0.025;
      sMesh.visible = false;
      this.scene.add(sMesh);
      this.wallShadows.push(sMesh);
      this.disposables.push(mat, sMat);
    }

    this.disposables.push(shadowTex, keeperGeo, keeperMat, kShadowGeo, kShadowMat, defGeo, defShadowGeo);
  }

  private buildAimAndTrajectory() {
    this.aimReticleGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.24, 0.31, 28);
    this.aimRingMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const outerRing = new THREE.Mesh(ringGeo, this.aimRingMat);

    const innerDotGeo = new THREE.CircleGeometry(0.06, 16);
    const innerDot = new THREE.Mesh(innerDotGeo, this.aimRingMat);

    this.aimReticleGroup.add(outerRing, innerDot);
    this.aimReticleGroup.renderOrder = 10;
    this.scene.add(this.aimReticleGroup);

    const dotGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.72,
    });
    this.previewDots = new THREE.InstancedMesh(dotGeo, dotMat, 16);
    this.previewDots.frustumCulled = false;
    this.scene.add(this.previewDots);

    this.disposables.push(ringGeo, this.aimRingMat, innerDotGeo, dotGeo, dotMat);
  }

  private buildParticles() {
    const pGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const count = 48;
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, count);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);

    for (let i = 0; i < count; i++) {
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        color: new THREE.Color(0xffffff),
      });
      _mat4.makeScale(0, 0, 0);
      this.particleMesh.setMatrixAt(i, _mat4);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.disposables.push(pGeo, pMat);
  }

  private spawnBurst(origin: THREE.Vector3, count: number, paletteHex: number[], speedScale = 4.5) {
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % this.particles.length;

      slot.active = true;
      slot.pos.copy(origin);
      slot.vel.set(
        (Math.random() - 0.5) * speedScale * 2,
        Math.random() * speedScale * 1.4 + 1.2,
        (Math.random() - 0.5) * speedScale * 2
      );
      slot.life = 0;
      slot.maxLife = 0.45 + Math.random() * 0.45;
      slot.size = 0.7 + Math.random() * 1.1;
      slot.color.setHex(paletteHex[i % paletteHex.length]);
    }
  }

  private loadGeneratedAssets() {
    // 1. Load generated soccer ball map & project its central skin cleanly onto spherical ball texture
    const ballImg = new Image();
    ballImg.crossOrigin = 'anonymous';
    ballImg.onload = () => {
      if (this.disposed) return;
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Sample the central pentagon/hexagon design region so no unfolded grid edge shows
        const s = Math.min(ballImg.naturalWidth, ballImg.naturalHeight);
        const crop = s * 0.58;
        const offset = (s - crop) * 0.5;
        ctx.drawImage(ballImg, offset, offset, crop, crop, 0, 0, 512, 512);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        const mat = this.ballMesh.material as THREE.MeshStandardMaterial;
        mat.map = tex;
        mat.needsUpdate = true;
        this.disposables.push(tex);
      }
    };
    ballImg.src = GENERATED_ASSETS.soccerBallMap;

    // 2. Load Goalkeeper 2D Spritesheet (4 poses -> ready, jump, dive_right, + mirrored dive_left)
    loadChromaKeyedSpritesheet(GENERATED_ASSETS.goalkeeperSpritesheet, 4, {
      mirrorIndex: 2,
      targetSize: 384,
    })
      .then((sheet) => {
        if (this.disposed || sheet.frames.length < 4) return;
        const toTex = (c: HTMLCanvasElement) => {
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          this.disposables.push(t);
          return t;
        };
        this.keeperTextures = {
          ready: toTex(sheet.frames[0]),
          jump: toTex(sheet.frames[1]),
          dive_right: toTex(sheet.frames[2]),
          dive_left: toTex(sheet.frames[4] ?? sheet.frames[3]),
        };
        const mat = this.keeperMesh.material as THREE.MeshBasicMaterial;
        mat.map = this.keeperTextures[this.keeperSim.pose];
        mat.needsUpdate = true;
        this.notifySpritesIfReady(sheet.frames, null);
      })
      .catch(() => {
        // Fallback procedural keeper texture remains active
      });

    // 3. Load Defender 2D Spritesheet (3 poses -> guard, jump, celebrate)
    loadChromaKeyedSpritesheet(GENERATED_ASSETS.defenderSpritesheet, 3, {
      targetSize: 384,
    })
      .then((sheet) => {
        if (this.disposed || sheet.frames.length < 3) return;
        const toTex = (c: HTMLCanvasElement) => {
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          this.disposables.push(t);
          return t;
        };
        this.defenderTextures = {
          guard: toTex(sheet.frames[0]),
          jump: toTex(sheet.frames[1]),
          celebrate: toTex(sheet.frames[2]),
        };
        this.notifySpritesIfReady(null, sheet.frames);
      })
      .catch(() => {
        // Fallback procedural defender texture remains active
      });
  }

  private cachedKeeperFrames: HTMLCanvasElement[] | null = null;
  private cachedDefenderFrames: HTMLCanvasElement[] | null = null;
  private notifySpritesIfReady(
    kFrames: HTMLCanvasElement[] | null,
    dFrames: HTMLCanvasElement[] | null
  ) {
    if (kFrames) this.cachedKeeperFrames = kFrames;
    if (dFrames) this.cachedDefenderFrames = dFrames;
    if (this.cachedKeeperFrames && this.cachedDefenderFrames) {
      this.callbacks.onSpritesReady?.(this.cachedKeeperFrames, this.cachedDefenderFrames);
    }
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  private handleResize = () => {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(300, rect.width || window.innerWidth);
    const h = Math.max(200, rect.height || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private updateAimFromPointer(clientX: number, clientY: number) {
    if (this.screenState !== 'playing' || this.ballSim.active || this.shotResolved) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.aimPlane, _vec3A)) {
      const normX = THREE.MathUtils.clamp(_vec3A.x / GOAL_HALF_WIDTH, -1.25, 1.25);
      const normY = THREE.MathUtils.clamp(_vec3A.y / GOAL_HEIGHT, 0.08, 1.25);
      this.shotParams.aimX = normX;
      this.shotParams.aimY = normY;
      this.callbacks.onAimChange(normX, normY);
    }
  }

  private handlePointerDown = (e: PointerEvent) => {
    if (this.screenState !== 'playing' || this.ballSim.active || this.shotResolved) return;
    if (e.button !== 0) return;
    this.isDraggingAim = true;
    this.updateAimFromPointer(e.clientX, e.clientY);
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (!this.isDraggingAim) return;
    this.updateAimFromPointer(e.clientX, e.clientY);
  };

  private handlePointerUp = () => {
    this.isDraggingAim = false;
  };

  public setScreenState(state: GameScreenState) {
    this.screenState = state;
  }

  public setShotParams(params: ShotParams) {
    this.shotParams = { ...params };
  }

  public resetForSpot(spot: KickSpot, mode: GameMode, roundIndex: number) {
    this.spot = spot;
    this.mode = mode;
    this.roundIndex = roundIndex;
    this.ballSim = createInitialBallState(spot);
    this.keeperSim = createInitialKeeperState(spot, mode);
    this.wallSim = buildWallForSpot(spot, mode);
    this.postShotTimer = 0;
    this.shotResolved = false;
    this.hitstopTimer = 0;
    this.netRippleTime = 0;
  }

  public fireShot(params: ShotParams) {
    if (this.ballSim.active || this.shotResolved) return;
    this.shotParams = { ...params };
    const { vel, spin } = computeShotLaunch(params, this.spot, this.mode);
    this.ballSim.active = true;
    this.ballSim.vel = vel;
    this.ballSim.spin = spin;
    this.ballSim.shotType = params.shotType;
    this.ballSim.knuckleSeed = Math.random() * 10;
    this.ballSim.elapsed = 0;

    this.keeperDecision = chooseKeeperDecision(
      params,
      this.spot,
      this.mode,
      this.roundIndex,
      Math.random()
    );

    audioEngine.playKick(params.power, params.shotType);
    _vec3A.set(this.spot.x, 0.08, this.spot.z);
    this.spawnBurst(_vec3A, 10, [0x4d7c0f, 0x65a30d, 0xfef3c7], 3.5);
  }

  private updateNetRipple(dt: number) {
    if (this.netRippleTime <= 0) return;
    this.netRippleTime = Math.max(0, this.netRippleTime - dt);
    const amp = this.netRippleTime * 0.55;
    const posAttr = this.netBackGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const ly = posAttr.getY(i) + GOAL_HEIGHT / 2;
      const dist = Math.hypot(lx - this.netRippleOrigin.x, ly - this.netRippleOrigin.y);
      const wave = Math.sin(dist * 3.2 - (1.2 - this.netRippleTime) * 20) * Math.exp(-dist * 0.45);
      posAttr.setZ(i, this.netBaseZ[i] - Math.max(0, wave * amp + amp * 0.35));
    }
    posAttr.needsUpdate = true;
  }

  private updateParticles(dt: number) {
    let anyUpdated = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyUpdated = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _mat4.makeScale(0, 0, 0);
        this.particleMesh.setMatrixAt(i, _mat4);
        continue;
      }
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.04) {
        p.pos.y = 0.04;
        p.vel.y *= -0.3;
      }
      const s = p.size * (1 - p.life / p.maxLife);
      _scale.set(s, s, s);
      _quat.identity();
      _mat4.compose(p.pos, _quat, _scale);
      this.particleMesh.setMatrixAt(i, _mat4);
      this.particleMesh.setColorAt(i, p.color);
    }
    if (anyUpdated) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) {
        this.particleMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private syncSceneToState(dt: number) {
    const elapsed = this.clock.elapsedTime;

    // 1. Update Ball transform + spin rotation + contact shadow
    this.ballMesh.position.set(this.ballSim.pos.x, this.ballSim.pos.y, this.ballSim.pos.z);
    if (this.ballSim.active) {
      this.ballMesh.rotation.x += this.ballSim.spin.x * dt * 0.8 + this.ballSim.vel.z * dt * 1.4;
      this.ballMesh.rotation.y += this.ballSim.spin.y * dt * 1.2;
      this.ballMesh.rotation.z += this.ballSim.spin.z * dt * 0.9;
    }

    this.ballShadow.position.set(this.ballSim.pos.x, 0.025, this.ballSim.pos.z);
    const heightScale = Math.max(0.42, 1 - this.ballSim.pos.y * 0.14);
    this.ballShadow.scale.setScalar(heightScale);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * heightScale;

    // 2. Update Goalkeeper 2D Billboard
    const sway = !this.keeperSim.diving && !this.ballSim.active ? Math.sin(elapsed * 2.8) * 0.16 : 0;
    this.keeperMesh.position.set(this.keeperSim.x + sway, this.keeperSim.y, this.keeperSim.z);
    this.keeperMesh.lookAt(this.camera.position.x, this.keeperMesh.position.y, this.camera.position.z);
    const kMat = this.keeperMesh.material as THREE.MeshBasicMaterial;
    const desiredKTex = this.keeperTextures[this.keeperSim.pose];
    if (kMat.map !== desiredKTex) {
      kMat.map = desiredKTex;
      kMat.needsUpdate = true;
    }

    this.keeperShadow.position.set(this.keeperSim.x + sway, 0.025, this.keeperSim.z);
    const kShadowScale = Math.max(0.55, 1 - this.keeperSim.y * 0.25);
    this.keeperShadow.scale.set(
      this.keeperSim.diveDir !== 0 ? 1.45 : kShadowScale,
      kShadowScale,
      1
    );

    // 3. Update Wall Defender 2D Billboards
    for (let i = 0; i < this.wallMeshes.length; i++) {
      const mesh = this.wallMeshes[i];
      const sMesh = this.wallShadows[i];
      if (i < this.wallSim.length) {
        const def = this.wallSim[i];
        mesh.visible = true;
        sMesh.visible = true;
        mesh.position.set(def.x, def.y, def.z);
        mesh.lookAt(this.camera.position.x, mesh.position.y, this.camera.position.z);
        const dMat = mesh.material as THREE.MeshBasicMaterial;
        const dTex = this.defenderTextures[def.pose];
        if (dMat.map !== dTex) {
          dMat.map = dTex;
          dMat.needsUpdate = true;
        }
        sMesh.position.set(def.x, 0.025, def.z);
        const ds = Math.max(0.5, 1 - def.y * 0.35);
        sMesh.scale.setScalar(ds);
      } else {
        mesh.visible = false;
        sMesh.visible = false;
      }
    }

    // 4. Aim Reticle & Curved Preview Arc (visible only while aiming in 'playing')
    const showAim = this.screenState === 'playing' && !this.ballSim.active && !this.shotResolved;
    this.aimReticleGroup.visible = showAim;
    this.previewDots.visible = showAim;

    if (showAim) {
      const targetX = this.shotParams.aimX * (GOAL_HALF_WIDTH - 0.14);
      const targetY = Math.max(0.18, this.shotParams.aimY * (GOAL_HEIGHT - 0.1));
      this.aimReticleGroup.position.set(targetX, targetY, GOAL_Z + 0.08);
      const pulse = 1 + Math.sin(elapsed * 5) * 0.06;
      this.aimReticleGroup.scale.setScalar(pulse);
      this.aimRingMat.color.set(SHOT_TYPES[this.shotParams.shotType].accentColor);

      const preview = sampleTrajectoryPreview(this.shotParams, this.spot, this.mode, 16);
      // Show initial 65% of arc so the player feels the bend without spoiling exact end pixel
      const count = Math.min(16, Math.max(4, Math.floor(preview.length * 0.72)));
      for (let i = 0; i < 16; i++) {
        if (i < count) {
          const p = preview[i];
          _vec3A.set(p.x, p.y, p.z);
          const s = 1 - (i / count) * 0.55;
          _scale.set(s, s, s);
          _quat.identity();
          _mat4.compose(_vec3A, _quat, _scale);
        } else {
          _mat4.makeScale(0, 0, 0);
        }
        this.previewDots.setMatrixAt(i, _mat4);
      }
      this.previewDots.instanceMatrix.needsUpdate = true;
    }

    // 5. Camera Choreography with exponential damping
    const dampAlpha = 1 - Math.exp(-5.5 * dt);

    if (this.screenState === 'title') {
      // Atmospheric live-world orbital stadium pan
      const angle = elapsed * 0.18;
      _vec3A.set(Math.sin(angle) * 14, 4.4 + Math.sin(elapsed * 0.35) * 0.6, GOAL_Z + 17 + Math.cos(angle) * 4);
      _vec3B.set(0, 1.3, GOAL_Z + 2);
      this.cameraPos.lerp(_vec3A, dampAlpha);
      this.cameraTarget.lerp(_vec3B, dampAlpha);
    } else if (this.ballSim.active) {
      // Dynamic chase / broadcast follow
      _vec3A.set(
        this.ballSim.pos.x * 0.45 + this.spot.x * 0.25,
        Math.max(2.1, this.ballSim.pos.y * 0.65 + 2.2),
        Math.max(GOAL_Z + 9.5, this.ballSim.pos.z + 7.5)
      );
      _vec3B.set(
        this.ballSim.pos.x * 0.6,
        Math.max(1.0, this.ballSim.pos.y * 0.55 + 0.65),
        Math.min(GOAL_Z + 1.5, this.ballSim.pos.z - 4.0)
      );
      this.cameraPos.lerp(_vec3A, 1 - Math.exp(-6.5 * dt));
      this.cameraTarget.lerp(_vec3B, 1 - Math.exp(-8.5 * dt));
    } else {
      // Behind-the-kicker aiming angle aligned along ball -> goal vector
      const dx = 0 - this.spot.x;
      const dz = GOAL_Z - this.spot.z;
      const len = Math.hypot(dx, dz);
      const ux = dx / len;
      const uz = dz / len;
      const backDist = this.mode === 'penalty' ? 6.2 : 6.8;
      _vec3A.set(this.spot.x - ux * backDist, 2.35, this.spot.z - uz * backDist);
      _vec3B.set(this.spot.x * 0.25, 1.25, GOAL_Z + 1.0);
      this.cameraPos.lerp(_vec3A, dampAlpha);
      this.cameraTarget.lerp(_vec3B, dampAlpha);
    }

    this.camera.position.copy(this.cameraPos);

    // Trauma camera shake
    if (this.cameraTrauma > 0) {
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 2.4);
      const shake = this.cameraTrauma * this.cameraTrauma * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }

    this.camera.lookAt(this.cameraTarget);

    // Subtle FOV punch on high-speed shots
    const targetFov = this.ballSim.active && this.ballSim.shotType === 'knuckle' ? 49 : 44;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  private tick = () => {
    if (this.disposed) return;

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    if (this.screenState === 'playing') {
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      } else if (this.ballSim.active) {
        const events = stepBallAndActors(
          this.ballSim,
          this.keeperSim,
          this.wallSim,
          this.keeperDecision,
          dt
        );

        if (events.postHit) {
          audioEngine.playPostClang();
          this.hitstopTimer = 0.045;
          this.cameraTrauma = 0.85;
          _vec3A.set(this.ballSim.pos.x, this.ballSim.pos.y, this.ballSim.pos.z);
          this.spawnBurst(_vec3A, 14, [0xffffff, 0xf59e0b], 5.0);
        }

        if (events.wallHit) {
          audioEngine.playKeeperSave();
          this.hitstopTimer = 0.04;
          this.cameraTrauma = 0.65;
          _vec3A.set(this.ballSim.pos.x, this.ballSim.pos.y, this.ballSim.pos.z);
          this.spawnBurst(_vec3A, 12, [0x38bdf8, 0xffffff], 4.0);
        }

        if (events.keeperSave) {
          audioEngine.playKeeperSave();
          audioEngine.playCrowdOoh();
          this.hitstopTimer = 0.05;
          this.cameraTrauma = 0.6;
          _vec3A.set(this.ballSim.pos.x, this.ballSim.pos.y, this.ballSim.pos.z);
          this.spawnBurst(_vec3A, 16, [0xf59e0b, 0xffffff], 4.8);
        }

        if (events.goalScored) {
          audioEngine.playGoalRoar();
          this.hitstopTimer = 0.055;
          this.cameraTrauma = 0.55;
          this.netRippleTime = 1.2;
          this.netRippleOrigin.set(this.ballSim.pos.x, this.ballSim.pos.y);
          _vec3A.set(this.ballSim.pos.x, this.ballSim.pos.y, GOAL_Z - 0.5);
          this.spawnBurst(_vec3A, 28, [0x10b981, 0xf59e0b, 0xffffff, 0x38bdf8], 6.5);
        }

        if (events.missed && this.ballSim.outcome !== 'wall') {
          audioEngine.playCrowdOoh();
        }

        if (this.ballSim.outcome && !this.shotResolved) {
          this.postShotTimer += dt;
          if (this.postShotTimer >= 1.35) {
            this.shotResolved = true;
            this.ballSim.active = false;
            this.callbacks.onShotComplete(
              this.ballSim.outcome,
              this.ballSim.hitPost,
              this.ballSim.peakSpeedKmh
            );
          }
        }
      }

      this.updateNetRipple(dt);
      this.updateParticles(dt);

      // Push radar telemetry without React state churn
      const preview =
        !this.ballSim.active && !this.shotResolved
          ? sampleTrajectoryPreview(this.shotParams, this.spot, this.mode, 14)
          : [];
      this.callbacks.onLiveTelemetry({
        ball: this.ballSim.pos,
        trail: this.ballSim.trail,
        keeper: { x: this.keeperSim.x, z: this.keeperSim.z, pose: this.keeperSim.pose },
        wall: this.wallSim.map((w) => ({ x: w.x, z: w.z, y: w.y })),
        spot: this.spot,
        preview,
      });
    }

    this.syncSceneToState(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);

    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
