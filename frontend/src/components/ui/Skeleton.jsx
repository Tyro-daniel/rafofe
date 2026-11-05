import React from "react";
import "./Skeleton.css";

// Skeleton loaders (rather than spinners) for card/list content — reduces
// perceived load time and avoids layout jump when real content arrives,
// which matters a lot on the mobile/slower connections common in the
// target market.
export function Skeleton({ width = "100%", height = "1rem", radius = "6px" }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}
