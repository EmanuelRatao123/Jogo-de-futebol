import {
  GOAL_Z,
  GameMode,
  KickSpot,
  MatchStats,
  PENALTY_SPOT_Z,
  ShotOutcome,
  ShotParams,
  ShotResultSummary,
} from './types';

export const PENALTY_SPOT: KickSpot = {
  id: 'penalty',
  label: 'Marca do Pênalti · 11m',
  distanceMeters: 11,
  x: 0,
  z: PENALTY_SPOT_Z,
  wallCount: 0,
};

export const FREEKICK_SPOTS: KickSpot[] = [
  {
    id: 'fk_front_18',
    label: 'Meia-Lua · 19m',
    distanceMeters: 19,
    x: 0.4,
    z: GOAL_Z + 19.0,
    wallCount: 4,
  },
  {
    id: 'fk_left_22',
    label: 'Ponta Esquerda · 22m',
    distanceMeters: 22,
    x: -6.2,
    z: GOAL_Z + 21.1,
    wallCount: 4,
  },
  {
    id: 'fk_right_24',
    label: 'Ponta Direita · 24m',
    distanceMeters: 24,
    x: 6.8,
    z: GOAL_Z + 23.0,
    wallCount: 4,
  },
  {
    id: 'fk_center_26',
    label: 'Central · 26m',
    distanceMeters: 26,
    x: -1.8,
    z: GOAL_Z + 25.9,
    wallCount: 5,
  },
  {
    id: 'fk_long_29',
    label: 'Longa Distância · 29m',
    distanceMeters: 29,
    x: 4.5,
    z: GOAL_Z + 28.6,
    wallCount: 5,
  },
];

export function getSpotForRound(mode: GameMode, roundIndex: number): KickSpot {
  if (mode === 'penalty') {
    return PENALTY_SPOT;
  }
  return FREEKICK_SPOTS[roundIndex % FREEKICK_SPOTS.length];
}

export function createInitialMatchStats(mode: GameMode, bestScore = 0): MatchStats {
  return {
    mode,
    round: 1,
    totalRounds: 5,
    goals: 0,
    saves: 0,
    misses: 0,
    score: 0,
    bestScore,
    streak: 0,
    bestStreak: 0,
    history: [],
    lastSpeedKmh: 0,
  };
}

export function evaluateShotResult(
  outcome: ShotOutcome,
  params: ShotParams,
  spot: KickSpot,
  hitPost: boolean,
  speedKmh: number,
  currentStreak: number
): ShotResultSummary {
  const topCorner = Math.abs(params.aimX) >= 0.68 && params.aimY >= 0.68;
  const curvedGoal = Math.abs(params.curve) >= 0.45;
  const roundedSpeed = Math.round(speedKmh);

  if (outcome === 'goal') {
    let points = spot.distanceMeters > 15 ? 180 : 120;
    if (topCorner) points += 80;
    if (curvedGoal) points += 50;
    if (hitPost) points += 40;
    if (params.shotType === 'chip') points += 45;
    points += currentStreak * 30;

    let label = 'GOLAÇO!';
    if (topCorner && curvedGoal) label = 'NO ÂNGULO COM CURVA!';
    else if (topCorner) label = 'NA GAVETA!';
    else if (hitPost) label = 'NA TRAVE E DENTRO!';
    else if (params.shotType === 'chip') label = 'CAVADINHA DE CLASSE!';
    else if (params.shotType === 'trivela') label = 'TRIVELA PERFEITA!';

    return {
      outcome,
      label,
      sublabel: `+${points} pts · ${roundedSpeed} km/h`,
      points,
      speedKmh: roundedSpeed,
      topCorner,
      curvedGoal,
    };
  }

  if (outcome === 'saved') {
    return {
      outcome,
      label: 'DEFENDEU O GOLEIRO!',
      sublabel: `${roundedSpeed} km/h · Tente mudar o efeito`,
      points: 0,
      speedKmh: roundedSpeed,
      topCorner: false,
      curvedGoal: false,
    };
  }

  if (outcome === 'wall') {
    return {
      outcome,
      label: 'NA BARREIRA!',
      sublabel: 'Use curva ou elevação para superar o salto',
      points: 0,
      speedKmh: roundedSpeed,
      topCorner: false,
      curvedGoal: false,
    };
  }

  if (outcome === 'post') {
    return {
      outcome,
      label: 'NA TRAVE!',
      sublabel: `${roundedSpeed} km/h · Por centímetros!`,
      points: 15,
      speedKmh: roundedSpeed,
      topCorner: false,
      curvedGoal: false,
    };
  }

  return {
    outcome,
    label: 'PRA FORA!',
    sublabel: `${roundedSpeed} km/h · Ajuste a mira ou a força`,
    points: 0,
    speedKmh: roundedSpeed,
    topCorner: false,
    curvedGoal: false,
  };
}

export function applyShotToStats(stats: MatchStats, summary: ShotResultSummary): {
  nextStats: MatchStats;
  seriesComplete: boolean;
} {
  const isGoal = summary.outcome === 'goal';
  const nextStreak = isGoal ? stats.streak + 1 : 0;
  const nextScore = stats.score + summary.points;
  const nextBestScore = Math.max(stats.bestScore, nextScore);
  const nextHistory = [...stats.history, summary.outcome];
  const seriesComplete = nextHistory.length >= stats.totalRounds;

  return {
    nextStats: {
      ...stats,
      round: seriesComplete ? stats.totalRounds : stats.round + 1,
      goals: stats.goals + (isGoal ? 1 : 0),
      saves: stats.saves + (summary.outcome === 'saved' || summary.outcome === 'wall' ? 1 : 0),
      misses: stats.misses + (summary.outcome === 'missed' || summary.outcome === 'post' ? 1 : 0),
      score: nextScore,
      bestScore: nextBestScore,
      streak: nextStreak,
      bestStreak: Math.max(stats.bestStreak, nextStreak),
      history: nextHistory,
      lastSpeedKmh: summary.speedKmh,
    },
    seriesComplete,
  };
}
