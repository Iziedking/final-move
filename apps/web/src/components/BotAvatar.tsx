/**
 * Cartoon robot avatar — pure SVG, no emoji, no external assets.
 * Scales to its container. Pass size via className.
 */
export function BotAvatar({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Bot"
    >
      {/* Antenna */}
      <line x1="32" y1="6" x2="32" y2="14" stroke="#26603a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="5" r="3" fill="#26603a" />

      {/* Head */}
      <rect x="14" y="14" width="36" height="28" rx="7" ry="7"
        fill="#e8f4ec" stroke="#26603a" strokeWidth="2" />

      {/* Eyes */}
      <rect x="19" y="22" width="10" height="8" rx="3"
        fill="#26603a" />
      <rect x="35" y="22" width="10" height="8" rx="3"
        fill="#26603a" />
      {/* Eye shine */}
      <circle cx="22" cy="24.5" r="1.5" fill="#b5dcc0" />
      <circle cx="38" cy="24.5" r="1.5" fill="#b5dcc0" />

      {/* Mouth — simple grid of dots */}
      <rect x="21" y="35" width="4" height="2.5" rx="1" fill="#26603a" opacity="0.6" />
      <rect x="27" y="35" width="4" height="2.5" rx="1" fill="#26603a" opacity="0.8" />
      <rect x="33" y="35" width="4" height="2.5" rx="1" fill="#26603a" opacity="0.6" />
      <rect x="39" y="35" width="4" height="2.5" rx="1" fill="#26603a" opacity="0.4" />

      {/* Ears */}
      <rect x="8"  y="20" width="6" height="12" rx="3"
        fill="#c4dfc9" stroke="#26603a" strokeWidth="1.5" />
      <rect x="50" y="20" width="6" height="12" rx="3"
        fill="#c4dfc9" stroke="#26603a" strokeWidth="1.5" />

      {/* Body */}
      <rect x="18" y="44" width="28" height="16" rx="5"
        fill="#d0ebda" stroke="#26603a" strokeWidth="2" />
      {/* Body grid lines */}
      <line x1="32" y1="44" x2="32" y2="60" stroke="#26603a" strokeWidth="1" opacity="0.2" />
      <line x1="18" y1="52" x2="46" y2="52" stroke="#26603a" strokeWidth="1" opacity="0.2" />
      {/* Power indicator dot */}
      <circle cx="32" cy="52" r="3" fill="#26603a" opacity="0.5" />
    </svg>
  );
}
