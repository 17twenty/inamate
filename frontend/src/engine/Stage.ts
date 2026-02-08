import type { InDocument, Scene, Asset } from "../types/document";
import type {
  DrawCommand,
  HandleType,
  Bounds,
  SubselectionHit,
} from "./commands";
import {
  executeCommands,
  renderSelectionOutline,
  renderAnchorPoint,
  renderSubselectionOverlay,
  hitTestHandle,
  hitTestAnchorPoint as hitTestAnchorPointCmd,
  hitTestSubselection as hitTestSubselectionCmd,
  getWorldBounds,
  setImageLoadedCallback,
} from "./commands";
import type { AnchorPoint } from "./pathUtils";
import * as wasm from "./wasmBridge";

export interface StageEvents {
  onFrameChange?: (frame: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onSelectionChange?: (objectIds: string[]) => void;
}

/**
 * Stage manages the animation loop and canvas rendering.
 * It bridges the React UI to the WASM engine.
 */
export class Stage {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private wasmReady = false;

  private scene: Scene | null = null;
  private events: StageEvents = {};

  private rafId: number | null = null;
  private lastFrameTime = 0;
  private frameInterval = 1000 / 24;

  private selectedObjectIds: string[] = [];
  private lastCommands: DrawCommand[] = [];
  private needsRender = true; // Dirty flag for paused re-render

  // Queue for operations before WASM is ready
  private pendingDocument: InDocument | null = null;
  private pendingSelection: string[] | null = null;

  // Document assets for image rendering (kept separate from WASM doc)
  private assets: Record<string, Asset> = {};

  // Document objects reference for anchor point lookups
  private docObjects: Record<string, import("../types/document").ObjectNode> =
    {};

  // Device pixel ratio for high-DPI displays
  private dpr = 1;

  // Subselection state (managed externally by CanvasViewport)
  private subselectionAnchors: AnchorPoint[] | null = null;
  private subselectedPoints: Set<number> = new Set();
  private subselectionObjectId: string | null = null;

  constructor() {}

  /**
   * Attach the stage to a canvas element.
   */
  async attachCanvas(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    // Initialize WASM if not already done
    if (!this.wasmReady) {
      await wasm.initWasm();
      this.wasmReady = true;

      // Process any pending document load
      if (this.pendingDocument) {
        this.loadDocumentInternal(this.pendingDocument);
        this.pendingDocument = null;
      }

      // Process any pending selection
      if (this.pendingSelection !== null) {
        wasm.setSelection(this.pendingSelection);
        this.pendingSelection = null;
      }
    }

    // Start the render loop
    this.startLoop();
  }

  /**
   * Detach from the canvas and stop the render loop.
   */
  detachCanvas(): void {
    this.stopLoop();
    this.canvas = null;
    this.ctx = null;
  }

  /**
   * Load a document into the engine.
   * If WASM isn't ready yet, queues the document for loading once it initializes.
   */
  loadDocument(doc: InDocument): void {
    if (!this.wasmReady) {
      // Queue for later when WASM is ready
      this.pendingDocument = doc;
      return;
    }

    this.loadDocumentInternal(doc);
  }

  /**
   * Internal method to load document (assumes WASM is ready).
   */
  private loadDocumentInternal(doc: InDocument): void {
    wasm.loadDocument(doc);
    this.assets = doc.assets || {};
    this.docObjects = doc.objects || {};
    this.scene = wasm.getScene();
    this.updateFrameInterval();
    this.resizeCanvas();
    this.needsRender = true;
  }

  /**
   * Update the document without resetting playback state.
   * Used when the document changes during editing (e.g. keyframe recording, moving objects).
   */
  updateDocument(doc: InDocument): void {
    if (!this.wasmReady) {
      this.pendingDocument = doc;
      return;
    }
    this.assets = doc.assets || {};
    this.docObjects = doc.objects || {};
    try {
      wasm.updateDocument(doc);
    } catch (e) {
      console.error("[Stage] WASM updateDocument failed:", e);
      return;
    }
    this.scene = wasm.getScene();
    this.updateFrameInterval();
    this.needsRender = true;
  }

  /**
   * Switch the active scene in the engine.
   */
  setScene(sceneId: string): void {
    if (!this.wasmReady) return;
    wasm.setScene(sceneId);
    this.scene = wasm.getScene();
    this.resizeCanvas();
    this.needsRender = true;
  }

  /**
   * Load the sample document.
   * Note: This method requires WASM to be ready since it generates the document in WASM.
   */
  loadSampleDocument(projectId?: string): void {
    if (!this.wasmReady) {
      // Can't queue this one since it generates doc in WASM
      console.warn(
        "Stage.loadSampleDocument called before WASM ready, ignoring",
      );
      return;
    }

    wasm.loadSampleDocument(projectId);
    this.scene = wasm.getScene();
    this.updateFrameInterval();
    this.resizeCanvas();
  }

