import type { PathCommand } from "../types/document";

/**
 * Anchor point representation for subselection editing.
 * Coordinates are in local (object) space.
 */
export interface AnchorPoint {
  index: number;
  x: number;
  y: number;
  handleIn?: { x: number; y: number }; // absolute coords
  handleOut?: { x: number; y: number }; // absolute coords
}

/**
 * Parse path commands into a list of editable anchor points.
 */
export function pathToAnchors(commands: PathCommand[]): AnchorPoint[] {
  const anchors: AnchorPoint[] = [];
  let currentX = 0;
  let currentY = 0;

  for (const cmd of commands) {
    switch (cmd[0]) {
      case "M": {
        anchors.push({ index: anchors.length, x: cmd[1], y: cmd[2] });
        currentX = cmd[1];
        currentY = cmd[2];
        break;
      }
      case "L": {
        anchors.push({ index: anchors.length, x: cmd[1], y: cmd[2] });
        currentX = cmd[1];
        currentY = cmd[2];
        break;
      }
      case "C": {
        // Cubic bezier: cp1x cp1y cp2x cp2y x y
        // cp1 is the handleOut of the *previous* anchor
        // cp2 is the handleIn of the *new* anchor
        const prevAnchor = anchors[anchors.length - 1];
        if (prevAnchor) {
          prevAnchor.handleOut = { x: cmd[1], y: cmd[2] };
        }
        anchors.push({
          index: anchors.length,
          x: cmd[5],
          y: cmd[6],
          handleIn: { x: cmd[3], y: cmd[4] },
        });
        currentX = cmd[5];
        currentY = cmd[6];
        break;
      }
      case "Q": {
        // Quadratic bezier: convert to cubic equivalent
        // Cubic cp1 = anchor + 2/3 * (qcp - anchor)
        // Cubic cp2 = endpoint + 2/3 * (qcp - endpoint)
        const qcpX = cmd[1];
        const qcpY = cmd[2];
        const endX = cmd[3];
        const endY = cmd[4];

        const cp1x = currentX + (2 / 3) * (qcpX - currentX);
        const cp1y = currentY + (2 / 3) * (qcpY - currentY);
        const cp2x = endX + (2 / 3) * (qcpX - endX);
        const cp2y = endY + (2 / 3) * (qcpY - endY);

        const prevAnchorQ = anchors[anchors.length - 1];
        if (prevAnchorQ) {
          prevAnchorQ.handleOut = { x: cp1x, y: cp1y };
        }
        anchors.push({
          index: anchors.length,
          x: endX,
          y: endY,
          handleIn: { x: cp2x, y: cp2y },
        });
        currentX = endX;
        currentY = endY;
        break;
      }
      case "Z":
        // Close path — handled by caller via `closed` flag
        break;
    }
  }

  return anchors;
}

/**
 * Convert anchor points back to path commands.
 */
export function anchorsToPath(
  anchors: AnchorPoint[],
  closed: boolean,
): PathCommand[] {
  if (anchors.length === 0) return [];

  const commands: PathCommand[] = [];
  commands.push(["M", anchors[0].x, anchors[0].y]);

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const curr = anchors[i];

    if (prev.handleOut || curr.handleIn) {
      const cp1x = prev.handleOut?.x ?? prev.x;
      const cp1y = prev.handleOut?.y ?? prev.y;
      const cp2x = curr.handleIn?.x ?? curr.x;
      const cp2y = curr.handleIn?.y ?? curr.y;
      commands.push(["C", cp1x, cp1y, cp2x, cp2y, curr.x, curr.y]);
    } else {
      commands.push(["L", curr.x, curr.y]);
    }
  }

  if (closed && anchors.length >= 3) {
    const last = anchors[anchors.length - 1];
    const first = anchors[0];
    if (last.handleOut || first.handleIn) {
      const cp1x = last.handleOut?.x ?? last.x;
      const cp1y = last.handleOut?.y ?? last.y;
      const cp2x = first.handleIn?.x ?? first.x;
      const cp2y = first.handleIn?.y ?? first.y;
      commands.push(["C", cp1x, cp1y, cp2x, cp2y, first.x, first.y]);
    }
    commands.push(["Z"]);
  }

  return commands;
}

/**
 * Check if a path is closed (ends with Z command).
 */
export function isPathClosed(commands: PathCommand[]): boolean {
  return commands.length > 0 && commands[commands.length - 1][0] === "Z";
}
