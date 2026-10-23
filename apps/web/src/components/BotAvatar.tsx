/**
 * House bot character in the Zerun sticker style: a rounded head, ink outline,
 * blinking eyes and an antenna bead. Each bot wears its own candy colour so the
 * five read as different characters. Blinking stops under reduced motion.
 */
const TONES: Record<string, string> = {
  bot_1: "#1FD6A6", // Pawnderer: mint
  bot_2: "#36C5FF", // Knightfall: cyan
  bot_3: "#FFB13C", // Rookery: amber
  bot_4: "#FF6B5C", // Bishopric: coral
  bot_5: "#6C4CF1", // GrandBot: violet
};

export function BotAvatar({ className = "w-10 h-10", botId }: { className?: string; botId?: string }) {
  const tone = (botId && TONES[botId]) || "#6C4CF1";
  const ink = "#171449";
  return (
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className={className} role="img" aria-label="House bot">
      <line x1="32" y1="5" x2="32" y2="13" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="6" r="4.5" fill="#FFB13C" stroke={ink} strokeWidth="2.5" />
      <rect x="9" y="13" width="46" height="36" rx="16" fill={tone} stroke={ink} strokeWidth="3" />
      <rect x="15" y="21" width="34" height="20" rx="10" fill="#FFFFFF" stroke={ink} strokeWidth="2.5" />
      <g className="bot-eyes">
        <ellipse cx="25" cy="31" rx="3.6" ry="4.4" fill={ink} />
        <ellipse cx="39" cy="31" rx="3.6" ry="4.4" fill={ink} />
        <circle cx="26.2" cy="29.4" r="1.2" fill="#FFFFFF" />
        <circle cx="40.2" cy="29.4" r="1.2" fill="#FFFFFF" />
      </g>
      <path d="M28 37.5q4 2.6 8 0" fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
      <rect x="20" y="49" width="24" height="11" rx="5.5" fill={tone} stroke={ink} strokeWidth="3" />
    </svg>
  );
}
