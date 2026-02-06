import type { PathCommand, Asset } from "../types/document";

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
  if (existing) return existing.complete ? existing : null;

  const img = new Image();
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
  if (assets) {
    currentAssets = assets;
  }
  // Clear canvas at full resolution
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.restore();

  // Set up DPR scaling for all subsequent drawing
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Execute each command
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

  const img = getCachedImage(asset.url);
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
    if (cmd.length === 0) continue;

    const op = cmd[0];
    switch (op) {
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
    if (cmd.length === 0) continue;

    const op = cmd[0];
    switch (op) {
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
 * Transform a point using an affine transform matrix.
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
 * Render a selection outline around a command with transform handles.
 */
export function renderSelectionOutline(
  ctx: CanvasRenderingContext2D,
  cmd: DrawCommand,
): void {
  if (!cmd.transform) return;

  const isImage =
    cmd.op === "image" && cmd.imageAssetId && cmd.imageWidth && cmd.imageHeight;
  const hasPath = cmd.path && cmd.path.length > 0;
  if (!isImage && !hasPath) return;

  // Get world bounds for handles
  const worldBounds = getWorldBounds(cmd);
  if (!worldBounds) return;

  // Draw dashed outline in local space (follows rotation)
  ctx.save();
  applyTransform(ctx, cmd.transform);
  if (isImage) {
    ctx.strokeStyle = "#0066ff";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(0, 0, cmd.imageWidth!, cmd.imageHeight!);
  } else {
    const path = buildPath(cmd.path!);
    ctx.strokeStyle = "#0066ff";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke(path);
  }
  ctx.restore();

  // Draw handles in world space (axis-aligned)
  ctx.save();
  ctx.setLineDash([]);

  const handleSize = 8;
  const { minX, minY, maxX, maxY } = worldBounds;

  // Corner handles (white fill, blue stroke)
  const corners = [
    { x: minX, y: minY }, // NW
    { x: maxX, y: minY }, // NE
    { x: minX, y: maxY }, // SW
    { x: maxX, y: maxY }, // SE
  ];

  for (const corner of corners) {
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

  // Rotation handle (circle above center)
  const centerX = (minX + maxX) / 2;
  const rotateY = minY - 25;

  // Line from top center to rotation handle
  ctx.beginPath();
  ctx.moveTo(centerX, minY);
  ctx.lineTo(centerX, rotateY);
  ctx.strokeStyle = "#0066ff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Rotation circle
  ctx.beginPath();
  ctx.arc(centerX, rotateY, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#0066ff";
  ctx.stroke();

  ctx.restore();
}

/**
 * Hit test for transform handles.
 * Returns the handle type if the point is over a handle, null otherwise.
 */
export function hitTestHandle(
  x: number,
  y: number,
  cmd: DrawCommand,
): HandleType {
  if (!cmd.transform) return null;
  const isImage =
    cmd.op === "image" && cmd.imageAssetId && cmd.imageWidth && cmd.imageHeight;
  const hasPath = cmd.path && cmd.path.length > 0;
  if (!isImage && !hasPath) return null;

  const worldBounds = getWorldBounds(cmd);
  if (!worldBounds) return null;

  const handleRadius = 10; // Slightly larger than visual for easier clicking
  const { minX, minY, maxX, maxY } = worldBounds;

  // Test rotation handle first (highest priority)
  const centerX = (minX + maxX) / 2;
  const rotateY = minY - 25;
  if (Math.hypot(x - centerX, y - rotateY) < handleRadius) {
    return "rotate";
  }

  // Test corner handles
  const corners: { type: HandleType; x: number; y: number }[] = [
    { type: "scale-nw", x: minX, y: minY },
    { type: "scale-ne", x: maxX, y: minY },
    { type: "scale-sw", x: minX, y: maxY },
    { type: "scale-se", x: maxX, y: maxY },
  ];

  for (const corner of corners) {
    if (Math.hypot(x - corner.x, y - corner.y) < handleRadius) {
      return corner.type;
    }
  }

  return null;
}
