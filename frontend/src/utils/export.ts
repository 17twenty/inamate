/**
 * Export utilities for Inamate animation editor
 */

import JSZip from "jszip";
import type { Stage } from "../engine/Stage";

interface ExportProgress {
  current: number;
  total: number;
  phase: "rendering" | "zipping" | "downloading";
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
  const safeName = projectName
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
