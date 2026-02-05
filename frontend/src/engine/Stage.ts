import { Engine } from "./engine";
import { Renderer } from "../components/canvas/Renderer";
import type { RenderCommand } from "./renderList";
import type { InDocument } from "../types/document";

export interface StageEvents {
  /** Called when currentFrame changes (playback or seek). */
  onFrameChange?: (frame: number) => void;
  /** Called when play/pause state changes. */
  onPlayStateChange?: (isPlaying: boolean) => void;
}

/**
 * Stage owns the render loop and bridges Engine → Renderer.
 *
 * React never sees render commands. The canvas is updated imperatively
 * on each animation frame. React only receives lightweight callbacks
 * (frame number, play state) to update UI chrome like the timeline.
 */
export class Stage {
  private engine = new Engine();
  private renderer: Renderer | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // Document
  private doc: InDocument | null = null;
  private sceneWidth = 0;
  private sceneHeight = 0;
  private background = "#000000";

  // Playback
  private _isPlaying = false;
  private _currentFrame = 0;
  private _globalTick = 0;
  private _fps = 24;
  private _totalFrames = 48;

  // Selection (drives outline rendering)
  private _selectedObjectId: string | null = null;

  // Cached render commands (for hit testing — never enters React)
  private lastCommands: RenderCommand[] = [];

  // rAF loop
  private animFrameId: number | null = null;
  private lastTickTime = 0;

  // Events
  private events: StageEvents = {};

  // Dirty flag — avoids redundant evaluate/render when nothing changed
  private dirty = true;

  // --- Setup ---

  /** Attach a canvas element. Creates the Renderer and starts the rAF loop. */
  attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);

    if (this.doc) {
      canvas.width = this.sceneWidth;
      canvas.height = this.sceneHeight;
    }

    this.dirty = true;
    this.startLoop();
  }

  /** Detach the canvas. Stops the rAF loop and cleans up. */
  detachCanvas(): void {
    this.stopLoop();
    this.renderer = null;
    this.canvas = null;
  }

  /** Set event callbacks for UI updates. */
  setEvents(events: StageEvents): void {
    this.events = events;
  }

  // --- Document ---

  /** Load or reload a document into the engine. */
  loadDocument(doc: InDocument): void {
    this.doc = doc;
    this.engine.loadDocument(doc);

    // Extract scene metadata
    const sceneId = doc.project.scenes[0];
    const scene = sceneId ? doc.scenes[sceneId] : null;
    if (scene) {
      this.sceneWidth = scene.width;
      this.sceneHeight = scene.height;
      this.background = scene.background;
    }

    this._fps = doc.project.fps;
    const rootTl = doc.timelines[doc.project.rootTimeline];
    this._totalFrames = rootTl?.length || 48;

    // Resize canvas if attached
    if (this.canvas) {
      this.canvas.width = this.sceneWidth;
      this.canvas.height = this.sceneHeight;
    }

    this.dirty = true;
  }

  /** Get scene metadata (for layout and overlays). */
  getScene(): { width: number; height: number; background: string } | null {
    if (!this.doc) return null;
    return {
      width: this.sceneWidth,
      height: this.sceneHeight,
      background: this.background,
    };
  }

  // --- Playback controls ---

  play(): void {
    if (this._isPlaying) return;
    this._isPlaying = true;
    this.events.onPlayStateChange?.(true);
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    this.events.onPlayStateChange?.(false);
  }

  togglePlay(): void {
    if (this._isPlaying) this.pause();
    else this.play();
  }

  seek(frame: number): void {
    const clamped = Math.max(0, Math.min(this._totalFrames - 1, frame));
    if (clamped === this._currentFrame) return;
    this._currentFrame = clamped;
    this.dirty = true;
    this.events.onFrameChange?.(clamped);
  }

  // --- Selection ---

  setSelectedObjectId(id: string | null): void {
    if (id === this._selectedObjectId) return;
    this._selectedObjectId = id;
    this.dirty = true;
  }

  // --- Getters (for React UI to read on demand) ---

  get isPlaying(): boolean {
    return this._isPlaying;
  }
  get currentFrame(): number {
    return this._currentFrame;
  }
  get globalTick(): number {
    return this._globalTick;
  }
  get fps(): number {
    return this._fps;
  }
  get totalFrames(): number {
    return this._totalFrames;
  }
  get selectedObjectId(): string | null {
    return this._selectedObjectId;
  }

  // --- Hit testing (reads cached commands, no React involved) ---

  hitTest(canvasX: number, canvasY: number): string | null {
    if (!this.renderer || this.lastCommands.length === 0) return null;
    return this.renderer.hitTest(canvasX, canvasY, this.lastCommands);
  }

  // --- Force re-evaluate (e.g. after drag mutation) ---

  invalidate(): void {
    this.dirty = true;
  }

  // --- Cleanup ---

  dispose(): void {
    this.stopLoop();
    this.renderer = null;
    this.canvas = null;
    this.doc = null;
    this.events = {};
  }

  // --- The core loop ---

  private startLoop(): void {
    if (this.animFrameId !== null) return;
    this.lastTickTime = 0;

    const tick = (timestamp: number) => {
      this.animFrameId = requestAnimationFrame(tick);
      this.update(timestamp);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private update(timestamp: number): void {
    if (!this.doc || !this.renderer) return;

    const frameDuration = 1000 / this._fps;

    if (timestamp - this.lastTickTime >= frameDuration) {
      this.lastTickTime = timestamp;

      // Always advance globalTick — Symbol animations play regardless
      this._globalTick++;

      // Advance main timeline only when playing
      if (this._isPlaying) {
        this._currentFrame = (this._currentFrame + 1) % this._totalFrames;
        this.events.onFrameChange?.(this._currentFrame);
      }

      this.dirty = true;
    }

    // Only evaluate + render when something changed
    if (!this.dirty) return;
    this.dirty = false;

    try {
      this.lastCommands = this.engine.evaluate(
        this._globalTick,
        this._currentFrame,
      );
    } catch {
      this.lastCommands = [];
    }

    // Render directly to canvas — no React involved
    this.renderer.render(this.lastCommands, this.background);

    // Selection outline
    if (this._selectedObjectId) {
      const cmd = this.lastCommands.find(
        (c) => c.objectId === this._selectedObjectId,
      );
      if (cmd) {
        this.renderer.renderSelectionOutline(cmd);
      }
    }
  }
}
