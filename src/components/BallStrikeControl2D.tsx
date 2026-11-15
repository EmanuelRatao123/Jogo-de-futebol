import { useRef } from 'react';

interface BallStrikeControl2DProps {
  curve: number; // -1 to 1
  elevationBias: number; // -1 to 1
  disabled?: boolean;
  onChange: (curve: number, elevationBias: number) => void;
}

/**
 * Interactive 2D Ball Strike-Zone widget: clicking or dragging on the ball
 * sets horizontal curve (-1 left .. +1 right) and vertical contact point
 * (-1 topspin/dip .. +1 under-ball loft).
 */
export function BallStrikeControl2D({
  curve,
  elevationBias,
  disabled,
  onChange,
}: BallStrikeControl2DProps) {
  const padRef = useRef<HTMLDivElement | null>(null);

  const updateFromPointer = (clientX: number, clientY: number) => {
    if (disabled || !padRef.current) return;
    const rect = padRef.current.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((clientY - rect.top) / rect.height) * 2 - 1;

    // Clamp inside unit circle so contact stays on the ball face
    const mag = Math.hypot(nx, ny);
    const cx = mag > 1 ? nx / mag : nx;
    const cy = mag > 1 ? ny / mag : ny;

    // Clicking right side of ball imparts left-to-right/right-to-left intuitive curve:
    // Let left side = curve left (-1), right side = curve right (+1), bottom = loft (+1), top = topspin (-1)
    onChange(Number(cx.toFixed(2)), Number(cy.toFixed(2)));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.buttons === 0) return;
    updateFromPointer(e.clientX, e.clientY);
  };

  const dotX = 50 + curve * 36;
  const dotY = 50 + elevationBias * 36;

  return (
    <div className="flex items-center gap-2.5">
      <div
        ref={padRef}
        role="slider"
        aria-label="Ponto de impacto e curva na bola"
        aria-valuetext={`Curva ${Math.round(curve * 100)}%, Altura ${Math.round(elevationBias * 100)}%`}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        className={`relative w-14 h-14 rounded-full shrink-0 border-2 border-white/25 bg-[#0f172a] overflow-hidden touch-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-crosshair hover:border-amber-400/70'
        }`}
      >
        {/* 2D Vector Ball Pattern */}
        <svg viewBox="0 0 100 100" className="w-full h-full pointer-events-none">
          <circle cx="50" cy="50" r="46" fill="#f8fafc" />
          <polygon points="50,33 65,44 59,62 41,62 35,44" fill="#0f172a" />
          <line x1="50" y1="33" x2="50" y2="8" stroke="#334155" strokeWidth="2.5" />
          <line x1="65" y1="44" x2="90" y2="34" stroke="#334155" strokeWidth="2.5" />
          <line x1="59" y1="62" x2="77" y2="85" stroke="#334155" strokeWidth="2.5" />
          <line x1="41" y1="62" x2="23" y2="85" stroke="#334155" strokeWidth="2.5" />
          <line x1="35" y1="44" x2="10" y2="34" stroke="#334155" strokeWidth="2.5" />
          <circle cx="50" cy="50" r="46" fill="none" stroke="#94a3b8" strokeWidth="2" />
        </svg>

        {/* Strike Contact Crosshair */}
        <div
          style={{ left: `${dotX}%`, top: `${dotY}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white shadow-md pointer-events-none"
        />
      </div>

      <div className="flex flex-col text-left min-w-[78px]">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
          Curva [Q/E]
        </span>
        <span className="font-mono-num text-xs font-bold text-amber-300">
          {curve === 0
            ? 'Reta'
            : curve > 0
              ? `Dir +${Math.round(curve * 100)}%`
              : `Esq ${Math.round(curve * 100)}%`}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(0, 0)}
          className="text-[10px] text-slate-400 hover:text-white text-left underline decoration-slate-600 cursor-pointer disabled:opacity-40"
        >
          Centralizar
        </button>
      </div>
    </div>
  );
}
