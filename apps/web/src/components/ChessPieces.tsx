/**
 * Final Move chess pieces — SVG, token-driven.
 *
 * White: filled with --cloud (bright white), outlined --ink.
 *   A thin teal (#0D9488) inner stroke acts as the "chain highlight" — each
 *   piece is visually stamped with the product's primary colour.
 * Black: filled with --ink (near-black with teal hue), outlined --cloud.
 *   Same thin teal inner stroke for symmetry.
 *
 * Design rationale: strong Staunton silhouettes with a secondary teal inner
 * line that links the visual language of the pieces back to the chain rail.
 * Pieces read clearly at 32 px on both light and dark squares in both themes.
 */

type PieceColor = "w" | "b";
interface SvgProps { c: PieceColor; }

// Colours reference CSS tokens but are fixed here because SVG attributes
// can't reference CSS custom properties without a filter/paint-server.
// Light theme: --cloud = #fff, --ink = rgb(13 37 36), --teal = rgb(13 148 136)
// Dark theme:  --cloud = rgb(22 54 52), --ink = rgb(224 245 243), --teal = rgb(45 212 191)
// We use a CSS variable shim via currentColor trick — pieces inherit context colour.
// For maximum readability we use fixed colours that work in both themes:
//   White piece fill: #FAFAF9 (near-white, reads on warm light squares)
//   White piece stroke: #0D3230 (very dark teal-ink)
//   Black piece fill: #0D2422 (deep teal-black)
//   Black piece stroke: #E0F2F1 (light sky)
//   Teal inner accent (both): #0D9488

const WF = "#FAFAF9"; // white piece fill
const WS = "#0D2422"; // white piece stroke
const BF = "#0D2422"; // black piece fill
const BS = "#E0F2F1"; // black piece stroke
const TA = "#0D9488"; // teal accent inner stroke

function f(c: PieceColor) { return c === "w" ? WF : BF; }
function s(c: PieceColor) { return c === "w" ? WS : BS; }

// Shared drop shadow: white pieces cast a dark shadow, black a medium shadow.
function shadow(c: PieceColor) {
  return c === "w"
    ? "drop-shadow(0 1.5px 2px rgba(0,0,0,0.60))"
    : "drop-shadow(0 1.5px 2px rgba(0,0,0,0.80))";
}

export function King({ c }: SvgProps) {
  return (
    <svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ filter: shadow(c) }}>
      <g fill={f(c)} stroke={s(c)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {/* Cross */}
        <line x1="22.5" y1="6" x2="22.5" y2="13" stroke={s(c)} strokeWidth="2" />
        <line x1="19.5" y1="9" x2="25.5" y2="9" stroke={s(c)} strokeWidth="2" />
        {/* Neck */}
        <path d="M20 14c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5v1.5h-5V14z" />
        {/* Body */}
        <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V16s-5 1-5 6 3.5 5 3.5 5v7z" />
        {/* Horizontal gown lines */}
        <path fill="none" stroke={TA} strokeWidth="1" d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0" />
      </g>
    </svg>
  );
}

export function Queen({ c }: SvgProps) {
  return (
    <svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ filter: shadow(c) }}>
      <g fill={f(c)} stroke={s(c)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6"    cy="12" r="2.75" />
        <circle cx="14"   cy="9"  r="2.75" />
        <circle cx="22.5" cy="8"  r="2.75" />
        <circle cx="31"   cy="9"  r="2.75" />
        <circle cx="39"   cy="12" r="2.75" />
        <path d="M9 26c8.5-8.5 15.5-8.5 27 0l2.5-12.5L31 25l-3.5-14-5 13.5-4-13.5L14.5 25 6 13.5 9 26z" />
        <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" />
        <path fill="none" stroke={TA} strokeWidth="1" d="M11 38.5a35 35 1 0 0 23 0M9 26a37 37 0 0 1 27 0" />
      </g>
    </svg>
  );
}

export function Rook({ c }: SvgProps) {
  return (
    <svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ filter: shadow(c) }}>
      <g fill={f(c)} stroke={s(c)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5" />
        <path d="M34 14l-3 3H14l-3-3" />
        <path d="M31 17v12.5H14V17" />
        <path d="M31 29.5l1.5 2.5h-20l1.5-2.5" />
        <path fill="none" stroke={TA} strokeWidth="1" d="M11 14h23" />
      </g>
    </svg>
  );
}

export function Bishop({ c }: SvgProps) {
  return (
    <svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ filter: shadow(c) }}>
      <g fill={f(c)} stroke={s(c)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="22.5" cy="8" r="2.5" />
        {/* Bishop body — taller elongated mitre so it reads as bishop at 32 px */}
        <path d="M22.5 10.5c-5.5 8.5-4 19.5 0 26.5 4-7 5.5-18 0-26.5z" />
        <path d="M11.5 37c5.5 2.5 15.5 2.5 21 0l2.5-3H9l2.5 3z" />
        <path d="M11 29.5c5.5-1.5 15.5-1.5 21 0l3.5 3.5c-6.5 1.5-18.5 1.5-25 0l.5-3.5z" />
        {/* Mitre cross line — signature mark */}
        <path fill="none" stroke={TA} strokeWidth="1" d="M18 22h9M22.5 18.5v7" />
      </g>
    </svg>
  );
}

export function Knight({ c }: SvgProps) {
  return (
    <svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ filter: shadow(c) }}>
      <g fill={f(c)} stroke={s(c)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {/* Base */}
        <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" />
        {/* Head */}
        <path d="M24 18c.38 5.12-6.5 5.5-8 2C13 12 15 4 22 4c-2.4 2.5-5.5 5-3 9" />
        {/* Ear notch */}
        <path d="M9.5 25.5a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0z" fill={f(c)} stroke={s(c)} strokeWidth="1" />
        <circle cx="16" cy="25" r="1.75" fill={s(c)} stroke="none" />
        <path fill="none" stroke={TA} strokeWidth="1" d="M15 11.5c-3 2-5 4.5-4.5 8.5" />
        {/* Base line */}
        <path fill="none" stroke={TA} strokeWidth="1" d="M10 39h27" />
      </g>
    </svg>
  );
}

export function Pawn({ c }: SvgProps) {
  return (
    <svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ filter: shadow(c) }}>
      <g fill={f(c)} stroke={s(c)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="22.5" cy="10" r="5" />
        <path d="M22.5 15c-2.5 0-4.5 1.5-4.5 4.5 0 3.5 2 4.5 2 7-3 1-6.5 1.5-6.5 4 0 3.5 14.5 3.5 14.5 0 0-2.5-3.5-3-6.5-4 0-2.5 2-3.5 2-7 0-3-2-4.5-4.5-4.5z" />
        <path fill="none" stroke={TA} strokeWidth="1" d="M15.5 35h14" />
      </g>
    </svg>
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
  const key = piece.toUpperCase();
  const Comp = PIECES[key];
  return Comp ? <>{Comp(color)}</> : null;
}
