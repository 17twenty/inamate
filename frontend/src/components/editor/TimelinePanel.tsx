import React, {
  useRef,
  useCallback,
  useState,
  useEffect,
  useMemo,
} from "react";
import type { InDocument, Scene, EasingType } from "../../types/document";

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
  selectedObjectIds: string[];
  onSelectObject: (ids: string[]) => void;
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
  // Timeline length editing
  onTotalFramesChange?: (frames: number) => void;
  // Scene management
  scenes?: Scene[];
  activeSceneId?: string;
  onSwitchScene?: (id: string) => void;
  onCreateScene?: () => void;
  onDeleteScene?: (id: string) => void;
  onRenameScene?: (id: string, name: string) => void;
  // Layer management
  onToggleVisibility?: (objectId: string) => void;
  onToggleLocked?: (objectId: string) => void;
  onReorderObject?: (objectId: string, newIndex: number) => void;
  // Onion skin
  onionSkinEnabled?: boolean;
  onToggleOnionSkin?: () => void;
}

// Easing options for the context menu
const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "easeIn", label: "Ease In" },
  { value: "easeOut", label: "Ease Out" },
  { value: "easeInOut", label: "Ease In/Out" },
  { value: "cubicIn", label: "Cubic In" },
  { value: "cubicOut", label: "Cubic Out" },
  { value: "cubicInOut", label: "Cubic In/Out" },
  { value: "backIn", label: "Back In" },
  { value: "backOut", label: "Back Out" },
  { value: "backInOut", label: "Back In/Out" },
  { value: "elasticOut", label: "Elastic Out" },
  { value: "bounceOut", label: "Bounce Out" },
];

const LAYER_NAME_WIDTH = 144; // w-36 = 9rem = 144px
const ROW_HEIGHT = 24; // h-6 = 1.5rem = 24px
const PROPERTY_ROW_HEIGHT = 20; // Slightly smaller for property rows
const HEADER_HEIGHT = 20; // h-5 = 1.25rem = 20px
const MIN_PANEL_HEIGHT = 100;
const MAX_PANEL_HEIGHT = 400;
const FRAME_WIDTH = 12;

// Animatable properties configuration
const BASE_PROPERTIES = [
  { key: "transform.x", label: "Position X", short: "X" },
  { key: "transform.y", label: "Position Y", short: "Y" },
  { key: "transform.sx", label: "Scale X", short: "SX" },
  { key: "transform.sy", label: "Scale Y", short: "SY" },
  { key: "transform.r", label: "Rotation", short: "R" },
  { key: "transform.skewX", label: "Skew X", short: "KX" },
  { key: "transform.skewY", label: "Skew Y", short: "KY" },
  { key: "style.opacity", label: "Opacity", short: "O" },
  { key: "style.fill", label: "Fill", short: "F" },
  { key: "style.stroke", label: "Stroke", short: "S" },
  { key: "style.strokeWidth", label: "Stroke W", short: "SW" },
] as const;

const TEXT_PROPERTIES = [
  { key: "data.fontSize", label: "Font Size", short: "FS" },
  { key: "data.content", label: "Content", short: "Tx" },
  { key: "data.fontFamily", label: "Font", short: "Ff" },
  { key: "data.fontWeight", label: "Weight", short: "Fw" },
  { key: "data.textAlign", label: "Align", short: "Al" },
] as const;

type AnimatableProperty = { key: string; label: string; short: string };

function getAnimatableProperties(
  objectType: string,
): readonly AnimatableProperty[] {
  if (objectType === "Text") {
    return [...BASE_PROPERTIES, ...TEXT_PROPERTIES];
  }
  return BASE_PROPERTIES;
}

// CSS background for grid lines — renders the grid without DOM elements
function gridBackground(totalFrames: number): React.CSSProperties {
  return {
    width: totalFrames * FRAME_WIDTH,
    backgroundImage: `repeating-linear-gradient(to right, transparent, transparent ${FRAME_WIDTH - 1}px, rgba(255,255,255,0.04) ${FRAME_WIDTH - 1}px, rgba(255,255,255,0.04) ${FRAME_WIDTH}px)`,
    backgroundSize: `${FRAME_WIDTH}px 100%`,
  };
}

