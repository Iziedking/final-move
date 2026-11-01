import type React from "react";

/**
 * Site-wide "Built with Arc Studio" credit.
 * Rendered in the root layout after {children}, in normal page flow.
 * It is a server component, so hover is plain CSS (no event handlers).
 */
export function BuiltWith(): React.JSX.Element {
  return (
    <p
      className="m-0 pb-4 pt-2 text-center font-sans text-[12px] font-bold"
      style={{ color: "rgb(var(--ink-3))" }}
    >
      Built with{" "}
      <a
        href="https://studio.arc.io"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
        style={{ color: "inherit" }}
      >
        Arc Studio
      </a>
    </p>
  );
}
