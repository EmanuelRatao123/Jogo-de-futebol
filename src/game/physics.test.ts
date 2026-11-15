import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWallForSpot,
  computeShotLaunch,
  createInitialBallState,
  createInitialKeeperState,
  sampleTrajectoryPreview,
  stepBallAndActors,
} from './physics';
import {
  PENALTY_SPOT,
  applyShotToStats,
  createInitialMatchStats,
  evaluateShotResult,
  getSpotForRound,
} from './rules';
import { detectSpriteColumns, extractSpriteComponents } from './spritesheetProcessor';
import { GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_Z, ShotParams } from './types';

test('curve control bends ball horizontally in the expected direction', () => {
  const baseParams: ShotParams = {
    aimX: 0,
    aimY: 0.45,
    power: 0.8,
    curve: 0,
    elevationBias: 0,
    shotType: 'placed',
  };

  const rightCurvePts = sampleTrajectoryPreview(
    { ...baseParams, curve: 0.9 },
    PENALTY_SPOT,
    'penalty'
  );
  const leftCurvePts = sampleTrajectoryPreview(
    { ...baseParams, curve: -0.9 },
    PENALTY_SPOT,
    'penalty'
  );

  const lastRight = rightCurvePts[rightCurvePts.length - 1];
  const lastLeft = leftCurvePts[leftCurvePts.length - 1];

  assert.ok(lastRight.x > 0.3, `Expected +curve to bend right (+X), got ${lastRight.x}`);
  assert.ok(lastLeft.x < -0.3, `Expected -curve to bend left (-X), got ${lastLeft.x}`);
});

test('shot types produce distinct launch velocities and loft profiles', () => {
  const params: ShotParams = {
    aimX: 0.3,
    aimY: 0.5,
    power: 0.85,
    curve: 0.4,
    elevationBias: 0,
    shotType: 'knuckle',
  };

  const bomba = computeShotLaunch(params, PENALTY_SPOT, 'penalty');
  const cavadinha = computeShotLaunch({ ...params, shotType: 'chip' }, PENALTY_SPOT, 'penalty');

  const bombaSpeed = Math.hypot(bomba.vel.x, bomba.vel.y, bomba.vel.z);
  const chipSpeed = Math.hypot(cavadinha.vel.x, cavadinha.vel.y, cavadinha.vel.z);

  assert.ok(bombaSpeed > chipSpeed * 1.4, 'Bomba must be substantially faster than Cavadinha');
  assert.ok(cavadinha.vel.y > 4.0, 'Cavadinha must have noticeable upward loft');
});

test('straight penalty shot scores goal when keeper dives away', () => {
  const spot = PENALTY_SPOT;
  const ball = createInitialBallState(spot);
  const keeper = createInitialKeeperState(spot, 'penalty');
  const params: ShotParams = {
    aimX: 0.72,
    aimY: 0.65,
    power: 0.82,
    curve: 0.1,
    elevationBias: 0,
    shotType: 'placed',
  };

  const launch = computeShotLaunch(params, spot, 'penalty');
  ball.active = true;
  ball.vel = launch.vel;
  ball.spin = launch.spin;
  ball.shotType = params.shotType;

  // Keeper dives opposite direction (-1 left while shot goes right)
  const decision = { diveDir: -1 as const, targetX: -2.4, targetY: 0.8, reactionDelay: 0.05 };

  let scored = false;
  for (let i = 0; i < 120; i++) {
    const ev = stepBallAndActors(ball, keeper, [], decision, 1 / 60);
    if (ev.goalScored) {
      scored = true;
      break;
    }
  }

  assert.equal(scored, true);
  assert.equal(ball.outcome, 'goal');
});

test('free kick builds defensive wall and blocks low flat shot straight through wall', () => {
  const spot = getSpotForRound('freekick', 0);
  const wall = buildWallForSpot(spot, 'freekick');
  assert.ok(wall.length >= 3, 'Free kick must generate a defensive wall');

  const ball = createInitialBallState(spot);
  const keeper = createInitialKeeperState(spot, 'freekick');

  // Aim directly into the center of the wall at low height
  const wallCenterX = wall.reduce((acc, d) => acc + d.x, 0) / wall.length;
  const aimX = wallCenterX / (GOAL_HALF_WIDTH - 0.14);
  const params: ShotParams = {
    aimX,
    aimY: 0.18,
    power: 0.9,
    curve: 0,
    elevationBias: -0.6,
    shotType: 'knuckle',
  };

  const launch = computeShotLaunch(params, spot, 'freekick');
  ball.active = true;
  ball.vel = launch.vel;
  ball.spin = launch.spin;
  ball.shotType = params.shotType;

  let hitWall = false;
  for (let i = 0; i < 90; i++) {
    const ev = stepBallAndActors(
      ball,
      keeper,
      wall,
      { diveDir: 0, targetX: 0, targetY: 0.5, reactionDelay: 0.2 },
      1 / 60
    );
    if (ev.wallHit) {
      hitWall = true;
      break;
    }
  }

  assert.equal(hitWall, true);
  assert.equal(ball.outcome, 'wall');
});

