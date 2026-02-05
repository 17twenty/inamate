import type { RenderCommand } from "../../engine/renderList";
import type { PathCommand } from "../../types/document";

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d context");
    this.ctx = ctx;
  }

  render(commands: RenderCommand[], background: string): void {
    const ctx = this.ctx;
    const { width, height } = ctx.canvas;

    // Clear with background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    for (const cmd of commands) {
      ctx.save();

      // Apply 2D affine transform
      ctx.setTransform(
        cmd.transform[0],
        cmd.transform[1],
        cmd.transform[2],
        cmd.transform[3],
        cmd.transform[4],
        cmd.transform[5],
      );

      ctx.globalAlpha = cmd.opacity;

      if (cmd.type === "path" && cmd.path) {
        const path = this.buildPath(cmd.path);

        if (cmd.fill) {
          ctx.fillStyle = cmd.fill;
          ctx.fill(path);
        }
        if (cmd.stroke) {
          ctx.strokeStyle = cmd.stroke;
          ctx.lineWidth = cmd.strokeWidth ?? 1;
          ctx.stroke(path);
        }
      }

      ctx.restore();
    }
  }

  hitTest(x: number, y: number, commands: RenderCommand[]): string | null {
    const ctx = this.ctx;
    // Reverse order: topmost (last drawn) tested first
    for (let i = commands.length - 1; i >= 0; i--) {
      const cmd = commands[i];
      if (!cmd.path) continue;

      ctx.save();
      ctx.setTransform(
        cmd.transform[0],
        cmd.transform[1],
        cmd.transform[2],
        cmd.transform[3],
        cmd.transform[4],
        cmd.transform[5],
      );

      const path = this.buildPath(cmd.path);
      const hit =
        ctx.isPointInPath(path, x, y) || ctx.isPointInStroke(path, x, y);
      ctx.restore();

      if (hit) return cmd.objectId;
    }
    return null;
  }

  renderSelectionOutline(cmd: RenderCommand): void {
    const ctx = this.ctx;
    if (!cmd.path) return;

    ctx.save();
    ctx.setTransform(
      cmd.transform[0],
      cmd.transform[1],
      cmd.transform[2],
      cmd.transform[3],
      cmd.transform[4],
      cmd.transform[5],
    );

    const path = this.buildPath(cmd.path);
    ctx.strokeStyle = "#4a90d9";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.globalAlpha = 1;
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.restore();
  }

  private buildPath(commands: PathCommand[]): Path2D {
    const path = new Path2D();
    for (const seg of commands) {
      switch (seg[0]) {
        case "M":
          path.moveTo(seg[1], seg[2]);
          break;
        case "L":
          path.lineTo(seg[1], seg[2]);
          break;
        case "C":
          path.bezierCurveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]);
          break;
        case "Q":
          path.quadraticCurveTo(seg[1], seg[2], seg[3], seg[4]);
          break;
        case "Z":
          path.closePath();
          break;
      }
    }
    return path;
  }
}