  /**
   * Set event handlers.
   */
  setEvents(events: StageEvents): void {
    this.events = events;
  }

  /**
   * Get the current scene metadata.
   */
  getScene(): Scene | null {
    return this.scene;
  }

  /**
   * Set the selected object IDs for rendering selection outlines.
   */
  setSelectedObjectIds(objectIds: string[]): void {
    this.selectedObjectIds = objectIds;

    if (!this.wasmReady) {
      this.pendingSelection = objectIds;
      return;
    }

    wasm.setSelection(objectIds);
  }

  /**
   * Set the drag overlay with initial animated transforms for dragged objects.
   */
  setDragOverlay(
    transforms: Record<string, import("../types/document").Transform>,
  ): void {
    if (!this.wasmReady) return;
    wasm.setDragOverlay(transforms);
    this.needsRender = true;
  }

  /**
   * Update transforms in the active drag overlay during drag move.
   */
  updateDragOverlay(
    transforms: Record<string, import("../types/document").Transform>,
  ): void {
    if (!this.wasmReady) return;
    wasm.updateDragOverlay(transforms);
    this.needsRender = true;
  }

  /**
   * Clear the drag overlay, restoring normal keyframe-evaluated rendering.
   */
  clearDragOverlay(): void {
    if (!this.wasmReady) return;
    wasm.clearDragOverlay();
    this.needsRender = true;
  }

  // --- Playback Controls ---

  togglePlay(): void {
    if (!this.wasmReady) return;
    wasm.togglePlay();
    this.events.onPlayStateChange?.(wasm.isPlaying());
  }

  play(): void {
    if (!this.wasmReady) return;
    wasm.play();
    this.events.onPlayStateChange?.(true);
  }

  pause(): void {
    if (!this.wasmReady) return;
    wasm.pause();
    this.events.onPlayStateChange?.(false);
  }

  seek(frame: number): void {
    if (!this.wasmReady) return;
    wasm.setPlayhead(frame);
    this.needsRender = true;
    this.events.onFrameChange?.(frame);
  }

  /**
   * Get the current frame number.
   */
  getCurrentFrame(): number {
    if (!this.wasmReady) return 0;
    return wasm.getFrame();
  }

  /**
   * Force a re-render (e.g., during drag operations).
   */
  invalidate(): void {
    this.needsRender = true;
  }

  // --- Hit Testing ---

  /**
   * Perform a hit test at the given canvas coordinates.
   */
  hitTest(x: number, y: number): string | null {
    if (!this.wasmReady) return null;
    const result = wasm.hitTest(x, y);
    return result || null;
  }

  /**
   * Hit test for transform handles on the selected object.
   * Only works when exactly one object is selected.
   */
  hitTestHandle(x: number, y: number): HandleType {
    if (this.selectedObjectIds.length !== 1) return null;

    const cmd = this.lastCommands.find(
      (c) => c.objectId === this.selectedObjectIds[0],
    );
    if (!cmd) return null;
    return hitTestHandle(x, y, cmd);
  }

  /**
   * Get the world bounds of the selected object (single selection only).
   */
  getSelectedObjectBounds(): Bounds | null {
    if (this.selectedObjectIds.length !== 1) return null;

    const cmd = this.lastCommands.find(
      (c) => c.objectId === this.selectedObjectIds[0],
    );
    if (!cmd) return null;

    return getWorldBounds(cmd);
  }

  /**
   * Hit test for the anchor point of a selected object.
   * Returns true if the point is over the anchor indicator.
   */
  hitTestAnchorPoint(x: number, y: number): boolean {
    if (this.selectedObjectIds.length !== 1) return false;
    const id = this.selectedObjectIds[0];
    const cmd = this.lastCommands.find((c) => c.objectId === id);
    if (!cmd) return false;
    const obj = this.docObjects[id];
    if (!obj) return false;
    return hitTestAnchorPointCmd(x, y, cmd, obj.transform.ax, obj.transform.ay);
  }

  /**
   * Set subselection state for rendering anchor points and handles.
   */
  setSubselection(
    objectId: string | null,
    anchors: AnchorPoint[] | null,
    selectedPoints: Set<number>,
  ): void {
    this.subselectionObjectId = objectId;
    this.subselectionAnchors = anchors;
    this.subselectedPoints = selectedPoints;
    this.needsRender = true;
  }

  /**
   * Clear subselection state.
   */
  clearSubselection(): void {
    this.subselectionObjectId = null;
    this.subselectionAnchors = null;
    this.subselectedPoints = new Set();
    this.needsRender = true;
  }

