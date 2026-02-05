import { useRef, useEffect, useCallback } from "react";
import type { Stage } from "../../engine/Stage";
import type { Tool } from "../editor/Toolbar";
import type { HandleType, Bounds } from "../../engine/commands";

export type DragType = "move" | HandleType;

interface CanvasSurfaceProps {
  stage: Stage;
  width: number;
  height: number;
  selectedObjectId: string | null;
  activeTool: Tool;
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

export function CanvasSurface({
  stage,
  width,
  height,
  selectedObjectId,
  activeTool,
  onMouseMove,
  onObjectClick,
  onDoubleClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onCreateObject,
}: CanvasSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);

  // Attach canvas to Stage on mount, detach on unmount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    stage.attachCanvas(canvas);
    return () => {
      stage.detachCanvas();
    };
  }, [stage]);

  const toCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    [width, height],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = toCanvasCoords(e);

      if (isDraggingRef.current && onDragMove) {
        onDragMove(x, y);
        return;
      }

      onMouseMove?.(x, y);
    },
    [toCanvasCoords, onMouseMove, onDragMove],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onDoubleClick) return;
      const { x, y } = toCanvasCoords(e);
      const hitId = stage.hitTest(x, y);
      if (hitId) {
        onDoubleClick(hitId);
      }
    },
    [toCanvasCoords, stage, onDoubleClick],
  );

  // Track current drag type for cursor
  const dragTypeRef = useRef<DragType>(null);

  // Update drag type when starting drag
  const handleMouseDownWithTracking = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = toCanvasCoords(e);

      // If using a creation tool, create object instead of selecting
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
      toCanvasCoords,
      stage,
      selectedObjectId,
      activeTool,
      onObjectClick,
      onDragStart,
      onCreateObject,
    ],
  );

  const handleMouseUpWithTracking = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragTypeRef.current = null;
      onDragEnd?.();
    }
  }, [onDragEnd]);

  const handleMouseLeaveWithTracking = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragTypeRef.current = null;
      onDragEnd?.();
    }
  }, [onDragEnd]);

  // Determine cursor based on tool and drag state
  const getCursor = () => {
    if (isDraggingRef.current) {
      const dt = dragTypeRef.current;
      if (dt === "rotate") return "grabbing";
      if (dt === "scale-nw" || dt === "scale-se") return "nwse-resize";
      if (dt === "scale-ne" || dt === "scale-sw") return "nesw-resize";
      return "grabbing";
    }
    if (activeTool === "rect" || activeTool === "ellipse") return "crosshair";
    if (activeTool === "hand") return "grab";
    return "default";
  };

  // The canvas maintains the scene's exact dimensions (set by Stage.resizeCanvas)
  // and is centered in its container. No stretching - 1:1 pixel mapping.
  return (
    <canvas
      ref={canvasRef}
      className="block shadow-lg"
      style={{
        cursor: getCursor(),
        // Don't set width/height here - Stage.resizeCanvas handles it
        // This ensures crisp 1:1 rendering without distortion
      }}
      onMouseDown={handleMouseDownWithTracking}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpWithTracking}
      onMouseLeave={handleMouseLeaveWithTracking}
      onDoubleClick={handleDoubleClick}
    />
  );
}
