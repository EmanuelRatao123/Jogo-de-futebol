import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GENERATED_ASSETS } from '../game/assets';

interface AssetGalleryModalProps {
  open: boolean;
  keeperFrames: HTMLCanvasElement[];
  defenderFrames: HTMLCanvasElement[];
  onClose: () => void;
}

export function AssetGalleryModal({
  open,
  keeperFrames,
  defenderFrames,
  onClose,
}: AssetGalleryModalProps) {
  const [keeperUrls, setKeeperUrls] = useState<string[]>([]);
  const [defenderUrls, setDefenderUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setKeeperUrls(keeperFrames.map((c) => c.toDataURL('image/png')));
    setDefenderUrls(defenderFrames.map((c) => c.toDataURL('image/png')));
  }, [open, keeperFrames, defenderFrames]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#040a11]/85 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Assets 3D e Spritesheets 2D Gerados"
    >
      <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-xl bg-[#0c1a28] border border-white/15 p-6 shadow-2xl text-slate-100">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-wide text-white">
              Assets 3D &amp; Spritesheets 2D Gerados
            </h2>
            <p className="text-xs text-slate-400">
              Texturas 3D e quadros 2D recortados por chroma-key integrados na cena do estádio
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar galeria de assets"
            className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-emerald-300 mb-2">
              Mapas &amp; Texturas 3D
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-[#08121d] border border-white/10 p-2">
                <img
                  src={GENERATED_ASSETS.pitchGrassMap}
                  alt="Mapa de grama do gramado 3D"
                  referrerPolicy="no-referrer"
                  className="w-full h-28 object-cover rounded"
                />
                <p className="mt-1.5 text-xs font-medium text-slate-200">Gramado do Campo</p>
              </div>
              <div className="rounded-lg bg-[#08121d] border border-white/10 p-2">
                <img
                  src={GENERATED_ASSETS.soccerBallMap}
                  alt="Mapa UV da bola de futebol 3D"
                  referrerPolicy="no-referrer"
                  className="w-full h-28 object-cover rounded"
                />
                <p className="mt-1.5 text-xs font-medium text-slate-200">Textura da Bola</p>
              </div>
              <div className="rounded-lg bg-[#08121d] border border-white/10 p-2">
                <img
                  src={GENERATED_ASSETS.stadiumCrowdMap}
                  alt="Mapa panorâmico das arquibancadas"
                  referrerPolicy="no-referrer"
                  className="w-full h-28 object-cover rounded"
                />
                <p className="mt-1.5 text-xs font-medium text-slate-200">Arquibancada &amp; Torcida</p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-amber-300 mb-2">
              Spritesheet 2D do Goleiro (Quadros Extraídos)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {keeperUrls.length > 0 ? (
                keeperUrls.map((url, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg bg-[#08121d] border border-white/10 p-2 flex flex-col items-center"
                  >
                    <img
                      src={url}
                      alt={`Pose do goleiro ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-20 h-20 object-contain"
                    />
                    <span className="text-[11px] text-slate-300 mt-1">
                      {['Pronto', 'Salto', 'Ponte Dir.', 'Quadro 4', 'Ponte Esq.'][idx] ?? `Quadro ${idx + 1}`}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 col-span-full">Carregando spritesheet...</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-sky-300 mb-2">
              Spritesheet 2D da Barreira (Quadros Extraídos)
            </h3>
            <div className="grid grid-cols-3 gap-2 max-w-md">
              {defenderUrls.length > 0 ? (
                defenderUrls.map((url, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg bg-[#08121d] border border-white/10 p-2 flex flex-col items-center"
                  >
                    <img
                      src={url}
                      alt={`Pose da barreira ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-20 h-20 object-contain"
                    />
                    <span className="text-[11px] text-slate-300 mt-1">
                      {['Guarda', 'Salto', 'Vibração'][idx] ?? `Quadro ${idx + 1}`}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 col-span-full">Carregando spritesheet...</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
