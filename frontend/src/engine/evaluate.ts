import type { InDocument, Transform, Keyframe } from "../types/document";

/**
 * Evaluate all tracks of a timeline at a given frame.
 * Returns a map of objectId -> partial Transform/Style overrides.
 */
export function evaluateTimeline(
  doc: InDocument,
  timelineId: string,
  frame: number,
): Map<string, Record<string, number>> {
  const timeline = doc.timelines[timelineId];
  if (!timeline) return new Map();

  const overrides = new Map<string, Record<string, number>>();

  for (const trackId of timeline.tracks) {
    const track = doc.tracks[trackId];
    if (!track) continue;

    // Resolve keyframes for this track
    const keys: Keyframe[] = track.keys
      .map((kId) => doc.keyframes[kId])
      .filter(Boolean)
      .sort((a, b) => a.frame - b.frame);

    if (keys.length === 0) continue;

    const value = interpolateKeyframes(keys, frame);
    if (value === null) continue;

    const existing = overrides.get(track.objectId) || {};
    existing[track.property] = value;
    overrides.set(track.objectId, existing);
  }

  return overrides;
}

/**
 * Apply property overrides to a Transform, returning a new merged Transform.
 */
export function applyTransformOverrides(
  base: Transform,
  overrides: Record<string, number>,
): Transform {
  const result = { ...base };
  for (const [prop, value] of Object.entries(overrides)) {
    switch (prop) {
      case "transform.x":
        result.x = value;
        break;
      case "transform.y":
        result.y = value;
        break;
      case "transform.r":
        result.r = (value * Math.PI) / 180;
        break;
      case "transform.sx":
        result.sx = value;
        break;
      case "transform.sy":
        result.sy = value;
        break;
    }
  }
  return result;
}

/**
 * Interpolate between keyframes at a given frame (linear interpolation).
 */
function interpolateKeyframes(keys: Keyframe[], frame: number): number | null {
  if (keys.length === 0) return null;

  // Before first keyframe: use first value
  if (frame <= keys[0].frame) {
    return toNumber(keys[0].value);
  }

  // After last keyframe: use last value
  if (frame >= keys[keys.length - 1].frame) {
    return toNumber(keys[keys.length - 1].value);
  }

  // Find bracketing keyframes
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const aVal = toNumber(a.value);
      const bVal = toNumber(b.value);
      if (aVal === null || bVal === null) return aVal ?? bVal;

      const range = b.frame - a.frame;
      if (range === 0) return aVal;

      const t = (frame - a.frame) / range;
      return aVal + (bVal - aVal) * t;
    }
  }

  return null;
}

function toNumber(value: number | string): number | null {
  if (typeof value === "number") return value;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}
