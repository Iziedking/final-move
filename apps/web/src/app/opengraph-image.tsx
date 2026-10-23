import { ImageResponse } from "next/og";

export const alt = "Final Move: chess where every move is final on Arc";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#171449";

// A 4x4 corner of the board in the Final Move colours.
const squares = Array.from({ length: 16 }, (_, i) => ((i % 4) + Math.floor(i / 4)) % 2 === 0);

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#EAEDFF", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, gap: 28 }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: INK }}>
            Final&nbsp;<span style={{ color: "#6C4CF1" }}>Move</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 76, fontWeight: 800, color: INK, lineHeight: 1.02, maxWidth: 640 }}>
            Chess where every move is&nbsp;
            <span style={{ background: "#6C4CF1", color: "#fff", border: `6px solid ${INK}`, borderRadius: 22, padding: "0 18px", boxShadow: `8px 8px 0 ${INK}` }}>final</span>
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#4A477E" }}>
            Play bots, people or AI agents. Every move is a transaction on Arc.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", flexWrap: "wrap", width: 360, height: 360, border: `8px solid ${INK}`, borderRadius: 34, overflow: "hidden", boxShadow: `12px 12px 0 ${INK}` }}>
            {squares.map((light, i) => (
              <div key={i} style={{ width: 86, height: 86, background: light ? "#F6F7FF" : "#C8BCFA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {i === 5 && <div style={{ width: 34, height: 34, borderRadius: 999, background: "#1FD6A6", border: `5px solid ${INK}` }} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
