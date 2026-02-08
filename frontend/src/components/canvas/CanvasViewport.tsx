import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type RefObject,
} from "react";
import type { Stage } from "../../engine/Stage";
import type { Tool } from "../editor/Toolbar";
import type {
  Bounds,
  HandleType,
  SubselectionHit,
} from "../../engine/commands";
import type {
  PathCommand,
  ObjectNode,
  VectorPathData,
} from "../../types/document";
import type { AnchorPoint } from "../../engine/pathUtils";
import {
  pathToAnchors,
  anchorsToPath,
  isPathClosed,
} from "../../engine/pathUtils";
import { CursorOverlay } from "./CursorOverlay";

export type DragType = "move" | "shear" | "anchor" | HandleType;

// Pen tool point with optional bezier handles (absolute coordinates)
export interface PenPoint {
  x: number;
  y: number;
  handleIn?: { x: number; y: number }; // control handle arriving at this point
  handleOut?: { x: number; y: number }; // control handle leaving this point
}

interface CanvasViewportProps {
  stage: Stage;
  sceneWidth: number;
  sceneHeight: number;
  sceneBackground: string;
  selectedObjectIds: string[];
  activeTool: Tool;
  spaceHeld: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onMouseMove?: (x: number, y: number) => void;
  onObjectClick?: (objectId: string | null, shiftKey: boolean) => void;
  onDoubleClick?: (objectId: string) => void;
  onDragStart?: (
    objectId: string,
    x: number,
    y: number,
    dragType: DragType,
    bounds: Bounds | null,
  ) => void;
  onDragMove?: (x: number, y: number) => void;
  onDragEnd?: () => void;
  onCreateObject?: (x: number, y: number, tool: Tool) => void;
  // Pen tool
  onCreatePath?: (commands: PathCommand[]) => void;
  // Marquee selection
  onMarqueeSelect?: (rect: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }) => void;
  // Subselection (direct select)
  selectedObjects?: Record<string, ObjectNode>;
  onDataUpdate?: (objectId: string, data: Record<string, unknown>) => void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.001;

