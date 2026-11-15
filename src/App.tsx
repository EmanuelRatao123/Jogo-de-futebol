import {
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetGalleryModal } from './components/AssetGalleryModal';
import { BallStrikeControl2D } from './components/BallStrikeControl2D';
import { TacticalRadar2D } from './components/TacticalRadar2D';
import { TitleEmblemSvg } from './components/TitleEmblemSvg';
import { audioEngine } from './game/audio';
import {
  applyShotToStats,
  createInitialMatchStats,
  evaluateShotResult,
  getSpotForRound,
} from './game/rules';
import { RadarTelemetry, StadiumScene } from './game/StadiumScene';
import {
  GameMode,
  GameScreenState,
  KickSpot,
  MatchStats,
  SHOT_TYPES,
  ShotOutcome,
  ShotParams,
  ShotResultSummary,
  ShotType,
} from './game/types';

const BEST_SCORE_STORAGE_KEY = 'camisa10_best_score_v1';

function readStoredBestScore(): number {
  try {
    const raw = window.localStorage.getItem(BEST_SCORE_STORAGE_KEY);
    return raw ? Math.max(0, Number(raw) || 0) : 0;
  } catch {
    return 0;
  }
}

function writeStoredBestScore(score: number) {
  try {
    window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(score));
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export default function App() {
  const autostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [screenState, setScreenState] = useState<GameScreenState>(
    autostart ? 'playing' : 'title'
  );
  const [mode, setMode] = useState<GameMode>('penalty');
  const [stats, setStats] = useState<MatchStats>(() =>
    createInitialMatchStats('penalty', readStoredBestScore())
  );
  const [spot, setSpot] = useState<KickSpot>(() => getSpotForRound('penalty', 0));
  const [shotParams, setShotParams] = useState<ShotParams>({
    aimX: 0.42,
    aimY: 0.56,
    power: 0.78,
    curve: 0.3,
    elevationBias: 0,
    shotType: 'placed',
  });

  const [shotInFlight, setShotInFlight] = useState(false);
  const [lastResult, setLastResult] = useState<ShotResultSummary | null>(null);
  const [muted, setMuted] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  const [keeperFrames, setKeeperFrames] = useState<HTMLCanvasElement[]>([]);
  const [defenderFrames, setDefenderFrames] = useState<HTMLCanvasElement[]>([]);

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<StadiumScene | null>(null);
  const telemetryRef = useRef<RadarTelemetry | null>(null);

  // Power charging via DOM ref so charging never triggers 60Hz React re-renders
  const powerFillRef = useRef<HTMLDivElement | null>(null);
  const powerLabelRef = useRef<HTMLSpanElement | null>(null);
  const chargingStateRef = useRef<{
    active: boolean;
    startedAt: number;
    value: number;
    dir: 1 | -1;
    rafId: number;
  }>({
    active: false,
    startedAt: 0,
    value: 0.78,
    dir: 1,
    rafId: 0,
  });

  // Mutable refs for event listeners & WebGL callbacks
  const screenStateRef = useRef(screenState);
  const modeRef = useRef(mode);
  const statsRef = useRef(stats);
  const spotRef = useRef(spot);
  const shotParamsRef = useRef(shotParams);
  const shotInFlightRef = useRef(shotInFlight);
  const keysHeldRef = useRef<Set<string>>(new Set());

  screenStateRef.current = screenState;
  modeRef.current = mode;
  statsRef.current = stats;
  spotRef.current = spot;
  shotParamsRef.current = shotParams;
  shotInFlightRef.current = shotInFlight;

  useEffect(() => {
    document.body.dataset.state = screenState;
    sceneRef.current?.setScreenState(screenState);
  }, [screenState]);

  useEffect(() => {
    sceneRef.current?.setShotParams(shotParams);
  }, [shotParams]);

  const startNewSeries = useCallback(
    (targetMode: GameMode, nextState: GameScreenState = 'playing') => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const best = Math.max(statsRef.current.bestScore, readStoredBestScore());
      const freshStats = createInitialMatchStats(targetMode, best);
      const firstSpot = getSpotForRound(targetMode, 0);

      setMode(targetMode);
      setStats(freshStats);
      setSpot(firstSpot);
      setShotInFlight(false);
      setLastResult(null);
      setScreenState(nextState);

      sceneRef.current?.resetForSpot(firstSpot, targetMode, 0);
      sceneRef.current?.setScreenState(nextState);
      if (nextState === 'playing') {
        audioEngine.playWhistle();
      }
    },
    []
  );

  const handleShotComplete = useCallback(
    (outcome: ShotOutcome, hitPost: boolean, speedKmh: number) => {
      const currentStats = statsRef.current;
      const currentSpot = spotRef.current;
      const currentParams = shotParamsRef.current;

      const summary = evaluateShotResult(
        outcome,
        currentParams,
        currentSpot,
        hitPost,
        speedKmh,
        currentStats.streak
      );
      const { nextStats, seriesComplete } = applyShotToStats(currentStats, summary);
      writeStoredBestScore(nextStats.bestScore);

      setLastResult(summary);
      setStats(nextStats);
      setShotInFlight(false);

      if (seriesComplete) {
        setScreenState('gameover');
        sceneRef.current?.setScreenState('gameover');
      } else {
        const nextSpot = getSpotForRound(currentStats.mode, nextStats.history.length);
        setSpot(nextSpot);
        sceneRef.current?.resetForSpot(nextSpot, currentStats.mode, nextStats.history.length);
      }
    },
    []
  );

  // Mount Three.js WebGL StadiumScene once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const initialSpot = getSpotForRound(modeRef.current, 0);
    const scene = new StadiumScene(container, initialSpot, {
      onShotComplete: (outcome, hitPost, speedKmh) => {
        handleShotComplete(outcome, hitPost, speedKmh);
      },
      onAimChange: (aimX, aimY) => {
        setShotParams((prev) => ({ ...prev, aimX, aimY }));
      },
      onLiveTelemetry: (data) => {
        telemetryRef.current = data;
      },
      onSpritesReady: (kFrames, dFrames) => {
        setKeeperFrames(kFrames);
        setDefenderFrames(dFrames);
      },
    });
    scene.setScreenState(screenStateRef.current);
    sceneRef.current = scene;

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [handleShotComplete]);

  // Execute shot with given power
  const triggerKick = useCallback((powerOverride?: number) => {
    if (screenStateRef.current !== 'playing' || shotInFlightRef.current) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const finalPower = powerOverride ?? shotParamsRef.current.power;
    const params: ShotParams = {
      ...shotParamsRef.current,
      power: Math.max(0.15, Math.min(1.0, finalPower)),
    };
    setShotParams(params);
    setLastResult(null);
    setShotInFlight(true);
    sceneRef.current?.fireShot(params);
  }, []);

  const stopChargeAndFire = useCallback(
    (cancelOnly = false) => {
      const ch = chargingStateRef.current;
      if (!ch.active) return;
      ch.active = false;
      cancelAnimationFrame(ch.rafId);

      if (cancelOnly) return;

      const heldMs = performance.now() - ch.startedAt;
      // Quick tap (<150ms) uses slider preset power; longer hold uses charged gauge value
      const kickPower = heldMs < 150 ? shotParamsRef.current.power : ch.value;
      triggerKick(kickPower);
    },
    [triggerKick]
  );

  const beginPowerCharge = useCallback(() => {
    if (screenStateRef.current !== 'playing' || shotInFlightRef.current) return;
    const ch = chargingStateRef.current;
    if (ch.active) return;

    ch.active = true;
    ch.startedAt = performance.now();
    ch.value = 0.22;
    ch.dir = 1;

    let lastT = performance.now();
    const step = (now: number) => {
      if (!ch.active) return;
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;

      ch.value += ch.dir * dt * 1.15;
      if (ch.value >= 1.0) {
        ch.value = 1.0;
        ch.dir = -1;
      } else if (ch.value <= 0.2) {
        ch.value = 0.2;
        ch.dir = 1;
      }

      if (powerFillRef.current) {
        powerFillRef.current.style.transform = `scaleX(${ch.value})`;
      }
      if (powerLabelRef.current) {
        powerLabelRef.current.textContent = `${Math.round(ch.value * 100)}%`;
      }
      ch.rafId = requestAnimationFrame(step);
    };
    ch.rafId = requestAnimationFrame(step);
  }, []);

  // Sync power slider visual when not actively charging
  useEffect(() => {
    if (chargingStateRef.current.active) return;
    if (powerFillRef.current) {
      powerFillRef.current.style.transform = `scaleX(${shotParams.power})`;
    }
    if (powerLabelRef.current) {
      powerLabelRef.current.textContent = `${Math.round(shotParams.power * 100)}%`;
    }
  }, [shotParams.power]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      audioEngine.setMuted(next);
      return next;
    });
  }, []);

  // Keyboard controls (WASD/Arrows aim, Q/E curve, 1-4 shot type, Space charge/kick, P/Esc pause, M mute, R restart)
  useEffect(() => {
    let aimLoopId = 0;
    let lastTime = performance.now();

    const updateHeldAim = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      if (
        screenStateRef.current === 'playing' &&
        !shotInFlightRef.current &&
        keysHeldRef.current.size > 0
      ) {
        const held = keysHeldRef.current;
        let dx = 0;
        let dy = 0;
        let dc = 0;

        if (held.has('ArrowLeft') || held.has('KeyA')) dx -= 1;
        if (held.has('ArrowRight') || held.has('KeyD')) dx += 1;
        if (held.has('ArrowUp') || held.has('KeyW')) dy += 1;
        if (held.has('ArrowDown') || held.has('KeyS')) dy -= 1;
        if (held.has('KeyQ')) dc -= 1;
        if (held.has('KeyE')) dc += 1;

        if (dx !== 0 || dy !== 0 || dc !== 0) {
          setShotParams((prev) => ({
            ...prev,
            aimX: Math.max(-1.25, Math.min(1.25, prev.aimX + dx * dt * 1.15)),
            aimY: Math.max(0.08, Math.min(1.25, prev.aimY + dy * dt * 0.95)),
            curve: Math.max(-1, Math.min(1, prev.curve + dc * dt * 1.35)),
          }));
        }
      }
      aimLoopId = requestAnimationFrame(updateHeldAim);
    };
    aimLoopId = requestAnimationFrame(updateHeldAim);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      // Title / Game Over quick-start via Enter or Space
      if (screenStateRef.current === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          startNewSeries(modeRef.current, 'playing');
        }
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (showAssetsModal) {
          setShowAssetsModal(false);
          return;
        }
        if (screenStateRef.current === 'playing') {
          stopChargeAndFire(true);
          setScreenState('paused');
        } else if (screenStateRef.current === 'paused') {
          setScreenState('playing');
        }
        return;
      }

      if (e.code === 'KeyM') {
        toggleMute();
        return;
      }

      if (e.code === 'KeyR') {
        e.preventDefault();
        stopChargeAndFire(true);
        startNewSeries(modeRef.current, 'playing');
        return;
      }

      if (screenStateRef.current !== 'playing') return;

      keysHeldRef.current.add(e.code);

      if (e.code === 'Digit1') {
        setShotParams((p) => ({ ...p, shotType: 'placed' }));
      } else if (e.code === 'Digit2') {
        setShotParams((p) => ({ ...p, shotType: 'trivela' }));
      } else if (e.code === 'Digit3') {
        setShotParams((p) => ({ ...p, shotType: 'knuckle' }));
      } else if (e.code === 'Digit4') {
        setShotParams((p) => ({ ...p, shotType: 'chip' }));
      } else if (e.code === 'Space') {
        e.preventDefault();
        beginPowerCharge();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        triggerKick();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeldRef.current.delete(e.code);
      if (e.code === 'Space' && screenStateRef.current === 'playing') {
        e.preventDefault();
        stopChargeAndFire(false);
      }
    };

    const clearInputsOnBlur = () => {
      keysHeldRef.current.clear();
      stopChargeAndFire(true);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearInputsOnBlur);
    document.addEventListener('visibilitychange', clearInputsOnBlur);

    return () => {
      cancelAnimationFrame(aimLoopId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearInputsOnBlur);
      document.removeEventListener('visibilitychange', clearInputsOnBlur);
    };
  }, [beginPowerCharge, showAssetsModal, startNewSeries, stopChargeAndFire, toggleMute, triggerKick]);

  const shotTypesList = Object.values(SHOT_TYPES);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#07111a]">
      {/* Isolated 3D WebGL Stadium Viewport */}
      <div
        ref={canvasMountRef}
        data-testid="stadium-canvas"
        className="fixed inset-0 z-0"
      />

      {/* TITLE SCREEN */}
      {screenState === 'title' && (
        <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10 pointer-events-none bg-gradient-to-r from-[#050c14]/90 via-[#050c14]/55 to-transparent">
          <div className="flex items-center justify-between pointer-events-auto">
            <div className="text-xs font-medium tracking-wider text-emerald-300/90 uppercase">
              Estádio 3D · Sprites 2D · Física Magnus
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAssetsModal(true)}
                className="px-3 py-1.5 rounded-lg bg-[#0c1a28]/90 hover:bg-[#13293f] border border-white/15 text-xs font-medium text-slate-200 flex items-center gap-1.5 cursor-pointer"
              >
                <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                <span>Assets &amp; Spritesheets</span>
              </button>
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? 'Ativar som' : 'Silenciar som'}
                className="w-9 h-9 rounded-lg bg-[#0c1a28]/90 hover:bg-[#13293f] border border-white/15 flex items-center justify-center text-slate-200 cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="my-auto max-w-lg pointer-events-auto space-y-6">
            <TitleEmblemSvg />

            <p className="text-sm md:text-base text-slate-200 leading-relaxed max-w-md">
              Domine a bola parada em cobranças de pênalti e falta com controle real de curva, ponto de impacto 2D, força e quatro estilos de batida.
            </p>

            {/* Mode Selection */}
            <div className="inline-flex p-1 rounded-lg bg-[#08131f]/90 border border-white/15 gap-1">
              <button
                type="button"
                onClick={() => setMode('penalty')}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer ${
                  mode === 'penalty'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Modo Pênalti (11m)
              </button>
              <button
                type="button"
                onClick={() => setMode('freekick')}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer ${
                  mode === 'freekick'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Modo Falta (Barreira)
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-start="true"
                onClick={() => startNewSeries(mode, 'playing')}
                className="px-7 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-slate-950 font-display text-2xl font-extrabold tracking-wide shadow-lg cursor-pointer flex items-center gap-2 transition-transform"
              >
                <Play className="w-5 h-5 fill-slate-950" />
                <span>INICIAR SÉRIE</span>
              </button>
            </div>
          </div>

          {/* Flat Control Hint */}
          <div className="text-xs text-slate-300/90 font-medium tracking-wide">
            Arraste ou Setas/WASD: Mira · Q/E ou Bola 2D: Curva · 1–4: Tipo de Chute · Espaço: Força · Esc: Pausa
          </div>
        </div>
      )}

      {/* ACTIVE GAMEPLAY HUD */}
      {screenState !== 'title' && (
        <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-5">
          {/* Top Perimeter Row */}
          <div className="flex items-start justify-between gap-4">
            {/* Top-Left Scoreboard Cluster */}
            <div className="pointer-events-auto flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[#07111a]/85 border border-white/15 shadow-lg">
                {/* Mode Quick Switch */}
                <div className="flex items-center p-0.5 rounded-md bg-white/5 border border-white/10">
                  <button
                    type="button"
                    disabled={shotInFlight}
                    onClick={() => startNewSeries('penalty', 'playing')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50 ${
                      mode === 'penalty'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Pênalti
                  </button>
                  <button
                    type="button"
                    disabled={shotInFlight}
                    onClick={() => startNewSeries('freekick', 'playing')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50 ${
                      mode === 'freekick'
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Falta
                  </button>
                </div>

                <div className="h-6 w-px bg-white/15" aria-hidden="true" />

                {/* Hero Goals & Score Readouts */}
                <div className="flex items-baseline gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                      Gols
                    </div>
                    <div
                      data-testid="goals-count"
                      className="font-display text-2xl font-extrabold leading-none text-emerald-400 font-mono-num"
                    >
                      {stats.goals}/{stats.totalRounds}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                      Pontos
                    </div>
                    <div
                      data-testid="score-value"
                      className="font-display text-2xl font-extrabold leading-none text-white font-mono-num"
                    >
                      {stats.score}
                    </div>
                  </div>
                </div>

                <div className="h-6 w-px bg-white/15 hidden sm:block" aria-hidden="true" />

                {/* 5-Kick Series Socket Pips */}
                <div className="hidden sm:flex items-center gap-1.5" aria-label="Progresso da série">
                  {Array.from({ length: stats.totalRounds }).map((_, idx) => {
                    const outcome = stats.history[idx];
                    const isCurrent = idx === stats.history.length && screenState === 'playing';
                    return (
                      <div
                        key={idx}
                        title={
                          outcome === 'goal'
                            ? 'Gol'
                            : outcome
                              ? 'Perdido'
                              : isCurrent
                                ? 'Chute atual'
                                : 'Pendente'
                        }
                        className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                          outcome === 'goal'
                            ? 'bg-emerald-500 border-emerald-300'
                            : outcome
                              ? 'bg-rose-500/80 border-rose-300'
                              : isCurrent
                                ? 'bg-amber-400/25 border-amber-400'
                                : 'bg-transparent border-white/25'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Spot Distance Sub-label */}
              <div className="px-2 text-xs font-medium text-slate-200 hud-text-stroke flex items-center gap-2">
                <span>{spot.label}</span>
                {stats.streak >= 2 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-300 font-semibold">
                      Sequência {stats.streak}x
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Top-Right Utility Controls & 2D Tactical Radar */}
            <div className="flex flex-col items-end gap-2">
              <div className="pointer-events-auto flex items-center gap-1.5">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setShowAssetsModal(true);
                  }}
                  aria-label="Ver assets e spritesheets"
                  title="Assets & Spritesheets"
                  className="w-9 h-9 rounded-lg bg-[#07111a]/85 hover:bg-[#102436] border border-white/15 flex items-center justify-center text-amber-300 cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    toggleMute();
                  }}
                  aria-label={muted ? 'Ativar som [M]' : 'Silenciar som [M]'}
                  title="Som [M]"
                  className="w-9 h-9 rounded-lg bg-[#07111a]/85 hover:bg-[#102436] border border-white/15 flex items-center justify-center text-slate-200 cursor-pointer"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    stopChargeAndFire(true);
                    startNewSeries(mode, 'playing');
                  }}
                  aria-label="Reiniciar série [R]"
                  title="Reiniciar [R]"
                  className="w-9 h-9 rounded-lg bg-[#07111a]/85 hover:bg-[#102436] border border-white/15 flex items-center justify-center text-slate-200 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    stopChargeAndFire(true);
                    setScreenState((s) => (s === 'paused' ? 'playing' : 'paused'));
                  }}
                  aria-label="Pausar jogo [P]"
                  title="Pausar [P]"
                  className="w-9 h-9 rounded-lg bg-[#07111a]/85 hover:bg-[#102436] border border-white/15 flex items-center justify-center text-slate-200 cursor-pointer"
                >
                  <Pause className="w-4 h-4" />
                </button>
              </div>

              <TacticalRadar2D
                telemetryRef={telemetryRef}
                active={screenState === 'playing'}
              />
            </div>
          </div>

          {/* Transient Shot Result Callout (High-Center, unobstructed pitch center) */}
          {lastResult && screenState === 'playing' && (
            <div className="mx-auto mb-auto mt-2 text-center pointer-events-none">
              <div
                data-testid="shot-result-banner"
                className={`px-5 py-2 rounded-xl border shadow-xl ${
                  lastResult.outcome === 'goal'
                    ? 'bg-emerald-950/90 border-emerald-400/50 text-emerald-300'
                    : 'bg-[#07111a]/90 border-white/20 text-amber-300'
                }`}
              >
                <div className="font-display text-3xl md:text-4xl font-extrabold italic tracking-wide leading-none">
                  {lastResult.label}
                </div>
                <div className="text-xs font-mono-num text-slate-200 mt-1">
                  {lastResult.sublabel}
                </div>
              </div>
            </div>
          )}

          {/* UNIFIED COLLAPSIBLE BOTTOM CONTROL DOCK */}
          {screenState === 'playing' && (
            <div className="mx-auto w-full max-w-[920px] flex flex-col items-center pointer-events-none">
              <button
                type="button"
                onClick={() => setDockCollapsed((c) => !c)}
                className="pointer-events-auto px-3 py-1 rounded-t-lg bg-[#07111a]/90 border border-b-0 border-white/15 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                {dockCollapsed ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span>Mostrar Controles</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>Ocultar Controles</span>
                  </>
                )}
              </button>

              {!dockCollapsed && (
                <div className="pointer-events-auto w-full rounded-xl bg-[#07111a]/90 border border-white/15 p-3 shadow-2xl flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                  {/* 1. Shot Type Selector */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1">
                    {shotTypesList.map((st) => {
                      const active = shotParams.shotType === st.id;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          disabled={shotInFlight}
                          onClick={() =>
                            setShotParams((prev) => ({ ...prev, shotType: st.id as ShotType }))
                          }
                          className={`px-2.5 py-2 rounded-lg border text-left transition-colors cursor-pointer disabled:opacity-50 ${
                            active
                              ? 'bg-white/12 border-amber-400/80 text-white'
                              : 'bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.07]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold whitespace-nowrap">
                              {st.name}
                            </span>
                            <span
                              className="text-[10px] font-mono-num px-1 rounded bg-white/10 text-slate-300"
                              aria-hidden="true"
                            >
                              {st.key}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {st.role}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="hidden lg:block h-11 w-px bg-white/15" aria-hidden="true" />

                  {/* 2. 2D Ball Impact & Curve Control */}
                  <div className="flex items-center justify-between lg:justify-start gap-3">
                    <BallStrikeControl2D
                      curve={shotParams.curve}
                      elevationBias={shotParams.elevationBias}
                      disabled={shotInFlight}
                      onChange={(curve, elevationBias) =>
                        setShotParams((prev) => ({ ...prev, curve, elevationBias }))
                      }
                    />
                  </div>

                  <div className="hidden lg:block h-11 w-px bg-white/15" aria-hidden="true" />

                  {/* 3. Power Meter & Kick Trigger */}
                  <div className="flex items-center gap-3 min-w-[230px]">
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold">
                        <span className="text-slate-400">Força [Espaço]</span>
                        <span
                          ref={powerLabelRef}
                          className="font-mono-num text-amber-300 font-bold"
                        >
                          {Math.round(shotParams.power * 100)}%
                        </span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          ref={powerFillRef}
                          style={{ transform: `scaleX(${shotParams.power})` }}
                          className="h-full w-full origin-left bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500"
                        />
                      </div>
                      <input
                        type="range"
                        aria-label="Ajustar força do chute"
                        min={20}
                        max={100}
                        value={Math.round(shotParams.power * 100)}
                        disabled={shotInFlight}
                        onChange={(e) =>
                          setShotParams((prev) => ({
                            ...prev,
                            power: Number(e.target.value) / 100,
                          }))
                        }
                        className="stadium-slider w-full mt-0.5"
                      />
                    </div>

                    <button
                      type="button"
                      data-testid="kick-button"
                      disabled={shotInFlight}
                      onPointerDown={(e) => {
                        if (e.button === 0) beginPowerCharge();
                      }}
                      onPointerUp={() => stopChargeAndFire(false)}
                      onPointerLeave={() => {
                        if (chargingStateRef.current.active) stopChargeAndFire(false);
                      }}
                      onClick={() => {
                        // Keyboard Enter/Click fallback if pointerDown/Up didn't charge
                        if (!chargingStateRef.current.active && !shotInFlight) {
                          triggerKick();
                        }
                      }}
                      className="px-5 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed text-slate-950 font-display text-xl font-extrabold tracking-wide whitespace-nowrap shrink-0 cursor-pointer shadow-lg"
                    >
                      {shotInFlight ? 'NO AR...' : 'CHUTAR'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* PAUSE MODAL */}
      {screenState === 'paused' && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#040a11]/75 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Jogo Pausado"
        >
          <div className="w-full max-w-sm rounded-xl bg-[#0b1826] border border-white/15 p-6 shadow-2xl text-center space-y-5">
            <div>
              <h2 className="font-display text-3xl font-extrabold italic text-white tracking-wide">
                JOGO PAUSADO
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {mode === 'penalty' ? 'Série de Pênaltis' : 'Série de Faltas'} · Chute{' '}
                {Math.min(stats.round, stats.totalRounds)}/{stats.totalRounds}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] uppercase text-slate-400">Gols</div>
                <div className="font-display text-2xl font-bold text-emerald-400 font-mono-num">
                  {stats.goals}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] uppercase text-slate-400">Pontos</div>
                <div className="font-display text-2xl font-bold text-white font-mono-num">
                  {stats.score}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] uppercase text-slate-400">Recorde</div>
                <div className="font-display text-2xl font-bold text-amber-300 font-mono-num">
                  {stats.bestScore}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setScreenState('playing')}
                className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm cursor-pointer"
              >
                Retomar Partida
              </button>
              <button
                type="button"
                onClick={() => startNewSeries(mode, 'playing')}
                className="w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-semibold text-sm cursor-pointer"
              >
                Reiniciar Série
              </button>
              <button
                type="button"
                onClick={() => startNewSeries(mode, 'title')}
                className="w-full py-2.5 rounded-lg bg-transparent hover:bg-white/5 border border-white/15 text-slate-300 font-medium text-sm cursor-pointer"
              >
                Voltar à Tela Inicial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SERIES COMPLETE / GAME OVER MODAL */}
      {screenState === 'gameover' && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#040a11]/80 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Fim da Série"
        >
          <div className="w-full max-w-md rounded-xl bg-[#0b1826] border border-white/15 p-6 shadow-2xl text-center space-y-5">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-400/40 flex items-center justify-center mb-3">
                <Trophy className="w-6 h-6 text-amber-400" />
              </div>
              <h2 className="font-display text-4xl font-extrabold italic text-white tracking-wide">
                {stats.goals >= 3 ? 'VITÓRIA NA SÉRIE!' : 'FIM DA SÉRIE'}
              </h2>
              <p className="text-xs text-slate-300 mt-1">
                {mode === 'penalty' ? 'Desafio de Pênaltis' : 'Desafio de Faltas'} ·{' '}
                {stats.goals} de {stats.totalRounds} convertidos
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Aproveitamento
                </div>
                <div className="font-display text-2xl font-bold text-emerald-400 font-mono-num mt-0.5">
                  {Math.round((stats.goals / stats.totalRounds) * 100)}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Pontuação
                </div>
                <div className="font-display text-2xl font-bold text-white font-mono-num mt-0.5">
                  {stats.score}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Recorde
                </div>
                <div className="font-display text-2xl font-bold text-amber-300 font-mono-num mt-0.5">
                  {stats.bestScore}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                data-start="true"
                onClick={() => startNewSeries(mode, 'playing')}
                className="flex-1 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display text-xl font-extrabold tracking-wide cursor-pointer"
              >
                JOGAR NOVAMENTE
              </button>
              <button
                type="button"
                onClick={() =>
                  startNewSeries(mode === 'penalty' ? 'freekick' : 'penalty', 'playing')
                }
                className="flex-1 py-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-200 font-semibold text-sm cursor-pointer"
              >
                {mode === 'penalty' ? 'Ir para Faltas' : 'Ir para Pênaltis'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => startNewSeries(mode, 'title')}
              className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
            >
              Voltar à Tela Inicial
            </button>
          </div>
        </div>
      )}

      {/* GENERATED ASSETS & SPRITESHEETS MODAL */}
      <AssetGalleryModal
        open={showAssetsModal}
        keeperFrames={keeperFrames}
        defenderFrames={defenderFrames}
        onClose={() => setShowAssetsModal(false)}
      />
    </div>
  );
}
