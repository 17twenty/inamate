/**
 * Export utilities for Inamate animation editor
 */

import JSZip from "jszip";
import type { Stage } from "../engine/Stage";
import type { InDocument } from "../types/document";
import { RUNTIME_JS } from "../engine/runtime";
import { API_BASE } from "../api/client";

export interface ExportProgress {
  current: number;
  total: number;
  phase: "rendering" | "zipping" | "downloading" | "encoding";
}

/**
 * Export a PNG sequence of all frames as a zip file.
 *
 * @param stage - The Stage instance to render frames from
 * @param projectName - Project name for the zip filename
 * @param totalFrames - Total number of frames to export
 * @param onProgress - Optional progress callback
 * @returns Promise that resolves when export is complete
 */
export async function exportPngSequence(
  stage: Stage,
  canvas: HTMLCanvasElement,
  projectName: string,
  totalFrames: number,
  onProgress?: (progress: ExportProgress) => void,
): Promise<void> {
  const zip = new JSZip();

  // Create a safe folder name
  const safeName =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "inamate-sequence";

  const folder = zip.folder(safeName);
  if (!folder) {
    throw new Error("Failed to create zip folder");
  }

  // Calculate padding for frame numbers (e.g., 001, 002, etc.)
  const padLength = String(totalFrames - 1).length;

  // Render each frame
  for (let frame = 0; frame < totalFrames; frame++) {
    onProgress?.({
      current: frame + 1,
      total: totalFrames,
      phase: "rendering",
    });

    // Seek to frame and wait for render
    stage.seek(frame);
    stage.invalidate();

    // Wait a tick for the render to complete
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Get the PNG data
    const dataUrl = canvas.toDataURL("image/png");
    const base64Data = dataUrl.split(",")[1];

    // Add to zip with padded frame number
    const frameNumber = String(frame).padStart(padLength, "0");
    folder.file(`frame_${frameNumber}.png`, base64Data, { base64: true });
  }

  // Generate the zip
  onProgress?.({
    current: totalFrames,
    total: totalFrames,
    phase: "zipping",
  });

  const blob = await zip.generateAsync({ type: "blob" });

  // Download
  onProgress?.({
    current: totalFrames,
    total: totalFrames,
    phase: "downloading",
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeName}.zip`;
  link.click();

  // Clean up
  URL.revokeObjectURL(link.href);
}

/**
 * Export animation as a video or GIF via the backend ffmpeg endpoint.
 */
export async function exportVideo(
  stage: Stage,
  canvas: HTMLCanvasElement,
  projectName: string,
  totalFrames: number,
  format: "mp4" | "gif" | "webm",
  fps: number,
  onProgress?: (progress: ExportProgress) => void,
): Promise<void> {
  const safeName =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "animation";

  // Phase 1: Render frames to blobs
  const blobs: Blob[] = [];

  for (let frame = 0; frame < totalFrames; frame++) {
    onProgress?.({
      current: frame + 1,
      total: totalFrames,
      phase: "rendering",
    });

    stage.seek(frame);
    stage.invalidate();

    await new Promise((resolve) => requestAnimationFrame(resolve));

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error(`Failed to capture frame ${frame}`));
      }, "image/png");
    });

    blobs.push(blob);
  }

  // Phase 2: Upload to backend
  onProgress?.({
    current: totalFrames,
    total: totalFrames,
    phase: "encoding",
  });

  const formData = new FormData();
  formData.append("format", format);
  formData.append("fps", fps.toString());
  formData.append("width", canvas.width.toString());
  formData.append("height", canvas.height.toString());
  formData.append("name", safeName);

  for (let i = 0; i < blobs.length; i++) {
    const key = `frame_${i.toString().padStart(4, "0")}`;
    formData.append(key, blobs[i], `${key}.png`);
  }

  const response = await fetch(`${API_BASE}/export/video`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Export failed: ${text}`);
  }

  // Phase 3: Download
  onProgress?.({
    current: totalFrames,
    total: totalFrames,
    phase: "downloading",
  });

  const resultBlob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(resultBlob);
  link.download = `${safeName}.${format}`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Prepare document for standalone export: convert asset URLs to base64 data URLs.
 */
async function prepareDocumentForExport(doc: InDocument): Promise<InDocument> {
  const exportDoc = JSON.parse(JSON.stringify(doc)) as InDocument;

  // Convert asset URLs to data URLs for portability
  for (const assetId of Object.keys(exportDoc.assets)) {
    const asset = exportDoc.assets[assetId];
    if (asset.url && !asset.url.startsWith("data:")) {
      try {
        const resp = await fetch(asset.url);
        const blob = await resp.blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        asset.url = dataUrl;
      } catch {
        // Keep original URL if fetch fails
      }
    }
  }

  return exportDoc;
}

/**
 * Export animation as a standalone HTML file in a zip package.
 */
export async function exportHTML(
  doc: InDocument,
  onProgress?: (progress: ExportProgress) => void,
): Promise<void> {
  const safeName =
    doc.project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "animation";

  // Phase 1: Prepare document with embedded assets
  onProgress?.({ current: 1, total: 3, phase: "rendering" });
  const exportDoc = await prepareDocumentForExport(doc);

  // Phase 2: Generate files
  onProgress?.({ current: 2, total: 3, phase: "zipping" });

  const scene = exportDoc.scenes[exportDoc.project.scenes[0]];
  const projectJson = JSON.stringify(exportDoc);

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${doc.project.name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a1a; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  canvas { border: 1px solid #333; max-width: 90vw; max-height: 80vh; object-fit: contain; }
  .controls { display: flex; align-items: center; gap: 12px; margin-top: 12px; color: #999; font-size: 13px; }
  button { background: #333; color: #ccc; border: 1px solid #555; border-radius: 4px; padding: 6px 16px; cursor: pointer; font-size: 13px; }
  button:hover { background: #444; color: #fff; }
  input[type="range"] { width: 200px; accent-color: #6366f1; }
  #frame-label { min-width: 80px; text-align: center; font-variant-numeric: tabular-nums; }
  .title { color: #666; font-size: 11px; margin-bottom: 8px; }
</style>
</head>
<body>
<div class="title">Created with Inamate</div>
<canvas id="animation-canvas" width="${scene?.width || 1280}" height="${scene?.height || 720}"></canvas>
<div class="controls">
  <button id="play-btn">Play</button>
  <input type="range" id="scrubber" min="0" value="0" />
  <span id="frame-label">0 / 0</span>
</div>
<script>window.__INAMATE_PROJECT__ = ${projectJson};</script>
<script src="runtime.js"></script>
</body>
</html>`;

  const zip = new JSZip();
  zip.file("index.html", indexHtml);
  zip.file("runtime.js", RUNTIME_JS);

  const blob = await zip.generateAsync({ type: "blob" });

  // Phase 3: Download
  onProgress?.({ current: 3, total: 3, phase: "downloading" });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeName}-html.zip`;
  link.click();
  URL.revokeObjectURL(link.href);
}
