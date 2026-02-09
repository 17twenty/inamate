/**
 * SVG Import — parse SVG files into Inamate ObjectNode data.
 */

import type {
  PathCommand,
  Transform,
  Style,
} from "../types/document";

export interface ParsedSVGObject {
  type: "VectorPath" | "ShapeRect" | "ShapeEllipse";
  transform: Transform;
  style: Style;
  data:
    | { commands: PathCommand[] }
    | { width: number; height: number }
    | { rx: number; ry: number };
}

const DEFAULT_TRANSFORM: Transform = {
  x: 0, y: 0, sx: 1, sy: 1, r: 0, ax: 0, ay: 0, skewX: 0, skewY: 0,
};

const DEFAULT_STYLE: Style = {
  fill: "#000000", stroke: "none", strokeWidth: 0, opacity: 1,
};

/**
 * Parse an SVG string into an array of Inamate-compatible objects.
 */
export function parseSVG(svgString: string): ParsedSVGObject[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");

  // Check for parse errors
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) return [];

  const results: ParsedSVGObject[] = [];
  const elements = doc.querySelectorAll(
    "path, rect, ellipse, circle, line, polygon, polyline",
  );

  for (const el of elements) {
    const obj = parseElement(el);
    if (obj) results.push(obj);
  }

  return results;
}

function parseElement(el: Element): ParsedSVGObject | null {
  const tag = el.tagName.toLowerCase();
  const style = extractStyle(el);
  const svgTransform = parseSVGTransform(el.getAttribute("transform") || "");

  switch (tag) {
    case "path": {
      const d = el.getAttribute("d");
      if (!d) return null;
      const commands = parseSVGPathD(d);
      if (commands.length === 0) return null;
      // Compute bounding box to set anchor at center
      const bounds = pathBounds(commands);
      return {
        type: "VectorPath",
        transform: {
          ...DEFAULT_TRANSFORM,
          x: svgTransform.x + bounds.minX,
          y: svgTransform.y + bounds.minY,
          sx: svgTransform.sx,
          sy: svgTransform.sy,
          r: svgTransform.r,
        },
        style,
        data: { commands: offsetPath(commands, -bounds.minX, -bounds.minY) },
      };
    }

    case "rect": {
      const x = num(el, "x");
      const y = num(el, "y");
      const w = num(el, "width");
      const h = num(el, "height");
      if (w === 0 || h === 0) return null;
      return {
        type: "ShapeRect",
        transform: {
          ...DEFAULT_TRANSFORM,
          x: svgTransform.x + x,
          y: svgTransform.y + y,
          sx: svgTransform.sx,
          sy: svgTransform.sy,
          r: svgTransform.r,
          ax: w / 2,
          ay: h / 2,
        },
        style,
        data: { width: w, height: h },
      };
    }

    case "ellipse": {
      const cx = num(el, "cx");
      const cy = num(el, "cy");
      const rx = num(el, "rx");
      const ry = num(el, "ry");
      if (rx === 0 || ry === 0) return null;
      return {
        type: "ShapeEllipse",
        transform: {
          ...DEFAULT_TRANSFORM,
          x: svgTransform.x + cx,
          y: svgTransform.y + cy,
          sx: svgTransform.sx,
          sy: svgTransform.sy,
          r: svgTransform.r,
        },
        style,
        data: { rx, ry },
      };
    }

    case "circle": {
      const cx = num(el, "cx");
      const cy = num(el, "cy");
      const r = num(el, "r");
      if (r === 0) return null;
      return {
        type: "ShapeEllipse",
        transform: {
          ...DEFAULT_TRANSFORM,
          x: svgTransform.x + cx,
          y: svgTransform.y + cy,
          sx: svgTransform.sx,
          sy: svgTransform.sy,
          r: svgTransform.r,
        },
        style,
        data: { rx: r, ry: r },
      };
    }

    case "line": {
      const x1 = num(el, "x1");
      const y1 = num(el, "y1");
      const x2 = num(el, "x2");
      const y2 = num(el, "y2");
      const commands: PathCommand[] = [["M", x1, y1], ["L", x2, y2]];
      const bounds = pathBounds(commands);
      return {
        type: "VectorPath",
        transform: {
          ...DEFAULT_TRANSFORM,
          x: svgTransform.x + bounds.minX,
          y: svgTransform.y + bounds.minY,
          sx: svgTransform.sx,
          sy: svgTransform.sy,
          r: svgTransform.r,
        },
        style,
        data: { commands: offsetPath(commands, -bounds.minX, -bounds.minY) },
      };
    }

    case "polygon":
    case "polyline": {
      const pointsAttr = el.getAttribute("points");
      if (!pointsAttr) return null;
      const nums = pointsAttr.trim().split(/[\s,]+/).map(Number);
      if (nums.length < 4) return null;
      const commands: PathCommand[] = [];
      for (let i = 0; i < nums.length - 1; i += 2) {
        commands.push(i === 0 ? ["M", nums[i], nums[i + 1]] : ["L", nums[i], nums[i + 1]]);
      }
      if (tag === "polygon") commands.push(["Z"]);
      const bounds = pathBounds(commands);
      return {
        type: "VectorPath",
        transform: {
          ...DEFAULT_TRANSFORM,
          x: svgTransform.x + bounds.minX,
          y: svgTransform.y + bounds.minY,
          sx: svgTransform.sx,
          sy: svgTransform.sy,
          r: svgTransform.r,
        },
        style,
        data: { commands: offsetPath(commands, -bounds.minX, -bounds.minY) },
      };
    }

    default:
      return null;
  }
}

