import type {
  InDocument,
  ObjectNode,
  ShapeRectData,
  ShapeEllipseData,
  VectorPathData,
  SymbolData,
  PathCommand,
  Transform,
} from "../types/document";
import type { RenderCommand } from "./renderList";
import { identity, multiply, fromTransform, type Matrix2D } from "./matrix";
import { evaluateTimeline, applyTransformOverrides } from "./evaluate";

export class Engine {
  private doc: InDocument | null = null;
  private globalTick = 0;
  private rootFrame = 0;

  loadDocument(doc: InDocument): void {
    this.doc = doc;
  }

  /**
   * @param globalTick - Continuously incrementing tick for Symbol internal animations
   * @param rootFrame - Optional explicit root timeline frame (for when main timeline is scrubbed/playing).
   *                    If not provided, defaults to globalTick.
   */
  evaluate(globalTick?: number, rootFrame?: number): RenderCommand[] {
    if (!this.doc) throw new Error("No document loaded");
    this.globalTick = globalTick ?? 0;
    this.rootFrame = rootFrame ?? this.globalTick;

    const commands: RenderCommand[] = [];
    const sceneId = this.doc.project.scenes[0];
    if (!sceneId) return commands;

    const scene = this.doc.scenes[sceneId];
    if (!scene) return commands;

    const rootObj = this.doc.objects[scene.root];
    if (!rootObj) return commands;

    // Evaluate root timeline at the root frame (main timeline playhead)
    const rootOverrides = evaluateTimeline(
      this.doc,
      this.doc.project.rootTimeline,
      this.rootFrame,
    );

    this.walkTree(rootObj, identity(), rootOverrides, commands);
    return commands;
  }

  getScene() {
    if (!this.doc) return null;
    const sceneId = this.doc.project.scenes[0];
    return sceneId ? this.doc.scenes[sceneId] : null;
  }

  private walkTree(
    node: ObjectNode,
    parentTransform: Matrix2D,
    overrides: Map<string, Record<string, number>>,
    out: RenderCommand[],
  ): void {
    if (!node.visible) return;

    // Apply any transform overrides from the active timeline
    const nodeOverrides = overrides.get(node.id);
    const effectiveTransform: Transform = nodeOverrides
      ? applyTransformOverrides(node.transform, nodeOverrides)
      : node.transform;

    const localMatrix = fromTransform(effectiveTransform);
    const worldMatrix = multiply(parentTransform, localMatrix);

    // Symbol: has its own timeline, evaluate it and recurse into children
    if (node.type === "Symbol") {
      const symbolData = node.data as SymbolData;
      if (symbolData.timelineId && this.doc) {
        const symbolTimeline = this.doc.timelines[symbolData.timelineId];
        if (symbolTimeline) {
          // Independent playback: symbol loops its own timeline using globalTick
          const symbolFrame = this.globalTick % symbolTimeline.length;
          const symbolOverrides = evaluateTimeline(
            this.doc,
            symbolData.timelineId,
            symbolFrame,
          );

          // If the symbol's own timeline has overrides targeting the symbol itself
          // (e.g. transform.r for rotation), apply them to the world matrix
          let effectiveWorld = worldMatrix;
          const selfOverrides = symbolOverrides.get(node.id);
          if (selfOverrides) {
            const adjustedTransform = applyTransformOverrides(
              effectiveTransform,
              selfOverrides,
            );
            const adjustedLocal = fromTransform(adjustedTransform);
            effectiveWorld = multiply(parentTransform, adjustedLocal);
          }

          for (const childId of node.children) {
            const child = this.doc.objects[childId];
            if (child)
              this.walkTree(child, effectiveWorld, symbolOverrides, out);
          }
        }
      }
      return;
    }

    // Non-container nodes: produce a render command
    if (node.type !== "Group") {
      const cmd = this.objectToRenderCommand(node, worldMatrix);
      if (cmd) out.push(cmd);
    }

    // Recurse into children (Groups and other containers)
    for (const childId of node.children) {
      const child = this.doc!.objects[childId];
      if (child) this.walkTree(child, worldMatrix, overrides, out);
    }
  }

  private objectToRenderCommand(
    node: ObjectNode,
    transform: Matrix2D,
  ): RenderCommand | null {
    switch (node.type) {
      case "ShapeRect":
        return this.rectToCommand(node, transform);
      case "ShapeEllipse":
        return this.ellipseToCommand(node, transform);
      case "VectorPath":
        return this.pathToCommand(node, transform);
      default:
        return null;
    }
  }

  private rectToCommand(node: ObjectNode, transform: Matrix2D): RenderCommand {
    const data = node.data as ShapeRectData;
    const w = data.width || 100;
    const h = data.height || 100;
    const path: PathCommand[] = [
      ["M", 0, 0],
      ["L", w, 0],
      ["L", w, h],
      ["L", 0, h],
      ["Z"],
    ];
    return {
      type: "path",
      objectId: node.id,
      transform,
      path,
      fill: node.style.fill || undefined,
      stroke: node.style.stroke || undefined,
      strokeWidth: node.style.strokeWidth,
      opacity: node.style.opacity,
    };
  }

  private ellipseToCommand(
    node: ObjectNode,
    transform: Matrix2D,
  ): RenderCommand {
    const data = node.data as ShapeEllipseData;
    const rx = data.rx || 50;
    const ry = data.ry || 50;
    const kappa = 0.5522848;
    const ox = rx * kappa;
    const oy = ry * kappa;
    const path: PathCommand[] = [
      ["M", -rx, 0],
      ["C", -rx, -oy, -ox, -ry, 0, -ry],
      ["C", ox, -ry, rx, -oy, rx, 0],
      ["C", rx, oy, ox, ry, 0, ry],
      ["C", -ox, ry, -rx, oy, -rx, 0],
      ["Z"],
    ];
    return {
      type: "path",
      objectId: node.id,
      transform,
      path,
      fill: node.style.fill || undefined,
      stroke: node.style.stroke || undefined,
      strokeWidth: node.style.strokeWidth,
      opacity: node.style.opacity,
    };
  }

  private pathToCommand(
    node: ObjectNode,
    transform: Matrix2D,
  ): RenderCommand | null {
    const data = node.data as VectorPathData;
    if (!data.commands || data.commands.length === 0) return null;
    return {
      type: "path",
      objectId: node.id,
      transform,
      path: data.commands,
      fill: node.style.fill || undefined,
      stroke: node.style.stroke || undefined,
      strokeWidth: node.style.strokeWidth,
      opacity: node.style.opacity,
    };
  }
}
