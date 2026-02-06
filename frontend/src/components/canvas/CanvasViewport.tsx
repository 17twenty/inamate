import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type RefObject,
} from "react";
import type { Stage } from "../../engine/Stage";
import type { Tool } from "../editor/Toolbar";
import type { Bounds, HandleType } from "../../engine/commands";
import { CursorOverlay } from "./CursorOverlay";

export type DragType = "move" | HandleType;

interface CanvasViewportProps {
  stage: Stage;
  sceneWidth: number;
  sceneHeight: number;
  sceneBackground: string;
  selectedObjectId: string | null;
  activeTool: Tool;
  spaceHeld: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onMouseMove?: (x: number, y: number) => void;
  onObjectClick?: (objectId: string | null) => void;
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
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.001;

export function CanvasViewport({
  stage,
  sceneWidth,
  sceneHeight,
  sceneBackground,
  selectedObjectId,
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
}: CanvasViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Viewport state: pan offset and zoom level
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Interaction state
  const isPanningRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragTypeRef = useRef<DragType | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

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

      const { x, y } = viewportToScene(e);

      // Creation tools
      if (
        (activeTool === "rect" || activeTool === "ellipse") &&
        onCreateObject
      ) {
        onCreateObject(x, y, activeTool);
        return;
      }

      // Check for handle hits first (on selected object)
      if (selectedObjectId && onDragStart) {
        const handleType = stage.hitTestHandle(x, y);
        if (handleType) {
          isDraggingRef.current = true;
          dragTypeRef.current = handleType;
          const bounds = stage.getSelectedObjectBounds();
          onDragStart(selectedObjectId, x, y, handleType, bounds);
          return;
        }
      }

      // Hit test for objects
      const hitId = stage.hitTest(x, y);

      // If clicking the already-selected object, start move drag
      if (hitId && hitId === selectedObjectId && onDragStart) {
        isDraggingRef.current = true;
        dragTypeRef.current = "move";
        const bounds = stage.getSelectedObjectBounds();
        onDragStart(hitId, x, y, "move", bounds);
        return;
      }

      // Otherwise, select whatever was clicked (or null)
      onObjectClick?.(hitId);
    },
    [
      activeTool,
      spaceHeld,
      pan,
      viewportToScene,
      selectedObjectId,
      stage,
      onDragStart,
      onObjectClick,
      onCreateObject,
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

      // Handle object dragging
      if (isDraggingRef.current && onDragMove) {
        onDragMove(x, y);
        return;
      }

      // Regular mouse move (cursor tracking)
      onMouseMove?.(x, y);
    },
    [viewportToScene, onDragMove, onMouseMove],
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
    }
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragTypeRef.current = null;
      onDragEnd?.();
    }
  }, [onDragEnd]);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
    }
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragTypeRef.current = null;
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
