import {
  BALL_RADIUS,
  BallSimState,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GOAL_Z,
  GameMode,
  KeeperPose,
  KeeperSimState,
  KickSpot,
  POST_RADIUS,
  SHOT_TYPES,
  ShotParams,
  Vec3,
  WallDefender,
} from './types';

const GRAVITY = 9.81;
const AIR_DRAG = 0.24;
const MAGNUS_COEFF = 0.021;

export function createInitialBallState(spot: KickSpot): BallSimState {
  return {
    active: false,
    pos: { x: spot.x, y: BALL_RADIUS, z: spot.z },
    vel: { x: 0, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
    radius: BALL_RADIUS,
    elapsed: 0,
    shotType: 'placed',
    knuckleSeed: 0,
    hitPost: false,
    hitWall: false,
    hitKeeper: false,
    trail: [{ x: spot.x, y: BALL_RADIUS, z: spot.z }],
    peakSpeedKmh: 0,
    outcome: null,
  };
}

export function createInitialKeeperState(spot: KickSpot, mode: GameMode): KeeperSimState {
  // For free kicks, keeper shades toward the far post opposite the ball's side
  const shadeX = mode === 'penalty' ? 0 : Math.max(-1.35, Math.min(1.35, -spot.x * 0.16));
  return {
    x: shadeX,
    y: 0,
    z: GOAL_Z + 0.35,
    targetX: shadeX,
    targetY: 0,
    pose: 'ready',
    diveDir: 0,
    reactionTimer: 0,
    diving: false,
    diveProgress: 0,
  };
}

export function buildWallForSpot(spot: KickSpot, mode: GameMode): WallDefender[] {
  if (mode === 'penalty' || spot.wallCount <= 0) {
    return [];
  }
  const dx = 0 - spot.x;
  const dz = GOAL_Z - spot.z;
  const dist = Math.hypot(dx, dz);
  const ux = dx / dist;
  const uz = dz / dist;

  // Perpendicular lateral vector
  const px = -uz;
  const pz = ux;

  // Wall stands 9.15m in front of ball along line to goal, offset slightly to cover near post
  const wallDist = Math.min(9.15, dist * 0.52);
  const lateralBias = spot.x >= 0 ? -0.45 : 0.45;
  const centerX = spot.x + ux * wallDist + px * lateralBias;
  const centerZ = spot.z + uz * wallDist + pz * lateralBias;

  const defenders: WallDefender[] = [];
  const spacing = 0.62;
  const half = (spot.wallCount - 1) / 2;

  for (let i = 0; i < spot.wallCount; i++) {
    const offset = (i - half) * spacing;
    defenders.push({
      x: centerX + px * offset,
      z: centerZ + pz * offset,
      y: 0,
      jumpDelay: 0.04 + Math.abs(i - half) * 0.03,
      pose: 'guard',
    });
  }
  return defenders;
}

export function computeShotLaunch(
  params: ShotParams,
  spot: KickSpot,
  mode: GameMode
): { vel: Vec3; spin: Vec3 } {
  const info = SHOT_TYPES[params.shotType];
  const clampedPower = Math.max(0.12, Math.min(1.0, params.power));

  // Target point on the goal plane
  const targetX = params.aimX * (GOAL_HALF_WIDTH - 0.14);
  const targetY = Math.max(BALL_RADIUS, params.aimY * (GOAL_HEIGHT - 0.1));

  const dx = targetX - spot.x;
  const dz = GOAL_Z - spot.z;
  const horizDist = Math.hypot(dx, dz);

  // Base speed scaled by distance and shot type (21 m/s to 37 m/s)
  const distBoost = mode === 'penalty' ? 0 : (spot.distanceMeters - 11) * 0.34;
  const baseSpeed = (20.5 + clampedPower * 13.5 + distBoost) * info.speedMult;

  const flightTime = horizDist / Math.max(10, baseSpeed * 0.94);

  // Effective curve: Trivela bends sharply with outside-foot bias if curve near 0, or amplifies user curve
  let effectiveCurve = params.curve * info.curveMult;
  if (params.shotType === 'trivela' && Math.abs(params.curve) < 0.15) {
    effectiveCurve = 0.85 * info.curveMult;
  }

  // Compensate initial horizontal aim slightly? No—keep aim direct toward crosshair so curve visibly bends away/into corners!
  // Actually, give a small 28% lead compensation on free kicks so curling around a wall feels natural, while strong curve still bends dramatically.
  const spinY = -effectiveCurve * (16.0 + clampedPower * 14.0); // rad/s around Y (positive spinY bends -X? Let's verify cross(omega, v))
  // With v = (0, 0, -vz): omega = (0, spinY, 0) -> omega x v = (spinY*(-vz) - 0, 0, 0) = (-spinY * vz, 0, 0).
  // So negative spinY gives +X acceleration (curves right), positive spinY gives -X acceleration (curves left).
  // Therefore spinY = -effectiveCurve * ... means +curve curves RIGHT (+X), -curve curves LEFT (-X)!

  // Topspin / Backspin (spinX):
  // v = (0, 0, -vz), omega = (spinX, 0, 0) -> omega x v = (0, -spinX * (-vz) ... wait:
  // (omega_x, 0, 0) x (0, 0, -vz) = (0, -omega_x * (-vz), 0) = (0, omega_x * vz, 0)!
  // Let's check: y component of a x b = a_z*b_x - a_x*b_z = 0 - spinX * (-vz) = +spinX * vz!
  // Wait: so negative spinX pulls DOWN (topspin dip!), positive spinX lifts UP (backspin)!
  const topspin = -(info.dipMult * (6 + clampedPower * 10) - params.elevationBias * 9.0);

  // Compute initial vy so ball arrives near targetY accounting for gravity and average vertical Magnus + loft bias
  const avgMagnusY = MAGNUS_COEFF * topspin * baseSpeed;
  const effectiveG = GRAVITY - avgMagnusY;
  const dy = targetY - BALL_RADIUS;

  // Over-power risk above 0.94 on non-placed shots slightly raises launch
  const overpowerLift = clampedPower > 0.94 && params.shotType !== 'placed' ? (clampedPower - 0.94) * 3.8 : 0;

  let vy = (dy + 0.5 * Math.max(2.5, effectiveG) * flightTime * flightTime) / Math.max(0.25, flightTime);
  vy += info.loftBias * (mode === 'penalty' ? 3.2 : 5.2) + params.elevationBias * 1.4 + overpowerLift;

  const horizSpeed = horizDist / Math.max(0.22, flightTime);
  const vx = (dx / horizDist) * horizSpeed;
  const vz = (dz / horizDist) * horizSpeed;

  return {
    vel: { x: vx, y: vy, z: vz },
    spin: {
      x: topspin,
      y: spinY,
      z: effectiveCurve * 6.0,
    },
  };
}

export function chooseKeeperDecision(
  params: ShotParams,
  spot: KickSpot,
  mode: GameMode,
  round: number,
  rngVal: number // 0..1 deterministic or Math.random()
): {
  diveDir: -1 | 0 | 1;
  targetX: number;
  targetY: number;
  reactionDelay: number;
} {
  const skill = Math.min(0.88, 0.45 + round * 0.06);
  const targetGoalX = params.aimX * GOAL_HALF_WIDTH;

  // Estimate curved arrival X roughly so keeper has a realistic chance without reading mind 100%
  const readAccuracy = rngVal;
  let guessX = targetGoalX;
  if (readAccuracy > skill) {
    // Keeper guesses wrong side or center
    guessX = targetGoalX > 0 ? -2.2 : 2.2;
  } else {
    // Keeper reads aim side, slightly off
    guessX = targetGoalX * (0.78 + rngVal * 0.35);
  }

  // Chip shot punishes early diving keeper
  const targetY =
    params.shotType === 'chip'
      ? 0.2
      : Math.max(0.2, Math.min(GOAL_HEIGHT - 0.35, params.aimY * GOAL_HEIGHT * 0.85));

  const clampedX = Math.max(-GOAL_HALF_WIDTH + 0.45, Math.min(GOAL_HALF_WIDTH - 0.45, guessX));
  const diveDir: -1 | 0 | 1 = clampedX < -0.55 ? -1 : clampedX > 0.55 ? 1 : 0;

  const reactionDelay = mode === 'penalty' ? 0.06 : 0.14;
  return {
    diveDir,
    targetX: clampedX,
    targetY,
    reactionDelay,
  };
}

function collideCylinderPost(
  ball: BallSimState,
  cx: number,
  cz: number,
  minY: number,
  maxY: number
): boolean {
  if (ball.pos.y < minY || ball.pos.y > maxY + POST_RADIUS) return false;
  const dx = ball.pos.x - cx;
  const dz = ball.pos.z - cz;
  const dist = Math.hypot(dx, dz);
  const minDist = ball.radius + POST_RADIUS;
  if (dist < minDist && dist > 0.0001) {
    const nx = dx / dist;
    const nz = dz / dist;
    ball.pos.x = cx + nx * minDist;
    ball.pos.z = cz + nz * minDist;
    const vn = ball.vel.x * nx + ball.vel.z * nz;
    if (vn < 0) {
      ball.vel.x -= 1.72 * vn * nx;
      ball.vel.z -= 1.72 * vn * nz;
      ball.vel.y *= 0.85;
    }
    return true;
  }
  return false;
}

function collideCrossbar(ball: BallSimState): boolean {
  if (Math.abs(ball.pos.x) > GOAL_HALF_WIDTH + POST_RADIUS) return false;
  const dy = ball.pos.y - GOAL_HEIGHT;
  const dz = ball.pos.z - GOAL_Z;
  const dist = Math.hypot(dy, dz);
  const minDist = ball.radius + POST_RADIUS;
  if (dist < minDist && dist > 0.0001) {
    const ny = dy / dist;
    const nz = dz / dist;
    ball.pos.y = GOAL_HEIGHT + ny * minDist;
    ball.pos.z = GOAL_Z + nz * minDist;
    const vn = ball.vel.y * ny + ball.vel.z * nz;
    if (vn < 0) {
      ball.vel.y -= 1.72 * vn * ny;
      ball.vel.z -= 1.72 * vn * nz;
      ball.vel.x *= 0.88;
    }
    return true;
  }
  return false;
}

export interface PhysicsEvents {
  postHit: boolean;
  wallHit: boolean;
  keeperSave: boolean;
  goalScored: boolean;
  missed: boolean;
  groundBounce: boolean;
}

export function stepBallAndActors(
  ball: BallSimState,
  keeper: KeeperSimState,
  wall: WallDefender[],
  keeperDecision: { diveDir: -1 | 0 | 1; targetX: number; targetY: number; reactionDelay: number },
  dt: number
): PhysicsEvents {
  const events: PhysicsEvents = {
    postHit: false,
    wallHit: false,
    keeperSave: false,
    goalScored: false,
    missed: false,
    groundBounce: false,
  };

  if (!ball.active) return events;

  ball.elapsed += dt;

  // Animate wall jump on free kicks
  for (let i = 0; i < wall.length; i++) {
    const def = wall[i];
    const t = ball.elapsed - def.jumpDelay;
    if (t > 0 && t < 0.65) {
      const phase = t / 0.65;
      def.y = Math.sin(phase * Math.PI) * 0.68;
      def.pose = 'jump';
    } else if (ball.outcome === 'wall' || ball.outcome === 'saved' || ball.outcome === 'missed') {
      def.y = 0;
      def.pose = 'celebrate';
    } else {
      def.y = 0;
      def.pose = 'guard';
    }
  }

  // Animate keeper dive
  if (ball.elapsed >= keeperDecision.reactionDelay && !keeper.diving) {
    keeper.diving = true;
    keeper.diveDir = keeperDecision.diveDir;
    keeper.targetX = keeperDecision.targetX;
    keeper.targetY = keeperDecision.targetY;
  }

  if (keeper.diving && !ball.outcome) {
    keeper.diveProgress = Math.min(1, keeper.diveProgress + dt * 2.9);
    const ease = 1 - Math.pow(1 - keeper.diveProgress, 2.2);
    keeper.x += (keeper.targetX - keeper.x) * Math.min(1, dt * 8.5);
    keeper.y = Math.sin(ease * Math.PI * 0.85) * Math.max(0.25, keeper.targetY * 0.65);

    const pose: KeeperPose =
      keeper.diveDir === -1
        ? 'dive_left'
        : keeper.diveDir === 1
          ? 'dive_right'
          : keeper.targetY > 1.35
            ? 'jump'
            : 'ready';
    keeper.pose = pose;
  }

  // Sub-step integration for reliable goalpost & wall collision
  const subSteps = 3;
  const subDt = dt / subSteps;

  for (let s = 0; s < subSteps; s++) {
    const prevZ = ball.pos.z;

    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
    const speedKmh = speed * 3.6;
    if (speedKmh > ball.peakSpeedKmh) {
      ball.peakSpeedKmh = speedKmh;
    }

    // Magnus force: F_m = MAGNUS_COEFF * (spin x vel)
    const mx = MAGNUS_COEFF * (ball.spin.y * ball.vel.z - ball.spin.z * ball.vel.y);
    const my = MAGNUS_COEFF * (ball.spin.z * ball.vel.x - ball.spin.x * ball.vel.z);
    const mz = MAGNUS_COEFF * (ball.spin.x * ball.vel.y - ball.spin.y * ball.vel.x);

    // Knuckleball lateral/vertical flutter at high speed
    let kx = 0;
    let ky = 0;
    if (ball.shotType === 'knuckle' && speed > 14) {
      const f = ball.elapsed * 16 + ball.knuckleSeed;
      kx = Math.sin(f) * 3.4;
      ky = Math.cos(f * 1.35) * 2.2;
    }

    const ax = mx + kx - AIR_DRAG * ball.vel.x * (1 + speed * 0.012);
    const ay = my + ky - GRAVITY - AIR_DRAG * ball.vel.y * (1 + speed * 0.012);
    const az = mz - AIR_DRAG * ball.vel.z * (1 + speed * 0.012);

    ball.vel.x += ax * subDt;
    ball.vel.y += ay * subDt;
    ball.vel.z += az * subDt;

    ball.pos.x += ball.vel.x * subDt;
    ball.pos.y += ball.vel.y * subDt;
    ball.pos.z += ball.vel.z * subDt;

    // Spin decay
    const spinDecay = Math.exp(-0.22 * subDt);
    ball.spin.x *= spinDecay;
    ball.spin.y *= spinDecay;
    ball.spin.z *= spinDecay;

    // Ground bounce
    if (ball.pos.y < ball.radius) {
      ball.pos.y = ball.radius;
      if (ball.vel.y < -1.2) {
        events.groundBounce = true;
      }
      ball.vel.y = Math.abs(ball.vel.y) * 0.56;
      ball.vel.x *= 0.88;
      ball.vel.z *= 0.88;
    }

    // Defensive Wall collision (only if ball hasn't crossed goal line yet)
    if (!ball.hitWall && ball.pos.z > GOAL_Z + 1.0) {
      for (let i = 0; i < wall.length; i++) {
        const def = wall[i];
        const minY = def.y;
        const maxY = def.y + 1.88;
        const halfW = 0.3;
        if (
          ball.pos.y + ball.radius >= minY &&
          ball.pos.y - ball.radius <= maxY &&
          Math.abs(ball.pos.x - def.x) <= halfW + ball.radius &&
          Math.abs(ball.pos.z - def.z) <= 0.24 + ball.radius
        ) {
          ball.hitWall = true;
          events.wallHit = true;
          ball.vel.z = Math.abs(ball.vel.z) * 0.45 + 2.5;
          ball.vel.x += (ball.pos.x - def.x) * 4.5;
          ball.vel.y = Math.max(1.8, ball.vel.y * 0.5);
          if (!ball.outcome) {
            ball.outcome = 'wall';
          }
          break;
        }
      }
    }

    // Goalposts & Crossbar collision
    const hitLeftPost = collideCylinderPost(ball, -GOAL_HALF_WIDTH, GOAL_Z, 0, GOAL_HEIGHT);
    const hitRightPost = collideCylinderPost(ball, GOAL_HALF_WIDTH, GOAL_Z, 0, GOAL_HEIGHT);
    const hitBar = collideCrossbar(ball);
    if (hitLeftPost || hitRightPost || hitBar) {
      ball.hitPost = true;
      events.postHit = true;
    }

    // Goalkeeper collision near goal line
    if (!ball.hitKeeper && !ball.outcome && Math.abs(ball.pos.z - keeper.z) < 0.48) {
      const reachX = keeper.diveDir === 0 ? 0.58 : 1.15;
      const reachYMin = Math.max(0, keeper.y - 0.15);
      const reachYMax = keeper.y + (keeper.pose === 'jump' ? 2.32 : keeper.diveDir !== 0 ? 1.55 : 1.92);

      if (
        Math.abs(ball.pos.x - keeper.x) <= reachX &&
        ball.pos.y >= reachYMin &&
        ball.pos.y <= reachYMax
      ) {
        ball.hitKeeper = true;
        events.keeperSave = true;
        ball.outcome = 'saved';
        // Deflect ball outward
        ball.vel.z = Math.abs(ball.vel.z) * 0.42 + 3.2;
        ball.vel.x = (ball.pos.x - keeper.x) * 5.2 + (keeper.diveDir || 0.3) * 3.0;
        ball.vel.y = Math.max(2.2, ball.vel.y * 0.4 + 2.5);
      }
    }

    // Goal net containment & goal-line crossing detection
    const crossedGoalLine = prevZ > GOAL_Z - BALL_RADIUS && ball.pos.z <= GOAL_Z - BALL_RADIUS;
    const insideGoalFrame =
      Math.abs(ball.pos.x) < GOAL_HALF_WIDTH - BALL_RADIUS * 0.3 &&
      ball.pos.y < GOAL_HEIGHT - BALL_RADIUS * 0.25 &&
      ball.pos.y >= 0;

    if (!ball.outcome && crossedGoalLine && insideGoalFrame) {
      ball.outcome = 'goal';
      events.goalScored = true;
    }

    // Inside net damping
    if (ball.outcome === 'goal' && ball.pos.z < GOAL_Z) {
      if (ball.pos.z < GOAL_Z - GOAL_DEPTH + ball.radius) {
        ball.pos.z = GOAL_Z - GOAL_DEPTH + ball.radius;
        ball.vel.z *= -0.18;
        ball.vel.x *= 0.4;
        ball.vel.y *= 0.4;
      }
      if (ball.pos.x < -GOAL_HALF_WIDTH + ball.radius) {
        ball.pos.x = -GOAL_HALF_WIDTH + ball.radius;
        ball.vel.x *= -0.25;
      }
      if (ball.pos.x > GOAL_HALF_WIDTH - ball.radius) {
        ball.pos.x = GOAL_HALF_WIDTH - ball.radius;
        ball.vel.x *= -0.25;
      }
      if (ball.pos.y > GOAL_HEIGHT - ball.radius) {
        ball.pos.y = GOAL_HEIGHT - ball.radius;
        ball.vel.y *= -0.25;
      }
    }

    // Missed wide / over crossbar
    if (!ball.outcome && ball.pos.z < GOAL_Z - 0.65 && !insideGoalFrame) {
      ball.outcome = ball.hitPost ? 'post' : 'missed';
      events.missed = true;
    }

    // Out of bounds / stalled
    if (!ball.outcome && (ball.elapsed > 3.8 || (ball.elapsed > 0.7 && speed < 0.75))) {
      ball.outcome = ball.hitWall ? 'wall' : ball.hitPost ? 'post' : 'missed';
      events.missed = true;
    }
  }

  // Record trail every ~12cm or so
  const lastTrail = ball.trail[ball.trail.length - 1];
  if (
    !lastTrail ||
    Math.hypot(ball.pos.x - lastTrail.x, ball.pos.y - lastTrail.y, ball.pos.z - lastTrail.z) > 0.25
  ) {
    if (ball.trail.length < 90) {
      ball.trail.push({ x: ball.pos.x, y: ball.pos.y, z: ball.pos.z });
    }
  }

  return events;
}

export function sampleTrajectoryPreview(
  params: ShotParams,
  spot: KickSpot,
  mode: GameMode,
  steps = 22
): Vec3[] {
  const { vel, spin } = computeShotLaunch(params, spot, mode);
  const pos = { x: spot.x, y: BALL_RADIUS, z: spot.z };
  const v = { ...vel };
  const s = { ...spin };
  const pts: Vec3[] = [{ ...pos }];

  const dt = 0.036;
  for (let i = 0; i < steps; i++) {
    const speed = Math.hypot(v.x, v.y, v.z);
    const mx = MAGNUS_COEFF * (s.y * v.z - s.z * v.y);
    const my = MAGNUS_COEFF * (s.z * v.x - s.x * v.z);
    const mz = MAGNUS_COEFF * (s.x * v.y - s.y * v.x);

    v.x += (mx - AIR_DRAG * v.x * (1 + speed * 0.012)) * dt;
    v.y += (my - GRAVITY - AIR_DRAG * v.y * (1 + speed * 0.012)) * dt;
    v.z += (mz - AIR_DRAG * v.z * (1 + speed * 0.012)) * dt;

    pos.x += v.x * dt;
    pos.y = Math.max(BALL_RADIUS, pos.y + v.y * dt);
    pos.z += v.z * dt;

    pts.push({ x: pos.x, y: pos.y, z: pos.z });
    if (pos.z <= GOAL_Z + 0.5) break;
  }

  return pts;
}
