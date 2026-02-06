import React, { useRef, useCallback, useState } from "react";
import type { InDocument, EasingType } from "../../types/document";

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
  onRecordKeyframe?: () => void;
  onUpdateKeyframeEasing?: (keyframeId: string, easing: EasingType) => void;
}

// Easing options for the context menu
const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "easeIn", label: "Ease In" },
  { value: "easeOut", label: "Ease Out" },
  { value: "easeInOut", label: "Ease In/Out" },
];

const LAYER_NAME_WIDTH = 144; // w-36 = 9rem = 144px
const ROW_HEIGHT = 24; // h-6 = 1.5rem = 24px
const PROPERTY_ROW_HEIGHT = 20; // Slightly smaller for property rows
const HEADER_HEIGHT = 20; // h-5 = 1.25rem = 20px
const MIN_PANEL_HEIGHT = 100;
const MAX_PANEL_HEIGHT = 400;

// Animatable properties configuration
const ANIMATABLE_PROPERTIES = [
  { key: "transform.x", label: "Position X", short: "X" },
  { key: "transform.y", label: "Position Y", short: "Y" },
  { key: "transform.sx", label: "Scale X", short: "SX" },
  { key: "transform.sy", label: "Scale Y", short: "SY" },
  { key: "transform.r", label: "Rotation", short: "R" },
  { key: "style.opacity", label: "Opacity", short: "O" },
] as const;

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
  onRecordKeyframe,
  onUpdateKeyframeEasing,
}: TimelinePanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(192); // Default h-48 = 12rem = 192px
  const resizingRef = useRef(false);

  // Expand/collapse state for objects
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(
    new Set(),
  );

  // Context menu state for keyframe easing
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    keyframeId: string;
    currentEasing: EasingType;
  } | null>(null);

  const toggleExpanded = useCallback((objectId: string) => {
    setExpandedObjects((prev) => {
      const next = new Set(prev);
      if (next.has(objectId)) {
        next.delete(objectId);
      } else {
        next.add(objectId);
      }
      return next;
    });
  }, []);

  // Keyframe drag state
  const [draggingKeyframe, setDraggingKeyframe] = useState<{
    keyframeId: string;
    trackId: string;
    startFrame: number;
    currentFrame: number;
    objectId: string;
    property: string;
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

  // Collect keyframe positions per object and per property
  // Map: objectId -> property -> frame -> keyframeInfo
  const timeline = doc.timelines[editingTimelineId];
  const keyframesByObjectProperty = new Map<
    string,
    Map<
      string,
      Map<number, { keyframeId: string; trackId: string; easing: EasingType }>
    >
  >();

  if (timeline) {
    for (const trackId of timeline.tracks) {
      const track = doc.tracks[trackId];
      if (!track) continue;

      if (!keyframesByObjectProperty.has(track.objectId)) {
        keyframesByObjectProperty.set(track.objectId, new Map());
      }
      const objProps = keyframesByObjectProperty.get(track.objectId)!;

      if (!objProps.has(track.property)) {
        objProps.set(track.property, new Map());
      }
      const propFrames = objProps.get(track.property)!;

      for (const kfId of track.keys) {
        const kf = doc.keyframes[kfId];
        if (kf) {
          propFrames.set(kf.frame, {
            keyframeId: kfId,
            trackId,
            easing: kf.easing || "linear",
          });
        }
      }
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

  // Handle double-click on a property row's frame cell
  const handlePropertyFrameDoubleClick = useCallback(
    (
      objectId: string,
      frame: number,
      property: string,
      e: React.MouseEvent,
    ) => {
      e.stopPropagation();
      const objProps = keyframesByObjectProperty.get(objectId);
      const existingKeyframe = objProps?.get(property)?.get(frame);

      if (existingKeyframe && onDeleteKeyframe) {
        onDeleteKeyframe(existingKeyframe.keyframeId, existingKeyframe.trackId);
      } else if (onAddKeyframe) {
        onAddKeyframe(objectId, frame, property);
      }
    },
    [keyframesByObjectProperty, onAddKeyframe, onDeleteKeyframe],
  );

  // Keyframe drag handlers
  const handleKeyframeDragStart = useCallback(
    (
      keyframeId: string,
      trackId: string,
      frame: number,
      objectId: string,
      property: string,
      e: React.MouseEvent,
    ) => {
      e.stopPropagation();
      e.preventDefault();
      setDraggingKeyframe({
        keyframeId,
        trackId,
        startFrame: frame,
        currentFrame: frame,
        objectId,
        property,
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

  // Right-click context menu for keyframe easing
  const handleKeyframeContextMenu = useCallback(
    (e: React.MouseEvent, keyframeId: string, currentEasing: EasingType) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        keyframeId,
        currentEasing,
      });
    },
    [],
  );

  const handleEasingSelect = useCallback(
    (easing: EasingType) => {
      if (contextMenu && onUpdateKeyframeEasing) {
        onUpdateKeyframeEasing(contextMenu.keyframeId, easing);
      }
      setContextMenu(null);
    },
    [contextMenu, onUpdateKeyframeEasing],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

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

  // Helper to check if any property has a keyframe at a given frame
  const hasAnyKeyframeAtFrame = (objectId: string, frame: number): boolean => {
    const objProps = keyframesByObjectProperty.get(objectId);
    if (!objProps) return false;
    return ANIMATABLE_PROPERTIES.some((p) => objProps.get(p.key)?.has(frame));
  };

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

        {/* Record keyframe button */}
        <button
          onClick={onRecordKeyframe}
          disabled={!selectedObjectId}
          className={`flex h-6 items-center gap-1 px-2 rounded text-xs ${
            selectedObjectId
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
          title="Record keyframe at current frame (K)"
        >
          <span className="text-[10px]">●</span>
          <span>Key</span>
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
              const isExpanded = expandedObjects.has(obj.id);
              const objProps = keyframesByObjectProperty.get(obj.id);
              const isSelected = obj.id === selectedObjectId;

              return (
                <React.Fragment key={obj.id}>
                  {/* Object row (parent) */}
                  <div className="flex" style={{ height: ROW_HEIGHT }}>
                    {/* Layer name - sticky left */}
                    <div
                      onClick={() => onSelectObject(isSelected ? null : obj.id)}
                      onDoubleClick={() => handleLayerDoubleClick(obj.id)}
                      className={`sticky left-0 z-10 flex flex-shrink-0 cursor-pointer items-center border-b border-r border-gray-800/50 bg-gray-900 px-1 text-xs ${
                        isSelected
                          ? "bg-blue-900/30 text-blue-300"
                          : "text-gray-400 hover:bg-gray-800/50"
                      }`}
                      style={{ width: LAYER_NAME_WIDTH }}
                    >
                      {/* Expand/collapse toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(obj.id);
                        }}
                        className="mr-1 w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-300"
                      >
                        <span className="text-[8px]">
                          {isExpanded ? "\u25BC" : "\u25B6"}
                        </span>
                      </button>
                      <span className="mr-1 text-gray-600">
                        {typeIcon(obj.type)}
                      </span>
                      <span className="truncate">{obj.type}</span>
                      {obj.type === "Symbol" && (
                        <span className="ml-auto text-[9px] text-gray-600">
                          &#9654;
                        </span>
                      )}
                    </div>

                    {/* Frame cells - show aggregate keyframes */}
                    <div
                      className={`flex border-b border-gray-800/30 ${
                        isSelected ? "bg-blue-900/10" : ""
                      }`}
                    >
                      {Array.from({ length: visibleFrames }, (_, frame) => {
                        const hasKeyframe = hasAnyKeyframeAtFrame(
                          obj.id,
                          frame,
                        );

                        return (
                          <div
                            key={frame}
                            className={`relative flex-shrink-0 border-r border-gray-800/20 cursor-pointer hover:bg-gray-700/30 ${
                              frame === 0 ? "bg-gray-700/30" : ""
                            }`}
                            style={{ width: frameWidth, height: ROW_HEIGHT }}
                            onClick={() => onFrameChange(frame)}
                          >
                            {hasKeyframe && (
                              <span className="absolute inset-0 flex items-center justify-center text-[8px] leading-none text-yellow-400">
                                &#9670;
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Property sub-rows (when expanded) */}
                  {isExpanded &&
                    ANIMATABLE_PROPERTIES.map((prop) => {
                      const propKeyframes = objProps?.get(prop.key);
                      const hasKeyframes =
                        propKeyframes && propKeyframes.size > 0;

                      // Show properties that have keyframes, OR all properties for selected object
                      if (!hasKeyframes && !isSelected) return null;

                      return (
                        <div
                          key={prop.key}
                          className="flex"
                          style={{ height: PROPERTY_ROW_HEIGHT }}
                        >
                          {/* Property label (indented) - sticky left */}
                          <div
                            className={`sticky left-0 z-10 flex flex-shrink-0 items-center border-b border-r border-gray-800/30 bg-gray-900 pl-6 pr-2 text-[10px] ${
                              hasKeyframes ? "text-gray-400" : "text-gray-600"
                            }`}
                            style={{ width: LAYER_NAME_WIDTH }}
                          >
                            {prop.short}
                          </div>

                          {/* Frame cells for this property */}
                          <div
                            className={`flex border-b border-gray-800/20 ${
                              isSelected ? "bg-blue-900/5" : ""
                            }`}
                          >
                            {Array.from(
                              { length: visibleFrames },
                              (_, frame) => {
                                const kfData = propKeyframes?.get(frame);
                                const hasKf = !!kfData;

                                // Check if this keyframe is being dragged
                                const isDraggedHere =
                                  draggingKeyframe?.currentFrame === frame &&
                                  draggingKeyframe?.objectId === obj.id &&
                                  draggingKeyframe?.property === prop.key;
                                const isBeingDragged =
                                  draggingKeyframe &&
                                  kfData?.keyframeId ===
                                    draggingKeyframe.keyframeId;

                                return (
                                  <div
                                    key={frame}
                                    className={`relative flex-shrink-0 border-r border-gray-800/10 cursor-pointer hover:bg-gray-700/20 ${
                                      frame === 0 ? "bg-gray-700/20" : ""
                                    }`}
                                    style={{
                                      width: frameWidth,
                                      height: PROPERTY_ROW_HEIGHT,
                                    }}
                                    onClick={() => onFrameChange(frame)}
                                    onDoubleClick={(e) =>
                                      handlePropertyFrameDoubleClick(
                                        obj.id,
                                        frame,
                                        prop.key,
                                        e,
                                      )
                                    }
                                  >
                                    {((hasKf && !isBeingDragged) ||
                                      isDraggedHere) && (
                                      <span
                                        className={`absolute inset-0 flex items-center justify-center text-[7px] leading-none cursor-grab ${
                                          isDraggedHere
                                            ? "text-blue-400"
                                            : kfData?.easing !== "linear"
                                              ? "text-green-400"
                                              : "text-yellow-400"
                                        }`}
                                        title={
                                          kfData
                                            ? `Easing: ${kfData.easing}`
                                            : undefined
                                        }
                                        onMouseDown={(e) => {
                                          if (kfData && !isDraggedHere) {
                                            handleKeyframeDragStart(
                                              kfData.keyframeId,
                                              kfData.trackId,
                                              frame,
                                              obj.id,
                                              prop.key,
                                              e,
                                            );
                                          }
                                        }}
                                        onContextMenu={(e) => {
                                          if (kfData) {
                                            handleKeyframeContextMenu(
                                              e,
                                              kfData.keyframeId,
                                              kfData.easing,
                                            );
                                          }
                                        }}
                                      >
                                        &#9670;
                                      </span>
                                    )}
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </div>
                      );
                    })}
                </React.Fragment>
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

      {/* Easing context menu */}
      {contextMenu && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-50"
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeContextMenu();
            }}
          />
          {/* Menu */}
          <div
            className="fixed z-50 bg-gray-800 border border-gray-700 rounded shadow-lg py-1 min-w-[120px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wide">
              Easing
            </div>
            {EASING_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => handleEasingSelect(option.value)}
                className={`w-full text-left px-3 py-1 text-xs hover:bg-gray-700 flex items-center gap-2 ${
                  contextMenu.currentEasing === option.value
                    ? "text-green-400"
                    : "text-gray-300"
                }`}
              >
                {contextMenu.currentEasing === option.value && (
                  <span className="text-[10px]">✓</span>
                )}
                <span
                  className={
                    contextMenu.currentEasing === option.value ? "" : "ml-4"
                  }
                >
                  {option.label}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
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