  /**
   * Hit test for subselection anchor points and handles.
   */
  hitTestSubselection(x: number, y: number): SubselectionHit | null {
    if (!this.subselectionObjectId || !this.subselectionAnchors) return null;
    const cmd = this.lastCommands.find(
      (c) => c.objectId === this.subselectionObjectId,
    );
    if (!cmd) return null;
    return hitTestSubselectionCmd(
      x,
      y,
      cmd,
      this.subselectionAnchors,
      this.subselectedPoints,
    );
  }

  /**
   * Get the animated (keyframe-evaluated) transform for an object at the current frame.
   * Returns the effective transform after keyframe overrides are applied.
   */
  getAnimatedTransform(objectId: string): {
    x: number;
    y: number;
    sx: number;
    sy: number;
    r: number;
    skewX: number;
    skewY: number;
  } | null {
    if (!this.wasmReady) return null;
    return wasm.getAnimatedTransform(objectId);
  }

  /**
   * Get world bounds for any object by ID (for marquee selection).
   */
  getObjectWorldBounds(objectId: string): Bounds | null {
    const cmd = this.lastCommands.find((c) => c.objectId === objectId);
    if (!cmd) return null;
    return getWorldBounds(cmd);
  }

  // --- Private Methods ---

  private updateFrameInterval(): void {
    if (!this.wasmReady) return;
    const fps = wasm.getFPS();
    this.frameInterval = 1000 / (fps > 0 ? fps : 24);
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.scene || !this.ctx) return;

    // Get device pixel ratio for high-DPI displays (Retina, etc.)
    this.dpr = window.devicePixelRatio || 1;

    const displayWidth = this.scene.width;
    const displayHeight = this.scene.height;

    // Set the backing store size (actual pixels) to account for DPR
    const backingWidth = Math.round(displayWidth * this.dpr);
    const backingHeight = Math.round(displayHeight * this.dpr);

    if (
      this.canvas.width !== backingWidth ||
      this.canvas.height !== backingHeight
    ) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;

      // Set CSS display size (logical pixels)
      this.canvas.style.width = `${displayWidth}px`;
      this.canvas.style.height = `${displayHeight}px`;

      // Scale the context so drawing operations use logical coordinates
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return;

    // When an image finishes loading, trigger a re-render
    setImageLoadedCallback(() => {
      this.needsRender = true;
    });

    const loop = (time: number) => {
      this.rafId = requestAnimationFrame(loop);

      // Skip if WASM isn't ready yet or no document loaded
      if (!this.wasmReady || !this.scene) return;

      try {
        // Check if we should advance frame (if playing)
        const elapsed = time - this.lastFrameTime;
        if (wasm.isPlaying() && elapsed >= this.frameInterval) {
          this.lastFrameTime = time - (elapsed % this.frameInterval);

          // Tick advances frame if playing and returns draw commands
          const commands = wasm.tick();
          this.lastCommands = commands || [];
          this.render();

          // Notify frame change
          this.events.onFrameChange?.(wasm.getFrame());
        } else if (!wasm.isPlaying() && this.needsRender) {
          // Only re-render when paused if something actually changed
          const commands = wasm.render();
          this.lastCommands = commands || [];
          this.render();
          this.needsRender = false;
        }
      } catch (e) {
        console.error("[Stage] Render loop error:", e);
      }
    };

    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    setImageLoadedCallback(null);
  }

  private render(): void {
    if (!this.ctx || !this.scene) return;

    // Execute draw commands with DPR scaling for crisp rendering on high-DPI displays
    executeCommands(
      this.ctx,
      this.lastCommands,
      this.scene.background,
      this.dpr,
      this.assets,
    );

    // Render selection outlines
    if (this.selectedObjectIds.length > 0) {
      const showHandles = this.selectedObjectIds.length === 1;
      for (const id of this.selectedObjectIds) {
        const cmd = this.lastCommands.find((c) => c.objectId === id);
        if (cmd) {
          // In subselection mode, show outline without handles
          const useHandles = showHandles && id !== this.subselectionObjectId;
          renderSelectionOutline(this.ctx, cmd, useHandles);

          // Render anchor point indicator for single selection (not in subselect mode)
          if (showHandles && id !== this.subselectionObjectId) {
            const obj = this.docObjects[id];
            if (obj) {
              renderAnchorPoint(
                this.ctx,
                cmd,
                obj.transform.ax,
                obj.transform.ay,
              );
            }
          }
        }
      }
    }

    // Render subselection overlay
    if (this.subselectionObjectId && this.subselectionAnchors && this.ctx) {
      const cmd = this.lastCommands.find(
        (c) => c.objectId === this.subselectionObjectId,
      );
      if (cmd) {
        renderSubselectionOverlay(
          this.ctx,
          cmd,
          this.subselectionAnchors,
          this.subselectedPoints,
        );
      }
    }
  }
}
