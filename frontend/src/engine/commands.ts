import type { PathCommand, Asset } from "../types/document";
import type { AnchorPoint } from "./pathUtils";
import { API_BASE } from "../api/client";

/**
 * DrawCommand represents a single drawing operation from the WASM engine.
 * The frontend executes these on a Canvas2D context.
 */
export interface DrawCommand {
  op: "path" | "image" | "save" | "restore" | "clip";
  objectId?: string;
  transform?: number[]; // [a, b, c, d, e, f] affine matrix
  path?: PathCommand[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  imageAssetId?: string;
  imageWidth?: number;
  imageHeight?: number;
}

// Module-level image cache: URL -> HTMLImageElement
const imageCache = new Map<string, HTMLImageElement>();

// Callback when any image finishes loading (so caller can trigger re-render)
let onImageLoaded: (() => void) | null = null;

export function setImageLoadedCallback(cb: (() => void) | null): void {
  onImageLoaded = cb;
}

function getCachedImage(url: string): HTMLImageElement | null {
  const existing = imageCache.get(url);
  if (existing) {
    // complete is true both on success and failure — check naturalWidth to detect broken images
    if (!existing.complete) return null;
    if (existing.naturalWidth === 0) return null; // broken/failed
    return existing;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    onImageLoaded?.();
  };
  img.src = url;
  imageCache.set(url, img);
  return null; // Will be available after load
}

// Asset lookup — set by the caller before executing commands
let currentAssets: Record<string, Asset> = {};

/**
 * Bounding box for an object.
 */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Handle types for transform operations.
 */
export type HandleType =
  | "scale-nw"
  | "scale-ne"
  | "scale-sw"
  | "scale-se"
  | "rotate"
  | null;

/**
 * Clear the canvas and draw the background.
 */
export function clearAndDrawBackground(
  ctx: CanvasRenderingContext2D,
  background: string | undefined,
  dpr: number = 1,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.restore();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Execute draw commands without clearing the canvas first.
 */
export function executeCommandsNoClear(
  ctx: CanvasRenderingContext2D,
  commands: DrawCommand[],
  dpr: number = 1,
  assets?: Record<string, Asset>,
): void {
  if (assets) {
    currentAssets = assets;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  for (const cmd of commands) {
    switch (cmd.op) {
      case "save":
        ctx.save();
        break;
      case "restore":
        ctx.restore();
        break;
      case "clip":
        if (cmd.path && cmd.transform) {
          ctx.save();
          applyTransform(ctx, cmd.transform);
          const clipPath = buildPath(cmd.path);
          ctx.clip(clipPath);
        }
        break;
      case "path":
        drawPath(ctx, cmd);
        break;
      case "image":
        drawImage(ctx, cmd);
        break;
    }
  }
}

/**
 * Execute a list of draw commands on a Canvas2D context.
 * @param ctx - The canvas rendering context
 * @param commands - Draw commands from WASM engine
 * @param background - Optional background color
 * @param dpr - Device pixel ratio for high-DPI displays (default: 1)
 */
export function executeCommands(
  ctx: CanvasRenderingContext2D,
  commands: DrawCommand[],
  background?: string,
  dpr: number = 1,
  assets?: Record<string, Asset>,
): void {
  clearAndDrawBackground(ctx, background, dpr);
  executeCommandsNoClear(ctx, commands, dpr, assets);
}

/**
 * Draw a path command.
 */
function drawPath(ctx: CanvasRenderingContext2D, cmd: DrawCommand): void {
  if (!cmd.path || cmd.path.length === 0) return;

  ctx.save();

  // Apply transform
  if (cmd.transform) {
    applyTransform(ctx, cmd.transform);
  }

  // Apply opacity
  if (cmd.opacity !== undefined) {
    ctx.globalAlpha = cmd.opacity;
  }

  // Build the path
  const path = buildPath(cmd.path);

  // Fill
  if (cmd.fill) {
    ctx.fillStyle = cmd.fill;
    ctx.fill(path);
  }

  // Stroke
  if (cmd.stroke && cmd.strokeWidth && cmd.strokeWidth > 0) {
    ctx.strokeStyle = cmd.stroke;
    ctx.lineWidth = cmd.strokeWidth;
    ctx.stroke(path);
  }

  ctx.restore();
}

/**
 * Draw an image command.
 */
function drawImage(ctx: CanvasRenderingContext2D, cmd: DrawCommand): void {
  if (!cmd.imageAssetId || !cmd.imageWidth || !cmd.imageHeight) return;

  // Look up the asset URL from the current document's assets
  const asset = currentAssets[cmd.imageAssetId];
  if (!asset) return;

  // Resolve relative asset URLs against API_BASE for cross-origin deployments
  const resolvedUrl = asset.url.startsWith("/")
    ? `${API_BASE}${asset.url}`
    : asset.url;
  const img = getCachedImage(resolvedUrl);
  if (!img) return; // Not loaded yet — will appear on next frame

  ctx.save();

  if (cmd.transform) {
    applyTransform(ctx, cmd.transform);
  }

  if (cmd.opacity !== undefined) {
    ctx.globalAlpha = cmd.opacity;
  }

  ctx.drawImage(img, 0, 0, cmd.imageWidth, cmd.imageHeight);

  ctx.restore();
}

/**
 * Apply a 2D affine transform matrix to the context.
 */
function applyTransform(
  ctx: CanvasRenderingContext2D,
  transform: number[],
): void {
  if (transform.length >= 6) {
    ctx.transform(
      transform[0],
      transform[1],
      transform[2],
      transform[3],
      transform[4],
      transform[5],
    );
  }
}

/**
 * Build a Path2D from path commands.
 */
function buildPath(commands: PathCommand[]): Path2D {
  const path = new Path2D();

  for (const cmd of commands) {
    switch (cmd[0]) {
      case "M":
        path.moveTo(cmd[1], cmd[2]);
        break;
      case "L":
        path.lineTo(cmd[1], cmd[2]);
        break;
      case "C":
        path.bezierCurveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
        break;
      case "Q":
        path.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
        break;
      case "Z":
        path.closePath();
        break;
    }
  }

  return path;
}

/**
 * Get the bounding box of a path in local coordinates.
 */
export function getBoundsFromPath(pathCommands: PathCommand[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const cmd of pathCommands) {
    switch (cmd[0]) {
      case "M":
      case "L":
        minX = Math.min(minX, cmd[1]);
        minY = Math.min(minY, cmd[2]);
        maxX = Math.max(maxX, cmd[1]);
        maxY = Math.max(maxY, cmd[2]);
        break;
      case "C":
        // For bezier, include all control points for simplicity
        minX = Math.min(minX, cmd[1], cmd[3], cmd[5]);
        minY = Math.min(minY, cmd[2], cmd[4], cmd[6]);
        maxX = Math.max(maxX, cmd[1], cmd[3], cmd[5]);
        maxY = Math.max(maxY, cmd[2], cmd[4], cmd[6]);
        break;
      case "Q":
        minX = Math.min(minX, cmd[1], cmd[3]);
        minY = Math.min(minY, cmd[2], cmd[4]);
        maxX = Math.max(maxX, cmd[1], cmd[3]);
        maxY = Math.max(maxY, cmd[2], cmd[4]);
        break;
    }
  }

  // Handle empty path
  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Transform a point using an affine transform matrix [a, b, c, d, e, f].
 * Matrix layout:  | a  c  e |
 *                 | b  d  f |
 *                 | 0  0  1 |
 */
export function transformPoint(
  x: number,
  y: number,
  transform: number[],
): { x: number; y: number } {
  const [a, b, c, d, e, f] = transform;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

/**
 * Transform a direction vector (no translation) through an affine matrix.
 * Use this for converting deltas between coordinate spaces.
 */
export function transformVector(
  dx: number,
  dy: number,
  m: number[],
): { x: number; y: number } {
  const [a, b, c, d] = m;
  return { x: a * dx + c * dy, y: b * dx + d * dy };
}

/**
 * Invert a 2D affine matrix. Returns identity if not invertible.
 * Ported from backend-go/internal/engine/matrix.go.
 */
export function invertMatrix(m: number[]): number[] {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) return [1, 0, 0, 1, 0, 0];
  const invDet = 1 / det;
  return [
    d * invDet,
    -b * invDet,
    -c * invDet,
    a * invDet,
    (c * f - d * e) * invDet,
    (b * e - a * f) * invDet,
  ];
}

/**
 * Multiply two 2D affine matrices: result = a × b.
 */
export function multiplyMatrices(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Get the bounding box of a command in world coordinates (after transform).
 */
export function getWorldBounds(cmd: DrawCommand): Bounds | null {
  if (!cmd.transform) return null;

  let localBounds: Bounds;

  if (
    cmd.op === "image" &&
    cmd.imageAssetId &&
    cmd.imageWidth &&
    cmd.imageHeight
  ) {
    localBounds = {
      minX: 0,
      minY: 0,
      maxX: cmd.imageWidth,
      maxY: cmd.imageHeight,
    };
  } else if (cmd.path && cmd.path.length > 0) {
    localBounds = getBoundsFromPath(cmd.path);
  } else {
    return null;
  }

  // Transform all 4 corners and find the axis-aligned bounding box
  const corners = [
    transformPoint(localBounds.minX, localBounds.minY, cmd.transform),
    transformPoint(localBounds.maxX, localBounds.minY, cmd.transform),
    transformPoint(localBounds.minX, localBounds.maxY, cmd.transform),
    transformPoint(localBounds.maxX, localBounds.maxY, cmd.transform),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of corners) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Get the transformed (world-space) corner positions of an object.
 * Returns corners that follow the object's rotation/scale, unlike getWorldBounds
 * which returns an axis-aligned bounding box.
 */
function getTransformedCorners(cmd: DrawCommand): {
  nw: { x: number; y: number };
  ne: { x: number; y: number };
  sw: { x: number; y: number };
  se: { x: number; y: number };
} | null {
  if (!cmd.transform) return null;

  const isImage =
    cmd.op === "image" && cmd.imageAssetId && cmd.imageWidth && cmd.imageHeight;

  let lMinX: number, lMinY: number, lMaxX: number, lMaxY: number;
  if (isImage) {
    lMinX = 0;
    lMinY = 0;
    lMaxX = cmd.imageWidth!;
    lMaxY = cmd.imageHeight!;
  } else if (cmd.path && cmd.path.length > 0) {
    const b = getBoundsFromPath(cmd.path);
    lMinX = b.minX;
    lMinY = b.minY;
    lMaxX = b.maxX;
    lMaxY = b.maxY;
  } else {
    return null;
  }

  return {
    nw: transformPoint(lMinX, lMinY, cmd.transform),
    ne: transformPoint(lMaxX, lMinY, cmd.transform),
    sw: transformPoint(lMinX, lMaxY, cmd.transform),
    se: transformPoint(lMaxX, lMaxY, cmd.transform),
  };
}

export function renderSelectionOutline(
  ctx: CanvasRenderingContext2D,
  cmd: DrawCommand,
  showHandles = true,
): void {
  if (!cmd.transform) return;

  const corners = getTransformedCorners(cmd);
  if (!corners) return;

  const { nw, ne, se, sw } = corners;

  // Draw outline in world space following object rotation
  // First pass: solid white background stroke for contrast on any background
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(nw.x, nw.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineTo(se.x, se.y);
  ctx.lineTo(sw.x, sw.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Second pass: blue dashed stroke on top
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "#0066ff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(nw.x, nw.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineTo(se.x, se.y);
  ctx.lineTo(sw.x, sw.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Draw handles at transformed corners — only for single selection
  if (showHandles) {
    ctx.save();
    ctx.setLineDash([]);
    const handleSize = 8;

    const allCorners = [nw, ne, sw, se];
    for (const corner of allCorners) {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#0066ff";
      ctx.lineWidth = 1.5;
      ctx.fillRect(
        corner.x - handleSize / 2,
        corner.y - handleSize / 2,
        handleSize,
        handleSize,
      );
      ctx.strokeRect(
        corner.x - handleSize / 2,
        corner.y - handleSize / 2,
        handleSize,
        handleSize,
      );
    }

    // Rotation handle — above top-center edge, following rotation
    const topCenterX = (nw.x + ne.x) / 2;
    const topCenterY = (nw.y + ne.y) / 2;
    // Direction perpendicular to top edge, pointing "outward" (away from center)
    const edgeDx = ne.x - nw.x;
    const edgeDy = ne.y - nw.y;
    const edgeLen = Math.hypot(edgeDx, edgeDy);
    // Perpendicular (rotated -90 degrees, pointing up/outward from top edge)
    const perpX = edgeLen > 0 ? -edgeDy / edgeLen : 0;
    const perpY = edgeLen > 0 ? edgeDx / edgeLen : -1;
    const rotateX = topCenterX + perpX * 25;
    const rotateY = topCenterY + perpY * 25;

    // Line from top center to rotation handle
    ctx.beginPath();
    ctx.moveTo(topCenterX, topCenterY);
    ctx.lineTo(rotateX, rotateY);
    ctx.strokeStyle = "#0066ff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Rotation circle
    ctx.beginPath();
    ctx.arc(rotateX, rotateY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#0066ff";
    ctx.stroke();

    ctx.restore();
  }
}

/**
 * Hit test for transform handles.
 * Returns the handle type if the point is over a handle, null otherwise.
 * Handles follow the object's transform (rotation/scale).
 */
export function hitTestHandle(
  x: number,
  y: number,
  cmd: DrawCommand,
): HandleType {
  const corners = getTransformedCorners(cmd);
  if (!corners) return null;

  const { nw, ne, sw, se } = corners;
  const handleRadius = 10;

  // Test rotation handle first (highest priority)
  const topCenterX = (nw.x + ne.x) / 2;
  const topCenterY = (nw.y + ne.y) / 2;
  const edgeDx = ne.x - nw.x;
  const edgeDy = ne.y - nw.y;
  const edgeLen = Math.hypot(edgeDx, edgeDy);
  const perpX = edgeLen > 0 ? -edgeDy / edgeLen : 0;
  const perpY = edgeLen > 0 ? edgeDx / edgeLen : -1;
  const rotateX = topCenterX + perpX * 25;
  const rotateY = topCenterY + perpY * 25;
  if (Math.hypot(x - rotateX, y - rotateY) < handleRadius) {
    return "rotate";
  }

  // Test corner handles
  const handleCorners: { type: HandleType; x: number; y: number }[] = [
    { type: "scale-nw", ...nw },
    { type: "scale-ne", ...ne },
    { type: "scale-sw", ...sw },
    { type: "scale-se", ...se },
  ];

  for (const corner of handleCorners) {
    if (Math.hypot(x - corner.x, y - corner.y) < handleRadius) {
      return corner.type;
    }
  }

  return null;
}

/**
 * Render an anchor point indicator (crosshair + dot) at the given local-space
 * anchor coordinates, transformed to world space via the command's transform.
 */
export function renderAnchorPoint(
  ctx: CanvasRenderingContext2D,
  cmd: DrawCommand,
  ax: number,
  ay: number,
): void {
  if (!cmd.transform) return;
  const world = transformPoint(ax, ay, cmd.transform);
  const size = 8;

  ctx.save();
  ctx.setLineDash([]);

  // Crosshair lines
  ctx.strokeStyle = "#ff6600";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(world.x - size, world.y);
  ctx.lineTo(world.x + size, world.y);
  ctx.moveTo(world.x, world.y - size);
  ctx.lineTo(world.x, world.y + size);
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(world.x, world.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ff6600";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

/**
 * Hit test for the anchor point indicator.
 * Returns true if (x, y) is within the hit radius of the world-space anchor.
 */
export function hitTestAnchorPoint(
  x: number,
  y: number,
  cmd: DrawCommand,
  ax: number,
  ay: number,
): boolean {
  if (!cmd.transform) return false;
  const world = transformPoint(ax, ay, cmd.transform);
  return Math.hypot(x - world.x, y - world.y) < 10;
}

/**
 * Result of a subselection hit test.
 */
export interface SubselectionHit {
  type: "anchor" | "handleIn" | "handleOut";
  index: number;
}

/**
 * Render the subselection overlay for a VectorPath.
 * Shows anchor points (diamonds for unselected, filled squares for selected)
 * and handles (lines + circles) for selected anchors.
 */
export function renderSubselectionOverlay(
  ctx: CanvasRenderingContext2D,
  cmd: DrawCommand,
  anchors: AnchorPoint[],
  selectedPointIndices: Set<number>,
): void {
  if (!cmd.transform) return;

  ctx.save();
  ctx.setLineDash([]);

  for (const anchor of anchors) {
    const worldPt = transformPoint(anchor.x, anchor.y, cmd.transform);
    const isSelected = selectedPointIndices.has(anchor.index);

    // Draw handles for selected anchors
    if (isSelected) {
      if (anchor.handleIn) {
        const worldH = transformPoint(
          anchor.handleIn.x,
          anchor.handleIn.y,
          cmd.transform,
        );
        // Handle line
        ctx.strokeStyle = "#ff6600";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(worldPt.x, worldPt.y);
        ctx.lineTo(worldH.x, worldH.y);
        ctx.stroke();
        // Handle dot
        ctx.beginPath();
        ctx.arc(worldH.x, worldH.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ff6600";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (anchor.handleOut) {
        const worldH = transformPoint(
          anchor.handleOut.x,
          anchor.handleOut.y,
          cmd.transform,
        );
        ctx.strokeStyle = "#ff6600";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(worldPt.x, worldPt.y);
        ctx.lineTo(worldH.x, worldH.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(worldH.x, worldH.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ff6600";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Draw anchor point
    const size = 5;
    if (isSelected) {
      // Filled square for selected
      ctx.fillStyle = "#0066ff";
      ctx.fillRect(worldPt.x - size / 2, worldPt.y - size / 2, size, size);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(worldPt.x - size / 2, worldPt.y - size / 2, size, size);
    } else {
      // Diamond for unselected
      ctx.save();
      ctx.translate(worldPt.x, worldPt.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.strokeStyle = "#0066ff";
      ctx.lineWidth = 1;
      ctx.strokeRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  ctx.restore();
}

/**
 * Hit test for subselection anchor points and handles.
 * Tests handles first (higher priority), then anchor points.
 * Returns the hit type and index, or null if no hit.
 */
export function hitTestSubselection(
  x: number,
  y: number,
  cmd: DrawCommand,
  anchors: AnchorPoint[],
  selectedPointIndices: Set<number>,
): SubselectionHit | null {
  if (!cmd.transform) return null;
  const hitRadius = 8;

  // Test handles first (only visible for selected anchors)
  for (const anchor of anchors) {
    if (!selectedPointIndices.has(anchor.index)) continue;

    if (anchor.handleIn) {
      const worldH = transformPoint(
        anchor.handleIn.x,
        anchor.handleIn.y,
        cmd.transform,
      );
      if (Math.hypot(x - worldH.x, y - worldH.y) < hitRadius) {
        return { type: "handleIn", index: anchor.index };
      }
    }
    if (anchor.handleOut) {
      const worldH = transformPoint(
        anchor.handleOut.x,
        anchor.handleOut.y,
        cmd.transform,
      );
      if (Math.hypot(x - worldH.x, y - worldH.y) < hitRadius) {
        return { type: "handleOut", index: anchor.index };
      }
    }
  }

  // Test anchor points
  for (const anchor of anchors) {
    const worldPt = transformPoint(anchor.x, anchor.y, cmd.transform);
    if (Math.hypot(x - worldPt.x, y - worldPt.y) < hitRadius) {
      return { type: "anchor", index: anchor.index };
    }
  }

  return null;
}
