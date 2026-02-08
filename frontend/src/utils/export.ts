/**
 * Export utilities for Inamate animation editor
 */

import JSZip from "jszip";
import type { Stage } from "../engine/Stage";

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

  const response = await fetch("/export/video", {
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