test('wide shot outside goalpost registers as missed', () => {
  const spot = PENALTY_SPOT;
  const ball = createInitialBallState(spot);
  const keeper = createInitialKeeperState(spot, 'penalty');
  const params: ShotParams = {
    aimX: 1.38,
    aimY: 0.5,
    power: 0.85,
    curve: 0.5,
    elevationBias: 0,
    shotType: 'placed',
  };
  const launch = computeShotLaunch(params, spot, 'penalty');
  ball.active = true;
  ball.vel = launch.vel;
  ball.spin = launch.spin;

  for (let i = 0; i < 120; i++) {
    stepBallAndActors(
      ball,
      keeper,
      [],
      { diveDir: 0, targetX: 0, targetY: 0.5, reactionDelay: 0.2 },
      1 / 60
    );
    if (ball.outcome) break;
  }

  assert.equal(ball.outcome, 'missed');
  assert.ok(ball.pos.z <= GOAL_Z);
  assert.ok(ball.pos.y <= GOAL_HEIGHT * 2);
});

test('detectSpriteColumns isolates horizontal sprite poses cleanly', () => {
  // Simulate 40px wide sheet with 3 poses separated by gaps
  const cols = new Array<boolean>(40).fill(false);
  for (let i = 2; i <= 10; i++) cols[i] = true; // pose 1 (width 9 -> Wait min width is 12! Let's use realistic widths)
  const wideCols = new Array<boolean>(120).fill(false);
  for (let i = 5; i <= 25; i++) wideCols[i] = true;
  for (let i = 45; i <= 68; i++) wideCols[i] = true;
  for (let i = 88; i <= 112; i++) wideCols[i] = true;

  const slices = detectSpriteColumns(wideCols, 3, 4);
  assert.equal(slices.length, 3);
  assert.deepEqual(slices[0], { x: 5, width: 21 });
  assert.deepEqual(slices[1], { x: 45, width: 24 });
  assert.deepEqual(slices[2], { x: 88, width: 25 });
});

test('match rules advance 5-round series and compute top-corner curved goal bonus', () => {
  let stats = createInitialMatchStats('freekick', 0);
  const spot = getSpotForRound('freekick', 1);
  const params: ShotParams = {
    aimX: 0.8,
    aimY: 0.82,
    power: 0.88,
    curve: 0.75,
    elevationBias: 0,
    shotType: 'trivela',
  };

  for (let r = 0; r < 5; r++) {
    const summary = evaluateShotResult('goal', params, spot, false, 112, stats.streak);
    assert.ok(summary.topCorner);
    assert.ok(summary.curvedGoal);
    assert.ok(summary.points >= 300);

    const res = applyShotToStats(stats, summary);
    stats = res.nextStats;
    assert.equal(res.seriesComplete, r === 4);
  }

  assert.equal(stats.goals, 5);
  assert.equal(stats.bestStreak, 5);
  assert.equal(stats.history.length, 5);
});

test('extractSpriteComponents separates diagonal overlapping sprites cleanly', () => {
  const w = 40;
  const h = 30;
  const mask = new Uint8Array(w * h);

  // Sprite 1: diagonal top-right to bottom-left (x=4..18)
  for (let y = 4; y < 22; y++) {
    for (let x = 4; x < 14; x++) {
      mask[y * w + x] = 1;
    }
  }
  // Sprite 2: diagonal overlapping in X (x=11..30) but spatially separated in 2D
  for (let y = 2; y < 16; y++) {
    for (let x = 18; x < 28; x++) {
      mask[y * w + x] = 1;
    }
  }
  // Extend sprite 2 diagonally down-left into x=11..18 at lower y=25..28? No, keep 2D gap >=2px:
  for (let y = 24; y < 29; y++) {
    for (let x = 10; x < 22; x++) {
      mask[y * w + x] = 1;
    }
  }
  // Bridge sprite 2's two parts on the right side (x=22..27, y=15..25)
  for (let y = 15; y < 26; y++) {
    for (let x = 22; x < 27; x++) {
      mask[y * w + x] = 1;
    }
  }

  const { boxes } = extractSpriteComponents(mask, w, h, 2);
  assert.equal(boxes.length, 2);
  assert.ok(boxes[0].maxX < 18, 'First component must not absorb second component');
  assert.ok(boxes[1].minX <= 10 && boxes[1].maxX >= 26, 'Second diagonal component stays intact');
});
