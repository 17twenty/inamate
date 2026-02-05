import type { PathCommand } from "../types/document";

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
): void {
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
        // TODO: Implement image drawing
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
 * Render a selection outline around a command.
 */
export function renderSelectionOutline(
  ctx: CanvasRenderingContext2D,
  cmd: DrawCommand,
): void {
  if (!cmd.path || cmd.path.length === 0 || !cmd.transform) return;

  ctx.save();
  applyTransform(ctx, cmd.transform);

  const path = buildPath(cmd.path);

  ctx.strokeStyle = "#0066ff";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.stroke(path);

  ctx.restore();
}
