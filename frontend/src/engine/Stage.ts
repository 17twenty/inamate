import type { InDocument, Scene } from "../types/document";
import type { DrawCommand, HandleType, Bounds } from "./commands";
import {
  executeCommands,
  renderSelectionOutline,
  hitTestHandle,
  getWorldBounds,
} from "./commands";
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

  private selectedObjectId: string | null = null;
  private lastCommands: DrawCommand[] = [];

  // Queue for operations before WASM is ready
  private pendingDocument: InDocument | null = null;
  private pendingSelection: string[] | null = null;

  // Device pixel ratio for high-DPI displays
  private dpr = 1;

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
    this.scene = wasm.getScene();
    this.updateFrameInterval();
    this.resizeCanvas();
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
   * Set the selected object ID for rendering selection outline.
   */
  setSelectedObjectId(objectId: string | null): void {
    this.selectedObjectId = objectId;
    const selection = objectId ? [objectId] : [];

    if (!this.wasmReady) {
      // Queue for later
      this.pendingSelection = selection;
      return;
    }

    wasm.setSelection(selection);
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
    this.events.onFrameChange?.(frame);
  }

  /**
   * Force a re-render (e.g., during drag operations).
   */
  invalidate(): void {
    this.render();
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
   * Returns the handle type if clicking a handle, null otherwise.
   */
  hitTestHandle(x: number, y: number): HandleType {
    if (!this.selectedObjectId) return null;

    const cmd = this.lastCommands.find(
      (c) => c.objectId === this.selectedObjectId,
    );
    if (!cmd) return null;

    return hitTestHandle(x, y, cmd);
  }

  /**
   * Get the world bounds of the selected object.
   */
  getSelectedObjectBounds(): Bounds | null {
    if (!this.selectedObjectId) return null;

    const cmd = this.lastCommands.find(
      (c) => c.objectId === this.selectedObjectId,
    );
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

    const loop = (time: number) => {
      this.rafId = requestAnimationFrame(loop);

      // Skip if WASM isn't ready yet
      if (!this.wasmReady) return;

      // Check if we should advance frame (if playing)
      const elapsed = time - this.lastFrameTime;
      if (wasm.isPlaying() && elapsed >= this.frameInterval) {
        this.lastFrameTime = time - (elapsed % this.frameInterval);

        // Tick advances frame if playing and returns draw commands
        this.lastCommands = wasm.tick();
        this.render();

        // Notify frame change
        this.events.onFrameChange?.(wasm.getFrame());
      } else if (!wasm.isPlaying()) {
        // Even if not playing, render current state
        this.lastCommands = wasm.render();
        this.render();
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
  }

  private render(): void {
    if (!this.ctx || !this.scene) return;

    // Execute draw commands with DPR scaling for crisp rendering on high-DPI displays
    executeCommands(
      this.ctx,
      this.lastCommands,
      this.scene.background,
      this.dpr,
    );

    // Render selection outline if any
    if (this.selectedObjectId) {
      const selectedCmd = this.lastCommands.find(
        (cmd) => cmd.objectId === this.selectedObjectId,
      );
      if (selectedCmd) {
        renderSelectionOutline(this.ctx, selectedCmd);
      }
    }
  }
}
