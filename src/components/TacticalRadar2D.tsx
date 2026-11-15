import { useEffect, useRef } from 'react';
import { RadarTelemetry } from '../game/StadiumScene';
import { GOAL_HALF_WIDTH, GOAL_Z } from '../game/types';

interface TacticalRadar2DProps {
  telemetryRef: React.MutableRefObject<RadarTelemetry | null>;
  active: boolean;
}

export function TacticalRadar2D({ telemetryRef, active }: TacticalRadar2DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      const data = telemetryRef.current;
      if (canvas && data) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Pitch turf background
          ctx.fillStyle = '#0a291d';
          ctx.fillRect(0, 0, w, h);

          // Map world X (-22..+22) and Z (-54..-16) onto radar canvas
          const toX = (wx: number) => ((wx + 22) / 44) * w;
          const toY = (wz: number) => ((wz + 55) / 39) * h;

          // Mowed stripes
          ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
          for (let i = 0; i < 8; i += 2) {
            ctx.fillRect(0, (i / 8) * h, w, h / 8);
          }

          // Pitch lines
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
          ctx.lineWidth = 1.2;

          // Goal line
          const gy = toY(GOAL_Z);
          ctx.beginPath();
          ctx.moveTo(4, gy);
          ctx.lineTo(w - 4, gy);
          ctx.stroke();

          // Penalty box
          const pxL = toX(-20.16);
          const pxR = toX(20.16);
          const pxB = toY(GOAL_Z + 16.5);
          ctx.strokeRect(pxL, gy, pxR - pxL, pxB - gy);

          // 6-yard box
          const sxL = toX(-9.16);
          const sxR = toX(9.16);
          const sxB = toY(GOAL_Z + 5.5);
          ctx.strokeRect(sxL, gy, sxR - sxL, sxB - gy);

          // Goal frame
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(toX(-GOAL_HALF_WIDTH), gy);
          ctx.lineTo(toX(GOAL_HALF_WIDTH), gy);
          ctx.stroke();

          // Preview arc
          if (data.preview.length > 1) {
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            data.preview.forEach((pt, idx) => {
              const rx = toX(pt.x);
              const ry = toY(pt.z);
              if (idx === 0) ctx.moveTo(rx, ry);
              else ctx.lineTo(rx, ry);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Actual flight trail
          if (data.trail.length > 1) {
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 2;
            ctx.beginPath();
            data.trail.forEach((pt, idx) => {
              const rx = toX(pt.x);
              const ry = toY(pt.z);
              if (idx === 0) ctx.moveTo(rx, ry);
              else ctx.lineTo(rx, ry);
            });
            ctx.stroke();
          }

          // Wall defenders
          ctx.fillStyle = '#3b82f6';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          for (const d of data.wall) {
            ctx.beginPath();
            ctx.arc(toX(d.x), toY(d.z), 3.3, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }

          // Goalkeeper
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(toX(data.keeper.x), toY(data.keeper.z), 4.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Ball
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(toX(data.ball.x), toY(data.ball.z), 3.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, telemetryRef]);

  return (
    <div className="hidden md:flex flex-col gap-1 p-2 rounded-lg bg-[#07111a]/80 border border-white/15 shadow-lg">
      <div className="flex items-center justify-between text-[10px] tracking-wider uppercase text-emerald-300/90 font-semibold">
        <span>Mapa Tático 2D</span>
      </div>
      <canvas
        ref={canvasRef}
        width={136}
        height={118}
        className="rounded border border-white/10 block"
      />
    </div>
  );
}
