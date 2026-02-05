import type { InDocument, Scene } from "../types/document";
import type { DrawCommand } from "./commands";

/**
 * Type declarations for the WASM engine API exposed on window.
 */
declare global {
  interface Window {
    Go: new () => {
      run(instance: WebAssembly.Instance): Promise<void>;
      importObject: WebAssembly.Imports;
    };
    inamateEngine?: InamateEngine;
    inamateWasmReady?: boolean;
  }
}

interface InamateEngine {
  // Commands (frontend → backend)
  loadDocument(json: string): { ok?: boolean; error?: string };
  loadSampleDocument(projectId?: string): { ok?: boolean };
  setPlayhead(frame: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setSelection(ids: string[]): void;
  tick(): string;

  // Queries (frontend ← backend)
  render(): string;
  hitTest(x: number, y: number): string;
  getSelectionBounds(): string;
  getScene(): string;
  getPlaybackState(): string;
  getDocument(): string;
  getSelection(): string;
  getFrame(): number;
  isPlaying(): boolean;
  getFPS(): number;
  getTotalFrames(): number;
}

let wasmReady = false;
let readyPromise: Promise<void> | null = null;

/**
 * Initialize the WASM engine. Safe to call multiple times.
 */
export async function initWasm(): Promise<void> {
  if (wasmReady) return;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    // Load wasm_exec.js (Go WASM runtime)
    await loadScript("/wasm_exec.js");

    // Instantiate Go and load WASM
    const go = new window.Go();
    const result = await WebAssembly.instantiateStreaming(
      fetch("/engine.wasm"),
      go.importObject
    );

    // Run the Go program (non-blocking, keeps running)
    go.run(result.instance);

    // Wait for WASM to signal ready
    await waitForWasmReady();
    wasmReady = true;
  })();

  return readyPromise;
}

/**
 * Load a script dynamically.
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * Wait for WASM engine to be ready.
 */
function waitForWasmReady(timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.inamateWasmReady && window.inamateEngine) {
        resolve();
      } else if (Date.now() - start > timeout) {
        reject(new Error("WASM initialization timeout"));
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

/**
 * Check if WASM is ready.
 */
export function isWasmReady(): boolean {
  return wasmReady;
}

/**
 * Get the engine instance. Throws if not initialized.
 */
function getEngine(): InamateEngine {
  if (!window.inamateEngine) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  return window.inamateEngine;
}

// --- Commands ---

export function loadDocument(doc: InDocument): void {
  const result = getEngine().loadDocument(JSON.stringify(doc));
  if (result.error) {
    throw new Error(result.error);
  }
}

export function loadSampleDocument(projectId?: string): void {
  getEngine().loadSampleDocument(projectId);
}

export function setPlayhead(frame: number): void {
  getEngine().setPlayhead(frame);
}

export function play(): void {
  getEngine().play();
}

export function pause(): void {
  getEngine().pause();
}

export function togglePlay(): void {
  getEngine().togglePlay();
}

export function setSelection(ids: string[]): void {
  getEngine().setSelection(ids);
}

export function tick(): DrawCommand[] {
  const json = getEngine().tick();
  return JSON.parse(json) as DrawCommand[];
}

// --- Queries ---

export function render(): DrawCommand[] {
  const json = getEngine().render();
  return JSON.parse(json) as DrawCommand[];
}

export function hitTest(x: number, y: number): string {
  return getEngine().hitTest(x, y);
}

export function getSelectionBounds(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const json = getEngine().getSelectionBounds();
  return JSON.parse(json);
}

export function getScene(): Scene {
  const json = getEngine().getScene();
  return JSON.parse(json) as Scene;
}

export interface PlaybackState {
  frame: number;
  playing: boolean;
  fps: number;
  totalFrames: number;
}

export function getPlaybackState(): PlaybackState {
  const json = getEngine().getPlaybackState();
  return JSON.parse(json) as PlaybackState;
}

export function getDocument(): InDocument {
  const json = getEngine().getDocument();
  return JSON.parse(json) as InDocument;
}

export function getSelectionIds(): string[] {
  const json = getEngine().getSelection();
  return JSON.parse(json) as string[];
}

export function getFrame(): number {
  return getEngine().getFrame();
}

export function isPlaying(): boolean {
  return getEngine().isPlaying();
}

export function getFPS(): number {
  return getEngine().getFPS();
}

export function getTotalFrames(): number {
  return getEngine().getTotalFrames();
}
