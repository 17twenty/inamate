import { useRef, useCallback, useState } from "react";
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
  // Keyframe editing
  onAddKeyframe?: (objectId: string, frame: number, property: string) => void;
  onDeleteKeyframe?: (keyframeId: string, trackId: string) => void;
  onMoveKeyframe?: (
    keyframeId: string,
    trackId: string,
    newFrame: number,
  ) => void;
}

const LAYER_NAME_WIDTH = 144; // w-36 = 9rem = 144px
const ROW_HEIGHT = 24; // h-6 = 1.5rem = 24px
const HEADER_HEIGHT = 20; // h-5 = 1.25rem = 20px
const MIN_PANEL_HEIGHT = 100;
const MAX_PANEL_HEIGHT = 400;

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
  onAddKeyframe,
  onDeleteKeyframe,
  onMoveKeyframe,
}: TimelinePanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(192); // Default h-48 = 12rem = 192px
  const resizingRef = useRef(false);

  // Keyframe drag state
  const [draggingKeyframe, setDraggingKeyframe] = useState<{
    keyframeId: string;
    trackId: string;
    startFrame: number;
    currentFrame: number;
  } | null>(null);

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
  const keyframesByObject = new Map<
    string,
    Map<number, { keyframeId: string; trackId: string }>
  >();
  if (timeline) {
    for (const trackId of timeline.tracks) {
      const track = doc.tracks[trackId];
      if (!track) continue;
      const framesMap =
        keyframesByObject.get(track.objectId) ||
        new Map<number, { keyframeId: string; trackId: string }>();
      for (const kfId of track.keys) {
        const kf = doc.keyframes[kfId];
        if (kf) {
          framesMap.set(kf.frame, { keyframeId: kfId, trackId });
        }
      }
      keyframesByObject.set(track.objectId, framesMap);
    }
  }

  const frameWidth = 12;
  const visibleFrames = totalFrames;
  const gridWidth = visibleFrames * frameWidth;

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

  const handleFrameCellDoubleClick = useCallback(
    (objectId: string, frame: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const objKeyframes = keyframesByObject.get(objectId);
      const existingKeyframe = objKeyframes?.get(frame);

      if (existingKeyframe && onDeleteKeyframe) {
        onDeleteKeyframe(existingKeyframe.keyframeId, existingKeyframe.trackId);
      } else if (onAddKeyframe) {
        onAddKeyframe(objectId, frame, "transform.x");
      }
    },
    [keyframesByObject, onAddKeyframe, onDeleteKeyframe],
  );

  // Keyframe drag handlers
  const handleKeyframeDragStart = useCallback(
    (
      keyframeId: string,
      trackId: string,
      frame: number,
      e: React.MouseEvent,
    ) => {
      e.stopPropagation();
      e.preventDefault();
      setDraggingKeyframe({
        keyframeId,
        trackId,
        startFrame: frame,
        currentFrame: frame,
      });
    },
    [],
  );

  const handleKeyframeDragMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!draggingKeyframe) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - LAYER_NAME_WIDTH;
      const frame = Math.max(
        0,
        Math.min(totalFrames - 1, Math.floor(x / frameWidth)),
      );

      if (frame !== draggingKeyframe.currentFrame) {
        setDraggingKeyframe({
          ...draggingKeyframe,
          currentFrame: frame,
        });
      }
    },
    [draggingKeyframe, totalFrames],
  );

  const handleKeyframeDragEnd = useCallback(() => {
    if (!draggingKeyframe) return;

    // Only dispatch move if frame actually changed
    if (
      draggingKeyframe.currentFrame !== draggingKeyframe.startFrame &&
      onMoveKeyframe
    ) {
      onMoveKeyframe(
        draggingKeyframe.keyframeId,
        draggingKeyframe.trackId,
        draggingKeyframe.currentFrame,
      );
    }

    setDraggingKeyframe(null);
  }, [draggingKeyframe, onMoveKeyframe]);

  // Resize handle drag
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      const startY = e.clientY;
      const startHeight = panelHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const deltaY = startY - moveEvent.clientY;
        const newHeight = Math.min(
          MAX_PANEL_HEIGHT,
          Math.max(MIN_PANEL_HEIGHT, startHeight + deltaY),
        );
        setPanelHeight(newHeight);
      };

      const handleMouseUp = () => {
        resizingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [panelHeight],
  );

  const currentTime = (currentFrame / fps).toFixed(2);

  return (
    <div
      className="flex flex-col border-t border-gray-800 bg-gray-900"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        className="h-1 cursor-ns-resize bg-gray-800 hover:bg-blue-600 transition-colors"
        onMouseDown={handleResizeStart}
      />

      {/* Breadcrumb + transport controls */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-3 py-1.5 flex-shrink-0">
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

      {/* Timeline body - single scrollable area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        {/* Grid container with fixed layer names column */}
        <div
          className="relative"
          style={{ minWidth: LAYER_NAME_WIDTH + gridWidth }}
        >
          {/* Header row */}
          <div
            className="sticky top-0 z-20 flex"
            style={{ height: HEADER_HEIGHT }}
          >
            {/* Empty corner for layer names column */}
            <div
              className="sticky left-0 z-30 flex-shrink-0 border-b border-r border-gray-800 bg-gray-900"
              style={{ width: LAYER_NAME_WIDTH }}
            />
            {/* Frame numbers */}
            <div className="flex border-b border-gray-800 bg-gray-900">
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
          </div>

          {/* Layer rows */}
          <div
            className="relative"
            onMouseMove={(e) => {
              if (draggingKeyframe) {
                handleKeyframeDragMove(e);
              } else {
                handleScrubDrag(e);
              }
            }}
            onMouseUp={handleKeyframeDragEnd}
            onMouseLeave={handleKeyframeDragEnd}
          >
            {layerObjects.map((obj) => {
              const objKeyframes = keyframesByObject.get(obj.id);
              return (
                <div
                  key={obj.id}
                  className="flex"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Layer name - sticky left */}
                  <div
                    onClick={() =>
                      onSelectObject(
                        obj.id === selectedObjectId ? null : obj.id,
                      )
                    }
                    onDoubleClick={() => handleLayerDoubleClick(obj.id)}
                    className={`sticky left-0 z-10 flex flex-shrink-0 cursor-pointer items-center border-b border-r border-gray-800/50 bg-gray-900 px-2 text-xs ${
                      obj.id === selectedObjectId
                        ? "bg-blue-900/30 text-blue-300"
                        : "text-gray-400 hover:bg-gray-800/50"
                    }`}
                    style={{ width: LAYER_NAME_WIDTH }}
                  >
                    <span className="mr-2 text-gray-600">
                      {typeIcon(obj.type)}
                    </span>
                    <span className="truncate">{obj.type}</span>
                    {obj.type === "Symbol" && (
                      <span className="ml-auto text-[9px] text-gray-600">
                        &#9654;
                      </span>
                    )}
                  </div>

                  {/* Frame cells */}
                  <div
                    className={`flex border-b border-gray-800/30 ${
                      obj.id === selectedObjectId ? "bg-blue-900/10" : ""
                    }`}
                  >
                    {Array.from({ length: visibleFrames }, (_, i) => {
                      const keyframeData = objKeyframes?.get(i);
                      const hasKeyframe = !!keyframeData;
                      // Show keyframe at current drag position
                      const isDraggedHere =
                        draggingKeyframe?.currentFrame === i &&
                        keyframesByObject
                          .get(obj.id)
                          ?.get(draggingKeyframe.startFrame)?.keyframeId ===
                          draggingKeyframe.keyframeId;
                      // Hide keyframe at original position during drag
                      const isBeingDragged =
                        draggingKeyframe &&
                        keyframeData?.keyframeId ===
                          draggingKeyframe.keyframeId;

                      return (
                        <div
                          key={i}
                          className={`relative flex-shrink-0 border-r border-gray-800/20 cursor-pointer hover:bg-gray-700/30 ${
                            i === 0 ? "bg-gray-700/30" : ""
                          }`}
                          style={{ width: frameWidth, height: ROW_HEIGHT }}
                          onClick={() => onFrameChange(i)}
                          onDoubleClick={(e) =>
                            handleFrameCellDoubleClick(obj.id, i, e)
                          }
                        >
                          {(hasKeyframe && !isBeingDragged) || isDraggedHere ? (
                            <span
                              className={`absolute inset-0 flex items-center justify-center text-[8px] leading-none cursor-grab ${
                                isDraggedHere
                                  ? "text-blue-400"
                                  : "text-yellow-400"
                              }`}
                              onMouseDown={(e) => {
                                if (keyframeData && !isDraggedHere) {
                                  handleKeyframeDragStart(
                                    keyframeData.keyframeId,
                                    keyframeData.trackId,
                                    i,
                                    e,
                                  );
                                }
                              }}
                            >
                              &#9670;
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Playhead - positioned over the entire grid */}
            <div
              className="pointer-events-none absolute z-20"
              style={{
                left:
                  LAYER_NAME_WIDTH + currentFrame * frameWidth + frameWidth / 2,
                top: -HEADER_HEIGHT,
                bottom: 0,
                width: 1,
              }}
            >
              <div className="h-full bg-red-500" />
              <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{ top: HEADER_HEIGHT - 5 }}
              >
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
