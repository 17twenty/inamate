import { useRef, useEffect, useCallback } from "react";
import type { Stage } from "../../engine/Stage";

interface CanvasSurfaceProps {
  stage: Stage;
  width: number;
  height: number;
  selectedObjectId: string | null;
  onMouseMove?: (x: number, y: number) => void;
  onObjectClick?: (objectId: string | null) => void;
  onDoubleClick?: (objectId: string) => void;
  onDragStart?: (objectId: string, x: number, y: number) => void;
  onDragMove?: (x: number, y: number) => void;
  onDragEnd?: () => void;
}

export function CanvasSurface({
  stage,
  width,
  height,
  selectedObjectId,
  onMouseMove,
  onObjectClick,
  onDoubleClick,
  onDragStart,
  onDragMove,
  onDragEnd,
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = toCanvasCoords(e);
      const hitId = stage.hitTest(x, y);

      // If clicking the already-selected object, start drag
      if (hitId && hitId === selectedObjectId && onDragStart) {
        isDraggingRef.current = true;
        onDragStart(hitId, x, y);
        return;
      }

      // Otherwise, select whatever was clicked (or null)
      onObjectClick?.(hitId);
    },
    [toCanvasCoords, stage, selectedObjectId, onObjectClick, onDragStart],
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

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      onDragEnd?.();
    }
  }, [onDragEnd]);

  const handleMouseLeave = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      onDragEnd?.();
    }
  }, [onDragEnd]);

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

  return (
    <canvas
      ref={canvasRef}
      className="block max-h-full max-w-full"
      style={{
        aspectRatio: `${width}/${height}`,
        cursor: isDraggingRef.current ? "grabbing" : "default",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    />
  );
}
