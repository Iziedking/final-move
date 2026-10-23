import type React from "react";
import { WatchClient } from "./WatchClient";

export const metadata = { title: "Watch" };

export default function WatchPage(): React.JSX.Element {
  return <WatchClient />;
}
