import { useRef, useCallback } from "react";
import type { InDocument } from "../../types/document";

export interface BreadcrumbEntry {
  id: string | null; // null = scene root
  name: string;
}

interface TimelinePanelProps {
  document: InDocument;
  currentFrame: number;
  totalFrames: number;
  fps: number;
  isPlaying: boolean;
  onFrameChange: (frame: number) => void;
  onTogglePlay: () => void;
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  // Nested editing context
  editingObjectId: string | null;
  editingTimelineId: string;
  breadcrumb: BreadcrumbEntry[];
  onEnterSymbol: (objectId: string) => void;
  onNavigateBreadcrumb: (index: number) => void;
}

export function TimelinePanel({
  document: doc,
  currentFrame,
  totalFrames,
  fps,
  isPlaying,
  onFrameChange,
  onTogglePlay,
  selectedObjectId,
  onSelectObject,
  editingObjectId,
  editingTimelineId,
  breadcrumb,
  onEnterSymbol,
  onNavigateBreadcrumb,
}: TimelinePanelProps) {
  const scrubRef = useRef<HTMLDivElement>(null);

  // Get children of the editing context (scene root or symbol)
  const layerObjects = (() => {
    if (editingObjectId) {
      const obj = doc.objects[editingObjectId];
      if (!obj) return [];
      return obj.children.map((id) => doc.objects[id]).filter(Boolean);
    }
    // Scene root
    const sceneId = doc.project.scenes[0];
    const scene = sceneId ? doc.scenes[sceneId] : null;
    const rootObj = scene ? doc.objects[scene.root] : null;
    return rootObj
      ? rootObj.children.map((id) => doc.objects[id]).filter(Boolean)
      : [];
  })();

  // Collect keyframe positions for each layer object
  const timeline = doc.timelines[editingTimelineId];
  const keyframesByObject = new Map<string, Set<number>>();
  if (timeline) {
    for (const trackId of timeline.tracks) {
      const track = doc.tracks[trackId];
      if (!track) continue;
      const frames = keyframesByObject.get(track.objectId) || new Set();
      for (const kfId of track.keys) {
        const kf = doc.keyframes[kfId];
        if (kf) frames.add(kf.frame);
      }
      keyframesByObject.set(track.objectId, frames);
    }
  }

  const frameWidth = 12;
  const visibleFrames = totalFrames;

  const handleScrub = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = Math.max(
        0,
        Math.min(totalFrames - 1, Math.floor(x / frameWidth)),
      );
      onFrameChange(frame);
    },
    [totalFrames, onFrameChange],
  );

  const handleScrubDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.buttons !== 1) return;
      handleScrub(e);
    },
    [handleScrub],
  );

  const handleLayerDoubleClick = useCallback(
    (objectId: string) => {
      const obj = doc.objects[objectId];
      if (obj && obj.type === "Symbol") {
        onEnterSymbol(objectId);
      }
    },
    [doc, onEnterSymbol],
  );

  const currentTime = (currentFrame / fps).toFixed(2);

  return (
    <div className="flex h-48 flex-col border-t border-gray-800 bg-gray-900">
      {/* Breadcrumb + transport controls */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-3 py-1.5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs">
          {breadcrumb.map((entry, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-600">&rsaquo;</span>}
              {i < breadcrumb.length - 1 ? (
                <button
                  onClick={() => onNavigateBreadcrumb(i)}
                  className="text-gray-500 hover:text-blue-400"
                >
                  {entry.name}
                </button>
              ) : (
                <span className="text-gray-300">{entry.name}</span>
              )}
            </span>
          ))}
        </div>

        <span className="text-gray-800">|</span>

        <button
          onClick={onTogglePlay}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-white"
          title={isPlaying ? "Stop" : "Play"}
        >
          {isPlaying ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="3" height="8" />
              <rect x="6" y="1" width="3" height="8" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <polygon points="2,1 9,5 2,9" />
            </svg>
          )}
        </button>

        <span className="text-xs tabular-nums text-gray-400">
          {String(currentFrame).padStart(3, "0")}
        </span>
        <span className="text-xs text-gray-600">/</span>
        <span className="text-xs tabular-nums text-gray-500">
          {totalFrames}
        </span>
        <span className="ml-2 text-xs text-gray-600">{currentTime}s</span>
        <span className="ml-auto text-xs text-gray-600">{fps} fps</span>
      </div>

      {/* Timeline body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Layer names */}
        <div className="w-36 flex-shrink-0 overflow-y-auto border-r border-gray-800">
          <div className="h-5 border-b border-gray-800" />
          {layerObjects.map((obj) => (
            <div
              key={obj.id}
              onClick={() =>
                onSelectObject(obj.id === selectedObjectId ? null : obj.id)
              }
              onDoubleClick={() => handleLayerDoubleClick(obj.id)}
              className={`flex h-6 cursor-pointer items-center border-b border-gray-800/50 px-2 text-xs ${
                obj.id === selectedObjectId
                  ? "bg-blue-900/30 text-blue-300"
                  : "text-gray-400 hover:bg-gray-800/50"
              }`}
            >
              <span className="mr-2 text-gray-600">{typeIcon(obj.type)}</span>
              <span className="truncate">{obj.type}</span>
              {obj.type === "Symbol" && (
                <span className="ml-auto text-[9px] text-gray-600">
                  &#9654;
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Frame grid */}
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          {/* Frame numbers header */}
          <div
            className="sticky top-0 z-10 flex h-5 border-b border-gray-800 bg-gray-900"
            style={{ width: visibleFrames * frameWidth }}
          >
            {Array.from({ length: visibleFrames }, (_, i) => (
              <div
                key={i}
                className="flex-shrink-0 border-r border-gray-800/30 text-center text-[9px] leading-5 text-gray-600"
                style={{ width: frameWidth }}
              >
                {i % 5 === 0 ? i : ""}
              </div>
            ))}
          </div>

          {/* Layer frame rows + scrub area */}
          <div
            ref={scrubRef}
            className="relative"
            style={{ width: visibleFrames * frameWidth }}
            onMouseDown={handleScrub}
            onMouseMove={handleScrubDrag}
          >
            {layerObjects.map((obj) => {
              const objKeyframes = keyframesByObject.get(obj.id);
              return (
                <div
                  key={obj.id}
                  className={`flex h-6 border-b border-gray-800/30 ${
                    obj.id === selectedObjectId ? "bg-blue-900/10" : ""
                  }`}
                >
                  {Array.from({ length: visibleFrames }, (_, i) => (
                    <div
                      key={i}
                      className={`relative h-full flex-shrink-0 border-r border-gray-800/20 ${
                        i === 0 ? "bg-gray-700/30" : ""
                      }`}
                      style={{ width: frameWidth }}
                    >
                      {objKeyframes?.has(i) && (
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] leading-none text-yellow-400">
                          &#9670;
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-500"
              style={{ left: currentFrame * frameWidth + frameWidth / 2 }}
            >
              <div className="absolute -top-5 left-1/2 -translate-x-1/2">
                <div className="h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-red-500" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function typeIcon(type_: string): string {
  switch (type_) {
    case "ShapeRect":
      return "\u25A1";
    case "ShapeEllipse":
      return "\u25CB";
    case "VectorPath":
      return "\u2215";
    case "Group":
      return "\u25A3";
    case "Symbol":
      return "\u29C9";
    default:
      return "\u25A0";
  }
}