/** Convert a mouse event's clientX to a frame index within a grid row */
function clientXToFrame(e: React.MouseEvent, totalFrames: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  return Math.max(0, Math.min(totalFrames - 1, Math.floor(x / FRAME_WIDTH)));
}

export function TimelinePanel({
  document: doc,
  currentFrame,
  totalFrames,
  fps,
  isPlaying,
  onFrameChange,
  onTogglePlay,
  selectedObjectIds,
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
  onTotalFramesChange,
  scenes,
  activeSceneId,
  onSwitchScene,
  onCreateScene,
  onDeleteScene,
  onRenameScene,
  onToggleVisibility,
  onToggleLocked,
  onReorderObject,
  onionSkinEnabled,
  onToggleOnionSkin,
}: TimelinePanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(192);
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

  // Layer drag-to-reorder state
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

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
  const layerObjects = useMemo(() => {
    if (editingObjectId) {
      const obj = doc.objects[editingObjectId];
      if (!obj) return [];
      return obj.children.map((id) => doc.objects[id]).filter(Boolean);
    }
    const sceneId = activeSceneId || doc.project.scenes[0];
    const scene = sceneId ? doc.scenes[sceneId] : null;
    const rootObj = scene ? doc.objects[scene.root] : null;
    return rootObj
      ? rootObj.children.map((id) => doc.objects[id]).filter(Boolean)
      : [];
  }, [
    doc.objects,
    doc.scenes,
    doc.project.scenes,
    editingObjectId,
    activeSceneId,
  ]);

  // Collect keyframe positions per object and per property (memoized)
  const timeline = doc.timelines[editingTimelineId];
  const keyframesByObjectProperty = useMemo(() => {
    const map = new Map<
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

        if (!map.has(track.objectId)) {
          map.set(track.objectId, new Map());
        }
        const objProps = map.get(track.objectId)!;

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

    return map;
  }, [timeline, doc.tracks, doc.keyframes]);

  const gridWidth = totalFrames * FRAME_WIDTH;

  // --- Scrub / click handlers that work on the row container ---

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const frame = clientXToFrame(e, totalFrames);
      onFrameChange(frame);
    },
    [totalFrames, onFrameChange],
  );

  const handleScrubDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.buttons !== 1) return;
      // Calculate frame from the grid area (offset by layer name width)
      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left - LAYER_NAME_WIDTH;
      const frame = Math.max(
        0,
        Math.min(totalFrames - 1, Math.floor(x / FRAME_WIDTH)),
      );
      onFrameChange(frame);
    },
    [totalFrames, onFrameChange],
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

  // Handle double-click on a property row's grid area
  const handlePropertyFrameDoubleClick = useCallback(
    (objectId: string, property: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const frame = clientXToFrame(e, totalFrames);
      const objProps = keyframesByObjectProperty.get(objectId);
      const existingKeyframe = objProps?.get(property)?.get(frame);

      if (existingKeyframe && onDeleteKeyframe) {
        onDeleteKeyframe(existingKeyframe.keyframeId, existingKeyframe.trackId);
      } else if (onAddKeyframe) {
        onAddKeyframe(objectId, frame, property);
      }
    },
    [totalFrames, keyframesByObjectProperty, onAddKeyframe, onDeleteKeyframe],
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
        Math.min(totalFrames - 1, Math.floor(x / FRAME_WIDTH)),
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
  const totalTime = (totalFrames / fps).toFixed(2);

  // Duration editing state
  const [durationMode, setDurationMode] = useState<"frames" | "seconds">(
    "frames",
  );
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationInputValue, setDurationInputValue] = useState("");
  const durationInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingDuration && durationInputRef.current) {
      durationInputRef.current.select();
    }
  }, [editingDuration]);

  const startEditingDuration = useCallback(() => {
    if (!onTotalFramesChange) return;
    setDurationInputValue(
      durationMode === "frames"
        ? String(totalFrames)
        : (totalFrames / fps).toFixed(2),
    );
    setEditingDuration(true);
  }, [durationMode, totalFrames, fps, onTotalFramesChange]);

  const commitDuration = useCallback(() => {
    setEditingDuration(false);
    if (!onTotalFramesChange) return;
    const val = parseFloat(durationInputValue);
    if (isNaN(val) || val <= 0) return;
    const newFrames =
      durationMode === "frames"
        ? Math.round(Math.max(1, Math.min(9999, val)))
        : Math.round(Math.max(1, Math.min(9999, val * fps)));
    if (newFrames !== totalFrames) {
      onTotalFramesChange(newFrames);
    }
  }, [durationInputValue, durationMode, fps, totalFrames, onTotalFramesChange]);

  const cancelDuration = useCallback(() => {
    setEditingDuration(false);
  }, []);

  // Scene tab context menu state
  const [sceneContextMenu, setSceneContextMenu] = useState<{
    x: number;
    y: number;
    sceneId: string;
  } | null>(null);
  const [renamingSceneId, setRenamingSceneId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingSceneId && renameInputRef.current) {
      renameInputRef.current.select();
    }
  }, [renamingSceneId]);

  // Collect all keyframe frames for an object (for aggregate row diamonds)
  const getAggregateKeyframeFrames = useCallback(
    (objectId: string): Set<number> => {
      const frames = new Set<number>();
      const objProps = keyframesByObjectProperty.get(objectId);
      if (!objProps) return frames;
      for (const propFrames of objProps.values()) {
        for (const frame of propFrames.keys()) {
          frames.add(frame);
        }
      }
      return frames;
    },
    [keyframesByObjectProperty],
  );

  // Header frame labels — only render labels at every 5th frame
  const headerLabels = useMemo(() => {
    const labels: { frame: number; left: number }[] = [];
    for (let i = 0; i < totalFrames; i += 5) {
      labels.push({ frame: i, left: i * FRAME_WIDTH });
    }
    return labels;
  }, [totalFrames]);

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

      {/* Scene tabs + Breadcrumb + transport controls */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-3 py-1.5 flex-shrink-0">
        {/* Scene tabs */}
        {scenes && scenes.length > 0 && (
          <>
            <div className="flex items-center gap-0.5">
              {scenes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSwitchScene?.(s.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSceneContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      sceneId: s.id,
                    });
                  }}
                  className={`px-2 py-0.5 text-xs rounded-t border border-b-0 ${
                    s.id === activeSceneId
                      ? "bg-gray-800 text-gray-200 border-gray-700"
                      : "bg-gray-900 text-gray-500 border-gray-800 hover:text-gray-300"
                  }`}
                >
                  {renamingSceneId === s.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (renameValue.trim() && onRenameScene) {
                          onRenameScene(s.id, renameValue.trim());
                        }
                        setRenamingSceneId(null);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          if (renameValue.trim() && onRenameScene) {
                            onRenameScene(s.id, renameValue.trim());
                          }
                          setRenamingSceneId(null);
                        } else if (e.key === "Escape") {
                          setRenamingSceneId(null);
                        }
                      }}
                      className="w-16 bg-transparent text-xs text-gray-200 outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    s.name
                  )}
                </button>
              ))}
              {onCreateScene && (
                <button
                  onClick={onCreateScene}
                  className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-300 rounded"
                  title="Add scene"
                >
                  +
                </button>
              )}
            </div>
            <span className="text-gray-800">|</span>
          </>
        )}

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

        {/* Record keyframe button */}
        <button
          onClick={onRecordKeyframe}
          disabled={selectedObjectIds.length === 0}
          className={`flex h-6 items-center gap-1 px-2 rounded text-xs ${
            selectedObjectIds.length > 0
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
          title="Record keyframe at current frame (K)"
        >
          <span className="text-[10px]">●</span>
          <span>Key</span>
        </button>

        {/* Frame counter */}
        <span className="text-xs tabular-nums text-gray-400">
          {String(currentFrame).padStart(3, "0")}
        </span>
        <span className="text-xs text-gray-600">/</span>
        {editingDuration ? (
          <input
            ref={durationInputRef}
            type="number"
            value={durationInputValue}
            onChange={(e) => setDurationInputValue(e.target.value)}
            onBlur={commitDuration}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitDuration();
              else if (e.key === "Escape") cancelDuration();
            }}
            className="w-14 rounded border border-blue-500 bg-gray-800 px-1 py-0 text-xs tabular-nums text-gray-200 outline-none"
            min={durationMode === "frames" ? 1 : 0.1}
            max={durationMode === "frames" ? 9999 : 999}
            step={durationMode === "frames" ? 1 : 0.1}
          />
        ) : (
          <span
            className={`text-xs tabular-nums text-gray-500 ${onTotalFramesChange ? "cursor-pointer hover:text-gray-300" : ""}`}
            onDoubleClick={startEditingDuration}
            title={
              onTotalFramesChange ? "Double-click to edit duration" : undefined
            }
          >
            {totalFrames}
          </span>
        )}

        {/* Time display */}
        <span className="ml-1 text-xs text-gray-600">
          {currentTime}s / {totalTime}s
        </span>

        {/* Frames / seconds toggle */}
        {onTotalFramesChange && (
          <button
            onClick={() =>
              setDurationMode((m) => (m === "frames" ? "seconds" : "frames"))
            }
            className="ml-0.5 px-1 py-0.5 text-[10px] rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600"
            title={`Edit in ${durationMode === "frames" ? "seconds" : "frames"} mode`}
          >
            {durationMode === "frames" ? "f" : "s"}
          </button>
        )}

        {/* Onion skin toggle */}
        {onToggleOnionSkin && (
          <button
            onClick={onToggleOnionSkin}
            className={`ml-auto px-2 py-0.5 text-xs rounded ${
              onionSkinEnabled
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-500 hover:text-gray-300"
            }`}
            title={
              onionSkinEnabled ? "Disable onion skin" : "Enable onion skin"
            }
          >
            Onion
          </button>
        )}

        <span
          className={`${onToggleOnionSkin ? "" : "ml-auto"} text-xs text-gray-600`}
        >
          {fps} fps
        </span>
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
            {/* Frame number labels — only at every 5th frame, positioned absolutely */}
            <div
              className="relative border-b border-gray-800 bg-gray-900"
              style={{ ...gridBackground(totalFrames), height: HEADER_HEIGHT }}
              onClick={handleRowClick}
            >
              {headerLabels.map(({ frame, left }) => (
                <span
                  key={frame}
                  className="absolute text-[9px] leading-5 text-gray-600"
                  style={{
                    left,
                    width: FRAME_WIDTH,
                    textAlign: "center",
                  }}
                >
                  {frame}
                </span>
              ))}
            </div>
          </div>

          {/* Layer rows */}
          <div
            className="relative"
            onMouseMove={(e) => {
              if (draggingKeyframe) {
                handleKeyframeDragMove(e);
              } else if (e.buttons === 1) {
                handleScrubDrag(e);
              }
            }}
            onMouseUp={handleKeyframeDragEnd}
            onMouseLeave={handleKeyframeDragEnd}
          >
            {layerObjects.map((obj) => {
              const isExpanded = expandedObjects.has(obj.id);
              const objProps = keyframesByObjectProperty.get(obj.id);
              const isSelected = selectedObjectIds.includes(obj.id);
              const aggregateFrames = getAggregateKeyframeFrames(obj.id);

              return (
                <React.Fragment key={obj.id}>
                  {/* Drop indicator above first row */}
                  {dropTargetIndex === 0 && layerObjects.indexOf(obj) === 0 && (
                    <div
                      className="h-0.5 bg-blue-500"
                      style={{
                        marginLeft: 0,
                        width: LAYER_NAME_WIDTH + gridWidth,
                      }}
                    />
                  )}

                  {/* Object row (parent) */}
                  <div
                    className="flex"
                    style={{ height: ROW_HEIGHT }}
                    onDragOver={(e) => {
                      if (!draggingLayerId || draggingLayerId === obj.id)
                        return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const rect = e.currentTarget.getBoundingClientRect();
                      const midY = rect.top + rect.height / 2;
                      const idx = layerObjects.indexOf(obj);
                      setDropTargetIndex(e.clientY < midY ? idx : idx + 1);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (
                        draggingLayerId &&
                        dropTargetIndex !== null &&
                        onReorderObject
                      ) {
                        onReorderObject(draggingLayerId, dropTargetIndex);
                      }
                      setDraggingLayerId(null);
                      setDropTargetIndex(null);
                    }}
                  >
                    {/* Layer name - sticky left, draggable for reorder */}
                    <div
                      draggable={!!onReorderObject}
                      onDragStart={(e) => {
                        setDraggingLayerId(obj.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", obj.id);
                      }}
                      onDragEnd={() => {
                        setDraggingLayerId(null);
                        setDropTargetIndex(null);
                      }}
                      onClick={() => onSelectObject(isSelected ? [] : [obj.id])}
                      onDoubleClick={() => handleLayerDoubleClick(obj.id)}
                      className={`sticky left-0 z-10 flex flex-shrink-0 cursor-pointer items-center border-b border-r border-gray-800/50 bg-gray-900 px-1 text-xs ${
                        isSelected
                          ? "bg-blue-900/30 text-blue-300"
                          : "text-gray-400 hover:bg-gray-800/50"
                      } ${!obj.visible ? "opacity-40" : ""} ${obj.locked ? "italic" : ""}`}
                      style={{ width: LAYER_NAME_WIDTH }}
                    >
                      {/* Visibility toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleVisibility?.(obj.id);
                        }}
                        className={`mr-0.5 w-4 h-4 flex items-center justify-center hover:text-gray-300 ${obj.visible ? "text-gray-400" : "text-gray-600"}`}
                        title={obj.visible ? "Hide" : "Show"}
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="currentColor"
                        >
                          {obj.visible ? (
                            <>
                              <ellipse
                                cx="5"
                                cy="5"
                                rx="4.5"
                                ry="2.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1"
                              />
                              <circle cx="5" cy="5" r="1.5" />
                            </>
                          ) : (
                            <>
                              <ellipse
                                cx="5"
                                cy="5"
                                rx="4.5"
                                ry="2.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1"
                                opacity="0.4"
                              />
                              <line
                                x1="1"
                                y1="9"
                                x2="9"
                                y2="1"
                                stroke="currentColor"
                                strokeWidth="1"
                                opacity="0.6"
                              />
                            </>
                          )}
                        </svg>
                      </button>
                      {/* Lock toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleLocked?.(obj.id);
                        }}
                        className={`mr-0.5 w-4 h-4 flex items-center justify-center hover:text-gray-300 ${obj.locked ? "text-yellow-500" : "text-gray-600"}`}
                        title={obj.locked ? "Unlock" : "Lock"}
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="currentColor"
                        >
                          {obj.locked ? (
                            <>
                              <rect
                                x="1.5"
                                y="5"
                                width="7"
                                height="4.5"
                                rx="0.5"
                              />
                              <path
                                d="M3 5V3.5a2 2 0 0 1 4 0V5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1"
                              />
                            </>
                          ) : (
                            <>
                              <rect
                                x="1.5"
                                y="5"
                                width="7"
                                height="4.5"
                                rx="0.5"
                                opacity="0.3"
                              />
                              <path
                                d="M3 5V3.5a2 2 0 0 1 4 0"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1"
                                opacity="0.4"
                              />
                            </>
                          )}
                        </svg>
                      </button>
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

                    {/* Grid area — single div with CSS grid lines, only render keyframe diamonds */}
                    <div
                      className={`relative border-b border-gray-800/30 cursor-pointer ${
                        isSelected ? "bg-blue-900/10" : ""
                      }`}
                      style={{
                        ...gridBackground(totalFrames),
                        height: ROW_HEIGHT,
                      }}
                      onClick={handleRowClick}
                    >
                      {Array.from(aggregateFrames).map((frame) => (
                        <span
                          key={frame}
                          className="absolute text-[8px] leading-none text-yellow-400 pointer-events-none"
                          style={{
                            left: frame * FRAME_WIDTH,
                            width: FRAME_WIDTH,
                            top: 0,
                            bottom: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          &#9670;
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Property sub-rows (when expanded) */}
                  {isExpanded &&
                    getAnimatableProperties(obj.type).map((prop) => {
                      const propKeyframes = objProps?.get(prop.key);
                      const hasKeyframes =
                        propKeyframes && propKeyframes.size > 0;

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

                          {/* Grid area — only keyframe diamonds rendered as DOM elements */}
                          <div
                            className={`relative border-b border-gray-800/20 cursor-pointer ${
                              isSelected ? "bg-blue-900/5" : ""
                            }`}
                            style={{
                              ...gridBackground(totalFrames),
                              height: PROPERTY_ROW_HEIGHT,
                            }}
                            onClick={handleRowClick}
                            onDoubleClick={(e) =>
                              handlePropertyFrameDoubleClick(
                                obj.id,
                                prop.key,
                                e,
                              )
                            }
                          >
                            {propKeyframes &&
                              Array.from(propKeyframes.entries()).map(
                                ([frame, kfData]) => {
                                  const isDraggedAway =
                                    draggingKeyframe &&
                                    kfData.keyframeId ===
                                      draggingKeyframe.keyframeId &&
                                    draggingKeyframe.currentFrame !== frame;

                                  if (isDraggedAway) return null;

                                  return (
                                    <span
                                      key={kfData.keyframeId}
                                      className={`absolute cursor-grab text-[7px] leading-none ${
                                        kfData.easing !== "linear"
                                          ? "text-green-400"
                                          : "text-yellow-400"
                                      }`}
                                      title={`Easing: ${kfData.easing}`}
                                      style={{
                                        left: frame * FRAME_WIDTH,
                                        width: FRAME_WIDTH,
                                        top: 0,
                                        bottom: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                      onMouseDown={(e) =>
                                        handleKeyframeDragStart(
                                          kfData.keyframeId,
                                          kfData.trackId,
                                          frame,
                                          obj.id,
                                          prop.key,
                                          e,
                                        )
                                      }
                                      onContextMenu={(e) =>
                                        handleKeyframeContextMenu(
                                          e,
                                          kfData.keyframeId,
                                          kfData.easing,
                                        )
                                      }
                                    >
                                      &#9670;
                                    </span>
                                  );
                                },
                              )}

                            {/* Show dragged keyframe at its new position */}
                            {draggingKeyframe &&
                              draggingKeyframe.objectId === obj.id &&
                              draggingKeyframe.property === prop.key && (
                                <span
                                  className="absolute text-[7px] leading-none text-blue-400 pointer-events-none"
                                  style={{
                                    left:
                                      draggingKeyframe.currentFrame *
                                      FRAME_WIDTH,
                                    width: FRAME_WIDTH,
                                    top: 0,
                                    bottom: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  &#9670;
                                </span>
                              )}
                          </div>
                        </div>
                      );
                    })}

                  {/* Drop indicator after this row */}
                  {dropTargetIndex !== null &&
                    dropTargetIndex === layerObjects.indexOf(obj) + 1 && (
                      <div
                        className="h-0.5 bg-blue-500"
                        style={{
                          width: LAYER_NAME_WIDTH + gridWidth,
                        }}
                      />
                    )}
                </React.Fragment>
              );
            })}

            {/* Playhead */}
            <div
              className="pointer-events-none absolute z-20"
              style={{
                left:
                  LAYER_NAME_WIDTH +
                  currentFrame * FRAME_WIDTH +
                  FRAME_WIDTH / 2,
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

      {/* Scene tab context menu */}
      {sceneContextMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setSceneContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSceneContextMenu(null);
            }}
          />
          <div
            className="fixed z-50 bg-gray-800 border border-gray-700 rounded shadow-lg py-1 min-w-[120px]"
            style={{ left: sceneContextMenu.x, top: sceneContextMenu.y }}
          >
            <button
              onClick={() => {
                const scene = scenes?.find(
                  (s) => s.id === sceneContextMenu.sceneId,
                );
                if (scene) {
                  setRenameValue(scene.name);
                  setRenamingSceneId(scene.id);
                }
                setSceneContextMenu(null);
              }}
              className="w-full text-left px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              Rename
            </button>
            {scenes && scenes.length > 1 && (
              <button
                onClick={() => {
                  onDeleteScene?.(sceneContextMenu.sceneId);
                  setSceneContextMenu(null);
                }}
                className="w-full text-left px-3 py-1 text-xs text-red-400 hover:bg-gray-700"
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}

      {/* Easing context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeContextMenu();
            }}
          />
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
    case "Text":
      return "T";
    default:
      return "\u25A0";
  }
}
