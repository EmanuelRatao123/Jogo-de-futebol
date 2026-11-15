export type GameScreenState = 'title' | 'playing' | 'paused' | 'gameover';

export type GameMode = 'penalty' | 'freekick';

export type ShotType = 'placed' | 'trivela' | 'knuckle' | 'chip';

export type ShotOutcome = 'goal' | 'saved' | 'post' | 'missed' | 'wall';

export type KeeperPose = 'ready' | 'jump' | 'dive_left' | 'dive_right';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface KickSpot {
  id: string;
  label: string;
  distanceMeters: number;
  x: number;
  z: number;
  wallCount: number;
}

export interface ShotParams {
  aimX: number; // -1.25 (wide left) to +1.25 (wide right), goalposts at +-1.0
  aimY: number; // 0 (ground) to 1.25 (above crossbar), crossbar at 1.0
  power: number; // 0.1 to 1.0
  curve: number; // -1.0 (left curl) to +1.0 (right curl)
  elevationBias: number; // -1.0 (topspin/down) to +1.0 (loft/underneath)
  shotType: ShotType;
}

export interface BallSimState {
  active: boolean;
  pos: Vec3;
  vel: Vec3;
  spin: Vec3; // rad/s around x, y, z
  radius: number;
  elapsed: number;
  shotType: ShotType;
  knuckleSeed: number;
  hitPost: boolean;
  hitWall: boolean;
  hitKeeper: boolean;
  trail: Vec3[];
  peakSpeedKmh: number;
  outcome: ShotOutcome | null;
}

export interface KeeperSimState {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  pose: KeeperPose;
  diveDir: -1 | 0 | 1;
  reactionTimer: number;
  diving: boolean;
  diveProgress: number;
}

export interface WallDefender {
  x: number;
  z: number;
  y: number;
  jumpDelay: number;
  pose: 'guard' | 'jump' | 'celebrate';
}

export interface ShotResultSummary {
  outcome: ShotOutcome;
  label: string;
  sublabel: string;
  points: number;
  speedKmh: number;
  topCorner: boolean;
  curvedGoal: boolean;
}

export interface MatchStats {
  mode: GameMode;
  round: number;
  totalRounds: number;
  goals: number;
  saves: number;
  misses: number;
  score: number;
  bestScore: number;
  streak: number;
  bestStreak: number;
  history: ShotOutcome[];
  lastSpeedKmh: number;
}

export interface ShotTypeInfo {
  id: ShotType;
  key: string;
  name: string;
  role: string;
  speedMult: number;
  curveMult: number;
  dipMult: number;
  loftBias: number;
  accentColor: string;
}

export const GOAL_HALF_WIDTH = 3.66; // Official 7.32m goal
export const GOAL_HEIGHT = 2.44; // Official 2.44m crossbar
export const GOAL_DEPTH = 2.15;
export const GOAL_Z = -52.5; // Goal line at -52.5m (pitch center at 0)
export const POST_RADIUS = 0.06;
export const BALL_RADIUS = 0.11;
export const PENALTY_SPOT_Z = GOAL_Z + 11.0; // -41.5m
export const WALL_DISTANCE = 9.15;

export const SHOT_TYPES: Record<ShotType, ShotTypeInfo> = {
  placed: {
    id: 'placed',
    key: '1',
    name: 'Chapada',
    role: 'Curva precisa',
    speedMult: 0.92,
    curveMult: 1.25,
    dipMult: 0.35,
    loftBias: 0.02,
    accentColor: '#10b981',
  },
  trivela: {
    id: 'trivela',
    key: '2',
    name: 'Trivela',
    role: 'Efeito externo',
    speedMult: 1.0,
    curveMult: 1.55,
    dipMult: 0.45,
    loftBias: 0.05,
    accentColor: '#f59e0b',
  },
  knuckle: {
    id: 'knuckle',
    key: '3',
    name: 'Bomba',
    role: 'Folha seca',
    speedMult: 1.18,
    curveMult: 0.35,
    dipMult: 1.35,
    loftBias: 0.12,
    accentColor: '#ef4444',
  },
  chip: {
    id: 'chip',
    key: '4',
    name: 'Cavadinha',
    role: 'Por cobertura',
    speedMult: 0.6,
    curveMult: 0.4,
    dipMult: 0.15,
    loftBias: 0.48,
    accentColor: '#38bdf8',
  },
};
