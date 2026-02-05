import { useState, useEffect, useCallback } from "react";
import { useEditorStore, type PresenceEntry } from "../../stores/editorStore";

interface CursorOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function CursorOverlay({
  canvasWidth,
  canvasHeight,
  containerRef,
}: CursorOverlayProps) {
  const presences = useEditorStore((s) => s.presences);
  const localUserId = useEditorStore((s) => s.localUserId);
  const [layout, setLayout] = useState<{
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  const updateLayout = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const canvas = container.querySelector("canvas");
    if (!canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    setLayout({
      offsetX: canvasRect.left - rect.left,
      offsetY: canvasRect.top - rect.top,
      scaleX: canvasRect.width / canvasWidth,
      scaleY: canvasRect.height / canvasHeight,
    });
  }, [containerRef, canvasWidth, canvasHeight]);

  useEffect(() => {
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, [updateLayout]);

  // Re-calculate layout when presences change (cursor moved)
  useEffect(() => {
    updateLayout();
  }, [presences, updateLayout]);

  // Filter out local user's cursor and entries without cursor position
  const entries = Array.from(presences.values()).filter(
    (p) => p.cursor !== null && p.userId !== localUserId,
  );

  if (!layout) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {entries.map((entry) => (
        <CursorMarker key={entry.userId} entry={entry} layout={layout} />
      ))}
    </div>
  );
}

function CursorMarker({
  entry,
  layout,
}: {
  entry: PresenceEntry;
  layout: { offsetX: number; offsetY: number; scaleX: number; scaleY: number };
}) {
  if (!entry.cursor) return null;

  const x = layout.offsetX + entry.cursor.x * layout.scaleX;
  const y = layout.offsetY + entry.cursor.y * layout.scaleY;

  return (
    <div
      className="absolute"
      style={{ left: x, top: y, transform: "translate(-2px, -2px)" }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M3 1L17 10L10 10.5L7 17L3 1Z"
          fill={entry.color}
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <span
        className="ml-3 -mt-1 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-white"
        style={{ backgroundColor: entry.color }}
      >
        {entry.displayName}
      </span>
    </div>
  );
}
