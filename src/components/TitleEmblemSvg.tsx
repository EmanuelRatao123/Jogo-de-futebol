export function TitleEmblemSvg() {
  return (
    <svg
      viewBox="0 0 540 156"
      className="w-full max-w-[500px] h-auto select-none"
      role="img"
      aria-label="Camisa 10: Simulador de Pênalti e Falta"
    >
      <defs>
        <filter id="emblemShadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000000" floodOpacity="0.65" />
        </filter>
      </defs>

      <g filter="url(#emblemShadow)">
        {/* Crest Shield */}
        <path
          d="M 28 20 L 76 20 L 76 76 C 76 102 52 118 52 118 C 52 118 28 102 28 76 Z"
          fill="#064e3b"
          stroke="#f59e0b"
          strokeWidth="3.5"
        />
        <path
          d="M 36 28 L 68 28 L 68 73 C 68 92 52 105 52 105 C 52 105 36 92 36 73 Z"
          fill="#0b1f2e"
          stroke="#10b981"
          strokeWidth="1.5"
        />
        <polygon
          points="52,36 56,47 67,47 58,54 61,65 52,58 43,65 46,54 37,47 48,47"
          fill="#f59e0b"
        />
        <text
          x="52"
          y="92"
          textAnchor="middle"
          fill="#f8fafc"
          fontSize="24"
          fontWeight="800"
          fontFamily="'Barlow Condensed', sans-serif"
          letterSpacing="1"
        >
          10
        </text>

        {/* Main Display Title */}
        <text
          x="98"
          y="78"
          fill="#f8fafc"
          fontSize="64"
          fontWeight="800"
          fontStyle="italic"
          fontFamily="'Barlow Condensed', sans-serif"
          letterSpacing="1.5"
          stroke="#050c14"
          strokeWidth="5"
          paintOrder="stroke fill"
        >
          CAMISA 10
        </text>

        {/* Gold Accent Rule */}
        <rect x="100" y="88" width="380" height="4" rx="2" fill="#f59e0b" />

        {/* Subtitle */}
        <text
          x="100"
          y="115"
          fill="#cbd5e1"
          fontSize="18"
          fontWeight="600"
          fontFamily="'Plus Jakarta Sans', sans-serif"
          letterSpacing="1.8"
        >
          SIMULADOR DE PÊNALTI &amp; FALTA
        </text>
      </g>
    </svg>
  );
}
