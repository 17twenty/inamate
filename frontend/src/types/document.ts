export interface InDocument {
  project: Project;
  scenes: Record<string, Scene>;
  objects: Record<string, ObjectNode>;
  timelines: Record<string, Timeline>;
  tracks: Record<string, Track>;
  keyframes: Record<string, Keyframe>;
  assets: Record<string, Asset>;
}

export interface Project {
  id: string;
  name: string;
  version: number;
  fps: number;
  createdAt: string;
  updatedAt: string;
  scenes: string[];
  assets: string[];
  rootTimeline: string;
}

export interface Scene {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  root: string;
}

export type ObjectType =
  | "Group"
  | "ShapeRect"
  | "ShapeEllipse"
  | "VectorPath"
  | "RasterImage"
  | "Symbol"
  | "Text";

export interface Transform {
  x: number;
  y: number;
  sx: number;
  sy: number;
  r: number;
  ax: number;
  ay: number;
  skewX: number;
  skewY: number;
}

export interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

export interface ObjectNode {
  id: string;
  type: ObjectType;
  parent: string | null;
  children: string[];
  transform: Transform;
  style: Style;
  visible: boolean;
  locked: boolean;
  data:
    | VectorPathData
    | ShapeRectData
    | ShapeEllipseData
    | RasterImageData
    | SymbolData
    | TextData
    | Record<string, never>;
}

export type PathCommand =
  | ["M", number, number]
  | ["L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["Q", number, number, number, number]
  | ["Z"];

export interface VectorPathData {
  commands: PathCommand[];
}

export interface ShapeRectData {
  width: number;
  height: number;
}

export interface ShapeEllipseData {
  rx: number;
  ry: number;
}

export interface RasterImageData {
  assetId: string;
  width: number;
  height: number;
}

export interface SymbolData {
  timelineId: string;
  loop?: boolean;
}

export interface TextData {
  content: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: "normal" | "bold";
  textAlign: "left" | "center" | "right";
}

export interface Timeline {
  id: string;
  length: number;
  tracks: string[];
}

export interface Track {
  id: string;
  objectId: string;
  property: string;
  keys: string[];
}

export type EasingType =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "cubicIn"
  | "cubicOut"
  | "cubicInOut"
  | "backIn"
  | "backOut"
  | "backInOut"
  | "elasticOut"
  | "bounceOut";

export interface Keyframe {
  id: string;
  frame: number;
  value: number | string;
  easing: EasingType;
}

export interface Asset {
  id: string;
  type: "svg" | "png" | "jpg" | "audio" | "video";
  name: string;
  url: string;
  meta: Record<string, unknown>;
}
