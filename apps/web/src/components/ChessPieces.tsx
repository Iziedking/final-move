/**
 * Final Move chess pieces, drawn in the sticker style (docs/design.md).
 *
 * Chunky Staunton silhouettes on a 45-unit grid, a solid ink outline and a
 * small hard offset shadow, like a vinyl sticker. White pieces are filled
 * cloud-white with ink detail lines; black pieces are filled ink with a thin
 * violet inner highlight. Colours are fixed so a position reads the same in
 * the light and dark themes.
 */
import type React from "react";

type PieceColor = "w" | "b";

const INK = "#171449";
const CLOUD = "#FFFFFF";
const GLINT = "#8B70FF";

interface Paint {
  fill: string;
  line: string;
  detail: string;
}

const PAINT: Record<PieceColor, Paint> = {
  w: { fill: CLOUD, line: INK, detail: INK },
  b: { fill: INK, line: INK, detail: GLINT },
};

function Sticker({ c, label, children }: { c: PieceColor; label: string; children: (p: Paint) => React.ReactNode }) {
  const p = PAINT[c];
  return (
    <svg
      viewBox="0 0 45 45"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      role="img"
      aria-label={`${c === "w" ? "White" : "Black"} ${label}`}
      style={{ filter: `drop-shadow(1.4px 1.8px 0 ${c === "w" ? "rgba(23,20,73,0.85)" : "rgba(23,20,73,0.35)"})` }}
    >
      <g fill={p.fill} stroke={p.line} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
        {children(p)}
      </g>
    </svg>
  );
}

/** The shared plinth: a collar band over a wide rounded base. */
function Plinth({ p, collarY = 30, collarW = 21 }: { p: Paint; collarY?: number; collarW?: number }) {
  const x = 22.5 - collarW / 2;
  return (
    <>
      <rect x={x} y={collarY} width={collarW} height="4.2" rx="2.1" />
      <rect x="9" y="34" width="27" height="5.5" rx="2.75" />
      <path fill="none" stroke={p.detail} strokeWidth="1.3" d={`M${x + 2} ${collarY + 2.1}h${collarW - 4}`} />
    </>
  );
}

export function Pawn({ c }: { c: PieceColor }) {
  return (
    <Sticker c={c} label="pawn">
      {(p) => (
        <>
          <path d="M15.5 34c0-5.5 2.5-8.5 4.5-10.2l-1.2-1.4c0-1.6 1.8-2.6 3.7-2.6s3.7 1 3.7 2.6l-1.2 1.4c2 1.7 4.5 4.7 4.5 10.2z" />
          <circle cx="22.5" cy="13" r="5.6" />
          <rect x="11" y="34" width="23" height="5.5" rx="2.75" />
          <path fill="none" stroke={p.detail} strokeWidth="1.3" d="M19.6 13.6a3 3 0 0 0 2.4 2.6" />
        </>
      )}
    </Sticker>
  );
}

export function Rook({ c }: { c: PieceColor }) {
  return (
    <Sticker c={c} label="rook">
      {(p) => (
        <>
          <rect x="13.5" y="15" width="18" height="16" rx="1.5" />
          <path d="M11 8.5h5v3.2h3.2V8.5h6.6v3.2H29V8.5h5v8.2H11z" />
          <Plinth p={p} />
          <path fill="none" stroke={p.detail} strokeWidth="1.3" d="M16 20h13M16 25.5h13" />
        </>
      )}
    </Sticker>
  );
}

export function Knight({ c }: { c: PieceColor }) {
  return (
    <Sticker c={c} label="knight">
      {(p) => (
        <>
          <path d="M15 31c-.6-4.6 1.8-7.8 5.6-10.4l-7.1 3c-2.6 1.1-5.2-1-4-3.6l3.6-6.4c1.5-3.4 4.6-5.7 8-6.4l1.4-3.7 2.6 3.6c6.4 1.8 9.6 8.3 8.9 15.7-.3 3.3-1.1 6-1.8 8.2z" />
          <Plinth p={p} />
          <circle cx="18.6" cy="13.8" r="1.5" fill={p.detail} stroke="none" />
          <circle cx="11.6" cy="20.6" r="0.95" fill={p.detail} stroke="none" />
          <path fill="none" stroke={p.detail} strokeWidth="1.3" d="M26.4 10.6c3.2 2.4 4.8 7 4.3 12.6" />
        </>
      )}
    </Sticker>
  );
}

export function Bishop({ c }: { c: PieceColor }) {
  return (
    <Sticker c={c} label="bishop">
      {(p) => (
        <>
          <path d="M22.5 8.6c-6.4 4.8-8.4 10.2-7.2 14.2.9 3.4 3.8 5.4 7.2 5.4s6.3-2 7.2-5.4c1.2-4-.8-9.4-7.2-14.2z" />
          <circle cx="22.5" cy="6.6" r="2.6" />
          <Plinth p={p} collarY={28.2} collarW={13} />
          <path fill="none" stroke={p.detail} strokeWidth="1.5" d="M25.2 13.4l-4.6 6.4" />
        </>
      )}
    </Sticker>
  );
}

export function Queen({ c }: { c: PieceColor }) {
  return (
    <Sticker c={c} label="queen">
      {(p) => (
        <>
          <path d="M10 30L8 15.6l4.6 7.8L15 12.6l4 9.6 3.5-10.6L26 22.2l4-9.6 2.4 10.8 4.6-7.8L35 30z" />
          <circle cx="8" cy="13.2" r="2.5" />
          <circle cx="15" cy="10.2" r="2.5" />
          <circle cx="22.5" cy="9" r="2.5" />
          <circle cx="30" cy="10.2" r="2.5" />
          <circle cx="37" cy="13.2" r="2.5" />
          <Plinth p={p} collarY={29.6} collarW={25} />
          <path fill="none" stroke={p.detail} strokeWidth="1.3" d="M12.4 26.4c6.8-1.8 13.4-1.8 20.2 0" />
        </>
      )}
    </Sticker>
  );
}

export function King({ c }: { c: PieceColor }) {
  return (
    <Sticker c={c} label="king">
      {(p) => (
        <>
          <path d="M21 3.4h3v3h3v3h-3v3.4h-3V9.4h-3v-3h3z" />
          <path d="M13.2 30.2c-4.4-5.2-2.8-12.8 3.4-13.2 2.6-.2 4.6 1.2 5.9 3.6 1.3-2.4 3.3-3.8 5.9-3.6 6.2.4 7.8 8 3.4 13.2z" />
          <path d="M20.2 18.4c0-2.2 1-4.6 2.3-5.6 1.3 1 2.3 3.4 2.3 5.6" />
          <Plinth p={p} />
          <path fill="none" stroke={p.detail} strokeWidth="1.3" d="M22.5 21.6v7.4" />
        </>
      )}
    </Sticker>
  );
}

const PIECES: Record<string, (c: PieceColor) => React.JSX.Element> = {
  K: (c) => <King c={c} />,
  Q: (c) => <Queen c={c} />,
  R: (c) => <Rook c={c} />,
  B: (c) => <Bishop c={c} />,
  N: (c) => <Knight c={c} />,
  P: (c) => <Pawn c={c} />,
};

export function ChessPiece({ piece }: { piece: string }): React.JSX.Element | null {
  const color: PieceColor = piece === piece.toUpperCase() ? "w" : "b";
  const Comp = PIECES[piece.toUpperCase()];
  return Comp ? Comp(color) : null;
}