// --- Style extraction ---

function extractStyle(el: Element): Style {
  const fill = getStyleAttr(el, "fill") || "#000000";
  const stroke = getStyleAttr(el, "stroke") || "none";
  const strokeWidth = parseFloat(getStyleAttr(el, "stroke-width") || "0") || 0;
  const opacity = parseFloat(getStyleAttr(el, "opacity") || "1") || 1;
  return { fill, stroke, strokeWidth, opacity };
}

function getStyleAttr(el: Element, prop: string): string | null {
  // Check inline style first, then attribute
  const style = el.getAttribute("style");
  if (style) {
    const match = style.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`));
    if (match) return match[1].trim();
  }
  return el.getAttribute(prop);
}

// --- SVG transform attribute parsing ---

interface SVGTransformResult {
  x: number; y: number; sx: number; sy: number; r: number;
}

function parseSVGTransform(attr: string): SVGTransformResult {
  const result: SVGTransformResult = { x: 0, y: 0, sx: 1, sy: 1, r: 0 };
  if (!attr) return result;

  const translateMatch = attr.match(/translate\(\s*([^,)]+)(?:[\s,]+([^)]+))?\s*\)/);
  if (translateMatch) {
    result.x = parseFloat(translateMatch[1]) || 0;
    result.y = parseFloat(translateMatch[2] || "0") || 0;
  }

  const scaleMatch = attr.match(/scale\(\s*([^,)]+)(?:[\s,]+([^)]+))?\s*\)/);
  if (scaleMatch) {
    result.sx = parseFloat(scaleMatch[1]) || 1;
    result.sy = parseFloat(scaleMatch[2] || scaleMatch[1]) || result.sx;
  }

  const rotateMatch = attr.match(/rotate\(\s*([^,)]+)/);
  if (rotateMatch) {
    result.r = parseFloat(rotateMatch[1]) || 0;
  }

  return result;
}

// --- SVG path d attribute parser ---

export function parseSVGPathD(d: string): PathCommand[] {
  const tokens = tokenize(d);
  const commands: PathCommand[] = [];
  let i = 0;
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;
  let lastCmd = "";
  let lastCpX = 0, lastCpY = 0; // For S/T smooth commands

  function nextNum(): number {
    return i < tokens.length ? parseFloat(tokens[i++]) : 0;
  }

  while (i < tokens.length) {
    let cmd = tokens[i];

    // If it's not a letter, repeat the last command
    if (!/[a-zA-Z]/.test(cmd)) {
      cmd = lastCmd;
    } else {
      i++;
    }

    const isRelative = cmd === cmd.toLowerCase();
    const CMD = cmd.toUpperCase();

    switch (CMD) {
      case "M": {
        const x = nextNum() + (isRelative ? curX : 0);
        const y = nextNum() + (isRelative ? curY : 0);
        commands.push(["M", x, y]);
        curX = startX = x;
        curY = startY = y;
        // Subsequent coordinates after M are treated as L
        lastCmd = isRelative ? "l" : "L";
        continue;
      }
      case "L": {
        const x = nextNum() + (isRelative ? curX : 0);
        const y = nextNum() + (isRelative ? curY : 0);
        commands.push(["L", x, y]);
        curX = x; curY = y;
        break;
      }
      case "H": {
        const x = nextNum() + (isRelative ? curX : 0);
        commands.push(["L", x, curY]);
        curX = x;
        break;
      }
      case "V": {
        const y = nextNum() + (isRelative ? curY : 0);
        commands.push(["L", curX, y]);
        curY = y;
        break;
      }
      case "C": {
        const x1 = nextNum() + (isRelative ? curX : 0);
        const y1 = nextNum() + (isRelative ? curY : 0);
        const x2 = nextNum() + (isRelative ? curX : 0);
        const y2 = nextNum() + (isRelative ? curY : 0);
        const x = nextNum() + (isRelative ? curX : 0);
        const y = nextNum() + (isRelative ? curY : 0);
        commands.push(["C", x1, y1, x2, y2, x, y]);
        lastCpX = x2; lastCpY = y2;
        curX = x; curY = y;
        break;
      }
      case "S": {
        // Smooth cubic: reflect last control point
        const cpX = 2 * curX - lastCpX;
        const cpY = 2 * curY - lastCpY;
        const x2 = nextNum() + (isRelative ? curX : 0);
        const y2 = nextNum() + (isRelative ? curY : 0);
        const x = nextNum() + (isRelative ? curX : 0);
        const y = nextNum() + (isRelative ? curY : 0);
        commands.push(["C", cpX, cpY, x2, y2, x, y]);
        lastCpX = x2; lastCpY = y2;
        curX = x; curY = y;
        break;
      }
      case "Q": {
        const x1 = nextNum() + (isRelative ? curX : 0);
        const y1 = nextNum() + (isRelative ? curY : 0);
        const x = nextNum() + (isRelative ? curX : 0);
        const y = nextNum() + (isRelative ? curY : 0);
        commands.push(["Q", x1, y1, x, y]);
        lastCpX = x1; lastCpY = y1;
        curX = x; curY = y;
        break;
      }
      case "T": {
        // Smooth quadratic: reflect last control point
        const cpX = 2 * curX - lastCpX;
        const cpY = 2 * curY - lastCpY;
        const x = nextNum() + (isRelative ? curX : 0);
        const y = nextNum() + (isRelative ? curY : 0);
        commands.push(["Q", cpX, cpY, x, y]);
        lastCpX = cpX; lastCpY = cpY;
        curX = x; curY = y;
        break;
      }
      case "A": {
        // Arc — skip the parameters but advance cursor
        nextNum(); // rx
        nextNum(); // ry
        nextNum(); // x-rotation
        nextNum(); // large-arc-flag
        nextNum(); // sweep-flag
        const x = nextNum() + (isRelative ? curX : 0);
        const y = nextNum() + (isRelative ? curY : 0);
        // Approximate arc as a line (proper arc→bezier conversion is complex)
        commands.push(["L", x, y]);
        curX = x; curY = y;
        break;
      }
      case "Z": {
        commands.push(["Z"]);
        curX = startX; curY = startY;
        break;
      }
      default:
        // Unknown command, skip
        i++;
        break;
    }

    lastCmd = cmd;

    // Reset reflected control point for non-curve commands
    if (CMD !== "C" && CMD !== "S" && CMD !== "Q" && CMD !== "T") {
      lastCpX = curX; lastCpY = curY;
    }
  }

  return commands;
}

/** Tokenize SVG path d string into command letters and numbers. */
function tokenize(d: string): string[] {
  const tokens: string[] = [];
  // Split on command letters, keeping them, and on number boundaries
  const re = /([a-zA-Z])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

// --- Path utilities ---

interface Bounds {
  minX: number; minY: number; maxX: number; maxY: number;
}

function pathBounds(commands: PathCommand[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function include(x: number, y: number) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  for (const cmd of commands) {
    switch (cmd[0]) {
      case "M":
      case "L":
        include(cmd[1], cmd[2]);
        break;
      case "C":
        include(cmd[1], cmd[2]);
        include(cmd[3], cmd[4]);
        include(cmd[5], cmd[6]);
        break;
      case "Q":
        include(cmd[1], cmd[2]);
        include(cmd[3], cmd[4]);
        break;
    }
  }

  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function offsetPath(commands: PathCommand[], dx: number, dy: number): PathCommand[] {
  return commands.map((cmd): PathCommand => {
    switch (cmd[0]) {
      case "M": return ["M", cmd[1] + dx, cmd[2] + dy];
      case "L": return ["L", cmd[1] + dx, cmd[2] + dy];
      case "C": return ["C", cmd[1] + dx, cmd[2] + dy, cmd[3] + dx, cmd[4] + dy, cmd[5] + dx, cmd[6] + dy];
      case "Q": return ["Q", cmd[1] + dx, cmd[2] + dy, cmd[3] + dx, cmd[4] + dy];
      case "Z": return ["Z"];
    }
  });
}

function num(el: Element, attr: string): number {
  return parseFloat(el.getAttribute(attr) || "0") || 0;
}