export function CanvasViewport({
  stage,
  sceneWidth,
  sceneHeight,
  sceneBackground,
  selectedObjectIds,
  activeTool,
  spaceHeld,
  containerRef,
  onMouseMove,
  onObjectClick,
  onDoubleClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onCreateObject,
  onCreatePath,
  onMarqueeSelect,
  selectedObjects,
  onDataUpdate,
}: CanvasViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const penOverlayRef = useRef<HTMLCanvasElement>(null);

  // Viewport state: pan offset and zoom level
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Interaction state
  const isPanningRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragTypeRef = useRef<DragType | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Pen tool state
  const [penPoints, setPenPoints] = useState<PenPoint[]>([]);
  const [penPreviewPoint, setPenPreviewPoint] = useState<PenPoint | null>(null);
  const isDrawingPath = penPoints.length > 0;

  // Marquee selection state
  const isMarqueeRef = useRef(false);
  const marqueeStartRef = useRef({ x: 0, y: 0 });
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Subselection state
  const [subselectedPoints, setSubselectedPoints] = useState<Set<number>>(
    new Set(),
  );
  const [subselectionAnchors, setSubselectionAnchors] = useState<
    AnchorPoint[] | null
  >(null);
  const subselDragRef = useRef<{
    hit: SubselectionHit;
    objectId: string;
    origAnchors: AnchorPoint[];
    closed: boolean;
  } | null>(null);

  // Bezier handle drag state
  const pendingPointRef = useRef<PenPoint | null>(null);
  const penMouseDownRef = useRef(false);
  const penDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [handleDragPos, setHandleDragPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Parse anchors when subselect tool is active and a VectorPath is selected
  useEffect(() => {
    if (
      activeTool === "subselect" &&
      selectedObjectIds.length === 1 &&
      selectedObjects
    ) {
      const obj = selectedObjects[selectedObjectIds[0]];
      if (obj && obj.type === "VectorPath") {
        const data = obj.data as VectorPathData;
        if (data.commands) {
          const anchors = pathToAnchors(data.commands);
          setSubselectionAnchors(anchors);
          stage.setSubselection(obj.id, anchors, subselectedPoints);
          return;
        }
      }
    }
    // Clear when not applicable
    setSubselectionAnchors(null);
    setSubselectedPoints(new Set());
    stage.clearSubselection();
  }, [activeTool, selectedObjectIds, selectedObjects, stage]);

  // Sync subselected points to Stage
  useEffect(() => {
    if (subselectionAnchors && selectedObjectIds.length === 1) {
      stage.setSubselection(
        selectedObjectIds[0],
        subselectionAnchors,
        subselectedPoints,
      );
    }
  }, [subselectedPoints, subselectionAnchors, selectedObjectIds, stage]);

  // Attach canvas to Stage on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    stage.attachCanvas(canvas);
    return () => {
      stage.detachCanvas();
    };
  }, [stage]);

  // Refs for wheel handler (to access current pan/zoom without re-attaching listener)
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    panRef.current = pan;
    zoomRef.current = zoom;
  }, [pan, zoom]);

  // Attach wheel listener with { passive: false } to allow preventDefault
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      // Calculate zoom
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newZoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, currentZoom * (1 + delta)),
      );
      const zoomRatio = newZoom / currentZoom;

      // Adjust pan to zoom towards mouse position
      const newPanX = mouseX - (mouseX - currentPan.x) * zoomRatio;
      const newPanY = mouseY - (mouseY - currentPan.y) * zoomRatio;

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };

    viewport.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheelNative);
    };
  }, [containerRef]);

  // Center the canvas initially when container size is known
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (hasInitializedRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      // Center the artboard in the viewport
      const initialX = (rect.width - sceneWidth) / 2;
      const initialY = (rect.height - sceneHeight) / 2;
      setPan({ x: initialX, y: initialY });
      hasInitializedRef.current = true;
    }
  }, [containerRef, sceneWidth, sceneHeight]);

  // Convert viewport (screen) coordinates to scene coordinates
  const viewportToScene = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };

      const rect = container.getBoundingClientRect();
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;

      // Transform from viewport space to scene space
      return {
        x: (viewportX - pan.x) / zoom,
        y: (viewportY - pan.y) / zoom,
      };
    },
    [containerRef, pan, zoom],
  );

  // Convert pen points to path commands (with bezier support)
  const penPointsToCommands = useCallback(
    (points: PenPoint[], closed: boolean): PathCommand[] => {
      if (points.length === 0) return [];

      const commands: PathCommand[] = [];
      commands.push(["M", points[0].x, points[0].y]);

      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];

        if (prev.handleOut || curr.handleIn) {
          // Cubic bezier: cp1 = prev.handleOut, cp2 = curr.handleIn
          const cp1x = prev.handleOut?.x ?? prev.x;
          const cp1y = prev.handleOut?.y ?? prev.y;
          const cp2x = curr.handleIn?.x ?? curr.x;
          const cp2y = curr.handleIn?.y ?? curr.y;
          commands.push(["C", cp1x, cp1y, cp2x, cp2y, curr.x, curr.y]);
        } else {
          commands.push(["L", curr.x, curr.y]);
        }
      }

      if (closed && points.length >= 3) {
        const last = points[points.length - 1];
        const first = points[0];
        if (last.handleOut || first.handleIn) {
          const cp1x = last.handleOut?.x ?? last.x;
          const cp1y = last.handleOut?.y ?? last.y;
          const cp2x = first.handleIn?.x ?? first.x;
          const cp2y = first.handleIn?.y ?? first.y;
          commands.push(["C", cp1x, cp1y, cp2x, cp2y, first.x, first.y]);
        }
        commands.push(["Z"]);
      }

      return commands;
    },
    [],
  );

  // Finish drawing the pen path
  const finishPenPath = useCallback(
    (closed: boolean) => {
      if (penPoints.length < 2) {
        // Need at least 2 points for a path
        setPenPoints([]);
        setPenPreviewPoint(null);
        return;
      }

      const commands = penPointsToCommands(penPoints, closed);
      if (onCreatePath && commands.length > 0) {
        onCreatePath(commands);
      }

      // Reset pen state
      setPenPoints([]);
      setPenPreviewPoint(null);
    },
    [penPoints, penPointsToCommands, onCreatePath],
  );

  // Cancel pen drawing
  const cancelPenPath = useCallback(() => {
    setPenPoints([]);
    setPenPreviewPoint(null);
    pendingPointRef.current = null;
    penMouseDownRef.current = false;
    penDragStartRef.current = null;
    setHandleDragPos(null);
  }, []);

  // Clear pen state when switching away from pen tool
  useEffect(() => {
    if (activeTool !== "pen" && penPoints.length > 0) {
      // Finish the path as open when switching tools
      finishPenPath(false);
    }
  }, [activeTool]); // intentionally not including finishPenPath/penPoints to avoid loops

  // Keyboard shortcuts for pen tool
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTool !== "pen" || !isDrawingPath) return;

      if (e.key === "Escape") {
        e.preventDefault();
        cancelPenPath();
      } else if (e.key === "Enter") {
        e.preventDefault();
        finishPenPath(false); // Finish as open path
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, isDrawingPath, cancelPenPath, finishPenPath]);

  // Handle mouse down - either start panning or interact with canvas
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Pan mode: hand tool or space held
      if (activeTool === "hand" || spaceHeld) {
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        e.preventDefault();
        return;
      }

      // Zoom tool: click to zoom in, alt+click to zoom out
      if (activeTool === "zoom") {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.altKey ? 1 / 1.5 : 1.5;
        const newZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, zoom * zoomFactor),
        );
        const zoomRatio = newZoom / zoom;

        const newPanX = mouseX - (mouseX - pan.x) * zoomRatio;
        const newPanY = mouseY - (mouseY - pan.y) * zoomRatio;

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
        return;
      }

      const { x, y } = viewportToScene(e);

      // Subselect tool: handle anchor/handle clicking and dragging
      if (activeTool === "subselect") {
        // If we have subselection anchors, check for point/handle hits
        if (subselectionAnchors && selectedObjectIds.length === 1) {
          const hit = stage.hitTestSubselection(x, y);
          if (hit) {
            // Select the anchor point
            if (hit.type === "anchor") {
              if (e.shiftKey) {
                // Toggle selection
                setSubselectedPoints((prev) => {
                  const next = new Set(prev);
                  if (next.has(hit.index)) {
                    next.delete(hit.index);
                  } else {
                    next.add(hit.index);
                  }
                  return next;
                });
              } else {
                setSubselectedPoints(new Set([hit.index]));
              }
            }
            // Start dragging the point/handle
            const obj = selectedObjects?.[selectedObjectIds[0]];
            if (obj && obj.type === "VectorPath") {
              const data = obj.data as VectorPathData;
              isDraggingRef.current = true;
              dragTypeRef.current = "move"; // reuse move drag tracking
              subselDragRef.current = {
                hit,
                objectId: obj.id,
                origAnchors: subselectionAnchors.map((a) => ({
                  ...a,
                  handleIn: a.handleIn ? { ...a.handleIn } : undefined,
                  handleOut: a.handleOut ? { ...a.handleOut } : undefined,
                })),
                closed: isPathClosed(data.commands),
              };
              // Store drag start for delta calculation
              panStartRef.current = {
                x: e.clientX,
                y: e.clientY,
                panX: x,
                panY: y,
              };
            }
            return;
          }
        }

        // No subselection hit — try to select an object
        const hitId = stage.hitTest(x, y);
        if (hitId) {
          onObjectClick?.(hitId, e.shiftKey);
          setSubselectedPoints(new Set());
          return;
        }

        // Clicked empty space — deselect
        onObjectClick?.(null, false);
        setSubselectedPoints(new Set());
        return;
      }

      // Shear tool: start shear drag on selected object
      if (
        activeTool === "shear" &&
        selectedObjectIds.length === 1 &&
        onDragStart
      ) {
        const hitId = stage.hitTest(x, y);
        if (hitId && selectedObjectIds.includes(hitId)) {
          isDraggingRef.current = true;
          dragTypeRef.current = "shear";
          const bounds = stage.getSelectedObjectBounds();
          onDragStart(hitId, x, y, "shear", bounds);
          return;
        }
      }

      // Creation tools (shapes)
      if (
        (activeTool === "rect" || activeTool === "ellipse") &&
        onCreateObject
      ) {
        onCreateObject(x, y, activeTool);
        return;
      }

      // Pen tool
      if (activeTool === "pen") {
        // Check if clicking near the first point to close the path
        if (penPoints.length >= 2) {
          const firstPoint = penPoints[0];
          const distance = Math.hypot(x - firstPoint.x, y - firstPoint.y);
          if (distance < 10) {
            finishPenPath(true);
            return;
          }
        }

        // Store as pending point — committed on mouseUp
        pendingPointRef.current = { x, y };
        penMouseDownRef.current = true;
        penDragStartRef.current = { x, y };
        return;
      }

      // Check for anchor point hit first (only when single object selected)
      if (selectedObjectIds.length === 1 && onDragStart) {
        if (stage.hitTestAnchorPoint(x, y)) {
          isDraggingRef.current = true;
          dragTypeRef.current = "anchor";
          const bounds = stage.getSelectedObjectBounds();
          onDragStart(selectedObjectIds[0], x, y, "anchor", bounds);
          return;
        }
      }

      // Check for handle hits (only when single object selected)
      if (selectedObjectIds.length === 1 && onDragStart) {
        const handleType = stage.hitTestHandle(x, y);
        if (handleType) {
          isDraggingRef.current = true;
          dragTypeRef.current = handleType;
          const bounds = stage.getSelectedObjectBounds();
          onDragStart(selectedObjectIds[0], x, y, handleType, bounds);
          return;
        }
      }

      // Hit test for objects
      const hitId = stage.hitTest(x, y);

      // If clicking a selected object, start move drag (multi-move)
      if (
        hitId &&
        selectedObjectIds.includes(hitId) &&
        onDragStart &&
        !e.shiftKey
      ) {
        isDraggingRef.current = true;
        dragTypeRef.current = "move";
        const bounds = stage.getSelectedObjectBounds();
        onDragStart(hitId, x, y, "move", bounds);
        return;
      }

      // If we hit an object, select it
      if (hitId) {
        onObjectClick?.(hitId, e.shiftKey);
        return;
      }

      // Clicked empty space with select tool — start marquee
      if (activeTool === "select" && onMarqueeSelect) {
        isMarqueeRef.current = true;
        marqueeStartRef.current = { x, y };
        setMarqueeRect(null);
        return;
      }

      // No hit, deselect
      onObjectClick?.(null, e.shiftKey);
    },
    [
      activeTool,
      spaceHeld,
      pan,
      viewportToScene,
      selectedObjectIds,
      stage,
      onDragStart,
      onObjectClick,
      onCreateObject,
      onMarqueeSelect,
    ],
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle panning
      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan({
          x: panStartRef.current.panX + dx,
          y: panStartRef.current.panY + dy,
        });
        return;
      }

      const { x, y } = viewportToScene(e);

      // Handle marquee dragging
      if (isMarqueeRef.current) {
        const sx = marqueeStartRef.current.x;
        const sy = marqueeStartRef.current.y;
        setMarqueeRect({
          x: Math.min(sx, x),
          y: Math.min(sy, y),
          width: Math.abs(x - sx),
          height: Math.abs(y - sy),
        });
        return;
      }

      // Handle subselection point/handle dragging
      if (isDraggingRef.current && subselDragRef.current) {
        const sd = subselDragRef.current;
        const dx = x - panStartRef.current.panX;
        const dy = y - panStartRef.current.panY;

        // Clone original anchors and apply delta
        const newAnchors = sd.origAnchors.map((a) => ({
          ...a,
          handleIn: a.handleIn ? { ...a.handleIn } : undefined,
          handleOut: a.handleOut ? { ...a.handleOut } : undefined,
        }));

        const target = newAnchors[sd.hit.index];
        if (target) {
          if (sd.hit.type === "anchor") {
            const orig = sd.origAnchors[sd.hit.index];
            target.x = orig.x + dx;
            target.y = orig.y + dy;
            // Move handles with the anchor
            if (orig.handleIn) {
              target.handleIn = {
                x: orig.handleIn.x + dx,
                y: orig.handleIn.y + dy,
              };
            }
            if (orig.handleOut) {
              target.handleOut = {
                x: orig.handleOut.x + dx,
                y: orig.handleOut.y + dy,
              };
            }
          } else if (sd.hit.type === "handleIn" && target.handleIn) {
            const orig = sd.origAnchors[sd.hit.index];
            target.handleIn = {
              x: orig.handleIn!.x + dx,
              y: orig.handleIn!.y + dy,
            };
          } else if (sd.hit.type === "handleOut" && target.handleOut) {
            const orig = sd.origAnchors[sd.hit.index];
            target.handleOut = {
              x: orig.handleOut!.x + dx,
              y: orig.handleOut!.y + dy,
            };
          }
        }

        setSubselectionAnchors(newAnchors);
        stage.setSubselection(sd.objectId, newAnchors, subselectedPoints);
        return;
      }

      // Handle object dragging
      if (isDraggingRef.current && onDragMove) {
        onDragMove(x, y);
        return;
      }

      // Pen tool: handle drag or preview
      if (activeTool === "pen") {
        if (
          penMouseDownRef.current &&
          pendingPointRef.current &&
          penDragStartRef.current
        ) {
          // Dragging to define bezier handles
          const anchor = penDragStartRef.current;
          pendingPointRef.current = {
            x: anchor.x,
            y: anchor.y,
            handleOut: { x, y },
            handleIn: { x: 2 * anchor.x - x, y: 2 * anchor.y - y },
          };
          setHandleDragPos({ x, y });
        } else if (isDrawingPath) {
          setPenPreviewPoint({ x, y });
        }
      }

      // Regular mouse move (cursor tracking)
      onMouseMove?.(x, y);
    },
    [viewportToScene, onDragMove, onMouseMove, activeTool, isDrawingPath],
  );

  // Handle mouse up
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
      }
      if (isMarqueeRef.current) {
        isMarqueeRef.current = false;
        const { x, y } = viewportToScene(e);
        const sx = marqueeStartRef.current.x;
        const sy = marqueeStartRef.current.y;
        const dist = Math.hypot(x - sx, y - sy);
        if (dist > 3 && onMarqueeSelect) {
          onMarqueeSelect({
            minX: Math.min(sx, x),
            minY: Math.min(sy, y),
            maxX: Math.max(sx, x),
            maxY: Math.max(sy, y),
          });
        } else {
          // Tiny drag = click on empty space, deselect
          onObjectClick?.(null, e.shiftKey);
        }
        setMarqueeRect(null);
        return;
      }
      if (isDraggingRef.current) {
        const wasSubselDrag = subselDragRef.current != null;

        // Commit subselection drag
        if (subselDragRef.current && subselectionAnchors) {
          const sd = subselDragRef.current;
          const newCommands = anchorsToPath(subselectionAnchors, sd.closed);
          onDataUpdate?.(sd.objectId, { commands: newCommands });
          subselDragRef.current = null;
        }

        isDraggingRef.current = false;
        dragTypeRef.current = null;
        if (!wasSubselDrag) {
          onDragEnd?.();
        }
      }

      // Pen tool: commit pending point
      if (penMouseDownRef.current && pendingPointRef.current) {
        const pending = pendingPointRef.current;
        const dragStart = penDragStartRef.current;

        // If drag distance < 3px, it's a sharp corner (no handles)
        if (dragStart) {
          const { x, y } = viewportToScene(e);
          const dist = Math.hypot(x - dragStart.x, y - dragStart.y);
          if (dist < 3) {
            // Sharp corner — strip handles
            setPenPoints((prev) => [...prev, { x: pending.x, y: pending.y }]);
          } else {
            // Smooth point — keep handles
            setPenPoints((prev) => [...prev, pending]);
          }
        } else {
          setPenPoints((prev) => [...prev, { x: pending.x, y: pending.y }]);
        }

        pendingPointRef.current = null;
        penMouseDownRef.current = false;
        penDragStartRef.current = null;
        setHandleDragPos(null);
      }
    },
    [onDragEnd, viewportToScene, onMarqueeSelect, onObjectClick],
  );

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
    }
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      setMarqueeRect(null);
    }
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragTypeRef.current = null;
      subselDragRef.current = null;
      onDragEnd?.();
    }
  }, [onDragEnd]);

  // Handle double click
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onDoubleClick) return;
      const { x, y } = viewportToScene(e);
      const hitId = stage.hitTest(x, y);
      if (hitId) {
        onDoubleClick(hitId);
      }
    },
    [viewportToScene, stage, onDoubleClick],
  );

  // Build SVG path `d` attribute from committed pen points (with bezier support)
  const buildSvgPathD = (points: PenPoint[]): string => {
    if (points.length === 0) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (prev.handleOut || curr.handleIn) {
        const cp1x = prev.handleOut?.x ?? prev.x;
        const cp1y = prev.handleOut?.y ?? prev.y;
        const cp2x = curr.handleIn?.x ?? curr.x;
        const cp2y = curr.handleIn?.y ?? curr.y;
        d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${curr.x} ${curr.y}`;
      } else {
        d += ` L ${curr.x} ${curr.y}`;
      }
    }
    return d;
  };

  // Build a preview segment from the last point to the cursor
  const buildPreviewSegmentD = (from: PenPoint, to: PenPoint): string => {
    if (from.handleOut) {
      // Last committed point has a handleOut — draw a curve to the preview point
      const cp1x = from.handleOut.x;
      const cp1y = from.handleOut.y;
      return `M ${from.x} ${from.y} C ${cp1x} ${cp1y} ${to.x} ${to.y} ${to.x} ${to.y}`;
    }
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  };

  // Determine cursor
  const getCursor = () => {
    if (isPanningRef.current) return "grabbing";
    if (isDraggingRef.current) {
      const dt = dragTypeRef.current;
      if (dt === "rotate") return "grabbing";
      if (dt === "scale-nw" || dt === "scale-se") return "nwse-resize";
      if (dt === "scale-ne" || dt === "scale-sw") return "nesw-resize";
      return "grabbing";
    }
    if (activeTool === "hand" || spaceHeld) return "grab";
    if (activeTool === "rect" || activeTool === "ellipse") return "crosshair";
    if (activeTool === "pen") return "crosshair";
    if (activeTool === "subselect") return "default";
    if (activeTool === "zoom") return "zoom-in";
    if (activeTool === "shear") return "ew-resize";
    return "default";
  };

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z * 1.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z / 1.25));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      setPan({
        x: (rect.width - sceneWidth) / 2,
        y: (rect.height - sceneHeight) / 2,
      });
    }
  }, [containerRef, sceneWidth, sceneHeight]);

  const handleFitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const padding = 40;
    const availableWidth = rect.width - padding * 2;
    const availableHeight = rect.height - padding * 2;

    const scaleX = availableWidth / sceneWidth;
    const scaleY = availableHeight / sceneHeight;
    const newZoom = Math.min(scaleX, scaleY, 1); // Don't zoom in past 100%

    setZoom(newZoom);
    setPan({
      x: (rect.width - sceneWidth * newZoom) / 2,
      y: (rect.height - sceneHeight * newZoom) / 2,
    });
  }, [containerRef, sceneWidth, sceneHeight]);

  return (
    <div
      ref={viewportRef}
      className="relative flex-1 overflow-hidden"
      style={{
        cursor: getCursor(),
        // Checkerboard pattern for area outside artboard
        backgroundColor: "#1a1a1a",
        backgroundImage: `
          linear-gradient(45deg, #222 25%, transparent 25%),
          linear-gradient(-45deg, #222 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #222 75%),
          linear-gradient(-45deg, transparent 75%, #222 75%)
        `,
        backgroundSize: "20px 20px",
        backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      {/* Artboard container with transform */}
      <div
        className="absolute shadow-2xl pointer-events-none"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          width: sceneWidth,
          height: sceneHeight,
        }}
      >
        {/* Artboard background */}
        <div
          className="absolute inset-0"
          style={{ backgroundColor: sceneBackground }}
        />

        {/* Canvas - rendered by Stage */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{
            width: sceneWidth,
            height: sceneHeight,
          }}
        />

        {/* Marquee selection overlay */}
        {marqueeRect && (
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{
              width: sceneWidth,
              height: sceneHeight,
            }}
            viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
          >
            <rect
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.width}
              height={marqueeRect.height}
              fill="rgba(0,102,255,0.1)"
              stroke="#0066ff"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          </svg>
        )}

        {/* Pen tool drawing overlay */}
        {(isDrawingPath || penMouseDownRef.current) && (
          <svg
            className="absolute inset-0"
            style={{
              width: sceneWidth,
              height: sceneHeight,
            }}
            viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
          >
            {/* Draw the committed path as bezier curves */}
            {penPoints.length >= 2 && (
              <path
                d={buildSvgPathD(penPoints)}
                fill="none"
                stroke="#0066ff"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Preview segment from last committed point to cursor */}
            {penPoints.length >= 1 && penPreviewPoint && !handleDragPos && (
              <path
                d={buildPreviewSegmentD(
                  penPoints[penPoints.length - 1],
                  penPreviewPoint,
                )}
                fill="none"
                stroke="#0066ff"
                strokeWidth={2}
                strokeDasharray="4 4"
                strokeLinecap="round"
              />
            )}

            {/* Handle arms for committed points */}
            {penPoints.map((point, i) => (
              <g key={`handles-${i}`}>
                {point.handleOut && (
                  <>
                    <line
                      x1={point.x}
                      y1={point.y}
                      x2={point.handleOut.x}
                      y2={point.handleOut.y}
                      stroke="#ff6600"
                      strokeWidth={1}
                    />
                    <circle
                      cx={point.handleOut.x}
                      cy={point.handleOut.y}
                      r={3}
                      fill="#ff6600"
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  </>
                )}
                {point.handleIn && (
                  <>
                    <line
                      x1={point.x}
                      y1={point.y}
                      x2={point.handleIn.x}
                      y2={point.handleIn.y}
                      stroke="#ff6600"
                      strokeWidth={1}
                    />
                    <circle
                      cx={point.handleIn.x}
                      cy={point.handleIn.y}
                      r={3}
                      fill="#ff6600"
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  </>
                )}
              </g>
            ))}

            {/* Active drag handle arms (pending point) */}
            {handleDragPos && pendingPointRef.current && (
              <g>
                {pendingPointRef.current.handleIn && (
                  <>
                    <line
                      x1={pendingPointRef.current.x}
                      y1={pendingPointRef.current.y}
                      x2={pendingPointRef.current.handleIn.x}
                      y2={pendingPointRef.current.handleIn.y}
                      stroke="#ff6600"
                      strokeWidth={1}
                    />
                    <circle
                      cx={pendingPointRef.current.handleIn.x}
                      cy={pendingPointRef.current.handleIn.y}
                      r={3}
                      fill="#ff6600"
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  </>
                )}
                {pendingPointRef.current.handleOut && (
                  <>
                    <line
                      x1={pendingPointRef.current.x}
                      y1={pendingPointRef.current.y}
                      x2={pendingPointRef.current.handleOut.x}
                      y2={pendingPointRef.current.handleOut.y}
                      stroke="#ff6600"
                      strokeWidth={1}
                    />
                    <circle
                      cx={pendingPointRef.current.handleOut.x}
                      cy={pendingPointRef.current.handleOut.y}
                      r={3}
                      fill="#ff6600"
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  </>
                )}
                <circle
                  cx={pendingPointRef.current.x}
                  cy={pendingPointRef.current.y}
                  r={4}
                  fill="#0066ff"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                />
              </g>
            )}

            {/* Anchor point circles for committed points */}
            {penPoints.map((point, i) => (
              <circle
                key={i}
                cx={point.x}
                cy={point.y}
                r={i === 0 && penPoints.length >= 2 ? 6 : 4}
                fill={i === 0 ? "#ff6600" : "#0066ff"}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            ))}
          </svg>
        )}
      </div>

      {/* Cursor overlay - needs to account for pan/zoom */}
      <CursorOverlay
        canvasWidth={sceneWidth}
        canvasHeight={sceneHeight}
        containerRef={containerRef}
        pan={pan}
        zoom={zoom}
      />

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded bg-gray-800/80 p-1">
        <button
          onClick={handleZoomOut}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-700 hover:text-white"
          title="Zoom Out"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <line x1="2" y1="6" x2="10" y2="6" />
          </svg>
        </button>
        <button
          onClick={handleZoomReset}
          className="px-2 py-0.5 text-xs text-gray-400 hover:text-white"
          title="Reset Zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={handleZoomIn}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-700 hover:text-white"
          title="Zoom In"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <line x1="2" y1="6" x2="10" y2="6" />
            <line x1="6" y1="2" x2="6" y2="10" />
          </svg>
        </button>
        <button
          onClick={handleFitToScreen}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-700 hover:text-white"
          title="Fit to Screen"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="2" y="2" width="8" height="8" rx="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
