import type { InDocument, Scene, Asset } from "../types/document";
import type {
  DrawCommand,
  HandleType,
  Bounds,
  SubselectionHit,
} from "./commands";
import {
  executeCommands,
  clearAndDrawBackground,
  executeCommandsNoClear,
  renderSelectionOutline,
  renderAnchorPoint,
  renderSubselectionOverlay,
  hitTestHandle,
  hitTestAnchorPoint as hitTestAnchorPointCmd,
  hitTestSubselection as hitTestSubselectionCmd,
  getWorldBounds,
  setImageLoadedCallback,
  drawGrid,
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

  // Onion skin state
  private onionSkinEnabled = false;
  private onionSkinBefore = 2;
  private onionSkinAfter = 1;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;

  // Subselection state (managed externally by CanvasViewport)
  private subselectionAnchors: AnchorPoint[] | null = null;
  private subselectedPoints: Set<number> = new Set();
  private subselectionObjectId: string | null = null;

  // Grid state
  private gridEnabled = false;
  private gridSize = 20;

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
   * Configure onion skin rendering.
   */
  setOnionSkin(enabled: boolean, before = 2, after = 1): void {
    this.onionSkinEnabled = enabled;
    this.onionSkinBefore = before;
    this.onionSkinAfter = after;
    this.needsRender = true;
  }

  /**
   * Configure grid overlay rendering.
   */
  setGrid(enabled: boolean, size: number): void {
    this.gridEnabled = enabled;
    this.gridSize = size;
    this.needsRender = true;
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

  /**
   * Get the full world-space affine matrix [a,b,c,d,e,f] for an object.
   * This is the composed parent chain matrix from the last render.
   */
  getObjectWorldMatrix(objectId: string): number[] | null {
    const cmd = this.lastCommands.find((c) => c.objectId === objectId);
    return cmd?.transform ?? null;
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

  private renderWithOnionSkin(): void {
    if (!this.ctx || !this.scene) return;

    this.ensureOffscreenCanvas();
    if (!this.offscreenCtx) return;

    const currentFrame = wasm.getFrame();
    const totalFrames = wasm.getTotalFrames();

    // 1. Clear main canvas + draw background once
    clearAndDrawBackground(this.ctx, this.scene.background, this.dpr);

    // 2. Collect onion frames (furthest first so closer frames draw on top)
    const onionFrames: {
      frame: number;
      isBefore: boolean;
      distance: number;
    }[] = [];

    for (let d = this.onionSkinBefore; d >= 1; d--) {
      const f = currentFrame - d;
      if (f >= 0) onionFrames.push({ frame: f, isBefore: true, distance: d });
    }
    for (let d = this.onionSkinAfter; d >= 1; d--) {
      const f = currentFrame + d;
      if (f < totalFrames)
        onionFrames.push({ frame: f, isBefore: false, distance: d });
    }

    // 3. Render each onion frame to offscreen, tint, composite onto main
    for (const { frame, isBefore, distance } of onionFrames) {
      // Seek and render at the onion frame
      wasm.setPlayhead(frame);
      const cmds = wasm.render();
      if (!cmds || cmds.length === 0) continue;

      // Clear offscreen and draw commands
      const oCtx = this.offscreenCtx;
      oCtx.save();
      oCtx.setTransform(1, 0, 0, 1, 0, 0);
      oCtx.clearRect(
        0,
        0,
        this.offscreenCanvas!.width,
        this.offscreenCanvas!.height,
      );
      oCtx.restore();

      executeCommandsNoClear(oCtx, cmds, this.dpr, this.assets);

      // Apply color tint via source-atop compositing
      oCtx.save();
      oCtx.setTransform(1, 0, 0, 1, 0, 0);
      oCtx.globalCompositeOperation = "source-atop";
      oCtx.fillStyle = isBefore
        ? "rgba(60, 120, 255, 0.6)" // blue for previous frames
        : "rgba(255, 120, 40, 0.6)"; // orange for next frames
      oCtx.fillRect(
        0,
        0,
        this.offscreenCanvas!.width,
        this.offscreenCanvas!.height,
      );
      oCtx.restore();

      // Composite onto main canvas with fading alpha
      const maxDist = Math.max(this.onionSkinBefore, this.onionSkinAfter);
      const alpha = 0.3 - (distance - 1) * (0.15 / Math.max(1, maxDist - 1));
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.globalAlpha = Math.max(0.1, alpha);
      this.ctx.drawImage(this.offscreenCanvas!, 0, 0);
      this.ctx.restore();
    }

    // 4. Restore playhead and draw current frame on top
    wasm.setPlayhead(currentFrame);
    // lastCommands already has the current frame's commands
    executeCommandsNoClear(this.ctx, this.lastCommands, this.dpr, this.assets);
  }

  private ensureOffscreenCanvas(): void {
    if (!this.canvas) return;
    if (
      !this.offscreenCanvas ||
      this.offscreenCanvas.width !== this.canvas.width ||
      this.offscreenCanvas.height !== this.canvas.height
    ) {
      this.offscreenCanvas = document.createElement("canvas");
      this.offscreenCanvas.width = this.canvas.width;
      this.offscreenCanvas.height = this.canvas.height;
      this.offscreenCtx = this.offscreenCanvas.getContext("2d");
    }
  }

  private render(): void {
    if (!this.ctx || !this.scene) return;

    const shouldOnionSkin = this.onionSkinEnabled && !wasm.isPlaying();

    if (shouldOnionSkin) {
      this.renderWithOnionSkin();
    } else {
      // Normal rendering path
      executeCommands(
        this.ctx,
        this.lastCommands,
        this.scene.background,
        this.dpr,
        this.assets,
      );
    }

    // Render grid overlay (between objects and selection outlines)
    if (this.gridEnabled && this.scene && this.ctx) {
      drawGrid(
        this.ctx,
        this.scene.width,
        this.scene.height,
        this.gridSize,
        this.dpr,
        this.scene.background || "#ffffff",
      );
    }

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
