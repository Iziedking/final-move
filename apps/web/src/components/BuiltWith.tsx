import type React from "react";

/**
 * Site-wide "Built with Arc Studio" credit.
 * Rendered in the root layout after {children}, in normal page flow.
 */
export function BuiltWith(): React.JSX.Element {
  return (
    <p
      style={{
        textAlign: "center",
        fontFamily: "var(--font-body, Nunito, sans-serif)",
        fontSize: "12px",
        fontWeight: 700,
        color: "rgb(var(--ink-3))",
        paddingTop: "8px",
        paddingBottom: "16px",
        margin: 0,
      }}
    >
      Built with{" "}
      <a
        href="https://studio.arc.io"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "inherit",
          textDecoration: "none",
        }}
        onMouseOver={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
        onMouseOut={(e) =>  { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
      >
        Arc Studio
      </a>
    </p>
  );
}
