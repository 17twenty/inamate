/**
 * Operation types for document mutations.
 * All edits flow through the command dispatcher as operations.
 * Operations capture previous state for undo/redo.
 */

import type {
  Transform,
  Style,
  ObjectNode,
  Keyframe,
  Scene,
  Asset,
} from "./document";

// Base operation interface - all operations extend this
export interface BaseOperation {
  id: string; // UUID, client-generated
  type: string; // Discriminator for operation type
  timestamp: number; // Client timestamp (ms since epoch)
  clientSeq: number; // Monotonic sequence for ordering
}

// --- Object Operations ---

export interface TransformObjectOp extends BaseOperation {
  type: "object.transform";
  objectId: string;
  transform: Partial<Transform>;
  previous?: Partial<Transform>; // For undo
}

export interface UpdateStyleOp extends BaseOperation {
  type: "object.style";
  objectId: string;
  style: Partial<Style>;
  previous?: Partial<Style>; // For undo
}

export interface DeleteObjectOp extends BaseOperation {
  type: "object.delete";
  objectId: string;
  previous?: ObjectNode; // Full object for undo
  previousParentChildren?: string[]; // Parent's children array for undo
}

export interface CreateObjectOp extends BaseOperation {
  type: "object.create";
  object: ObjectNode;
  parentId: string;
  index?: number; // Insert position in parent's children
  asset?: Asset; // Bundled asset (for RasterImage creates)
}

export interface ReparentObjectOp extends BaseOperation {
  type: "object.reparent";
  objectId: string;
  newParentId: string;
  newIndex: number;
  previousParentId?: string; // For undo
  previousIndex?: number; // For undo
}

export interface SetVisibilityOp extends BaseOperation {
  type: "object.visibility";
  objectId: string;
  visible: boolean;
  previous?: boolean; // For undo
}

export interface SetLockedOp extends BaseOperation {
  type: "object.locked";
  objectId: string;
  locked: boolean;
  previous?: boolean; // For undo
}

export interface UpdateDataOp extends BaseOperation {
  type: "object.data";
  objectId: string;
  data: Record<string, unknown>;
  previous?: Record<string, unknown>; // For undo
}

// --- Track Operations ---

export interface CreateTrackOp extends BaseOperation {
  type: "track.create";
  track: {
    id: string;
    objectId: string;
    property: string;
    keys: string[];
  };
  timelineId: string;
}

export interface DeleteTrackOp extends BaseOperation {
  type: "track.delete";
  trackId: string;
  timelineId: string;
  previous?: {
    id: string;
    objectId: string;
    property: string;
    keys: string[];
  };
}

// --- Keyframe Operations ---

export interface AddKeyframeOp extends BaseOperation {
  type: "keyframe.add";
  trackId: string;
  keyframe: Keyframe;
}

export interface UpdateKeyframeOp extends BaseOperation {
  type: "keyframe.update";
  keyframeId: string;
  trackId?: string; // Optional, needed when frame changes for re-sorting
  changes: Partial<Keyframe>;
  previous?: Partial<Keyframe>; // For undo
}

export interface DeleteKeyframeOp extends BaseOperation {
  type: "keyframe.delete";
  keyframeId: string;
  trackId: string; // Needed to remove from track.keys
  previous?: Keyframe; // Full keyframe for undo
}

// --- Timeline Operations ---

export interface UpdateTimelineOp extends BaseOperation {
  type: "timeline.update";
  timelineId: string;
  changes: { length?: number };
  previous?: { length?: number };
}

// --- Scene Operations ---

export interface UpdateSceneOp extends BaseOperation {
  type: "scene.update";
  sceneId: string;
  changes: {
    name?: string;
    width?: number;
    height?: number;
    background?: string;
  };
  previous?: {
    name?: string;
    width?: number;
    height?: number;
    background?: string;
  };
}

export interface CreateSceneOp extends BaseOperation {
  type: "scene.create";
  scene: Scene;
  rootObject: ObjectNode;
}

export interface DeleteSceneOp extends BaseOperation {
  type: "scene.delete";
  sceneId: string;
  previous?: {
    scene: Scene;
    rootObject: ObjectNode;
    sceneIndex: number;
  };
}

// --- Project Operations ---

export interface RenameProjectOp extends BaseOperation {
  type: "project.rename";
  name: string;
  previous?: string; // For undo
}

// Union type of all operations
export type Operation =
  | TransformObjectOp
  | UpdateStyleOp
  | DeleteObjectOp
  | CreateObjectOp
  | ReparentObjectOp
  | SetVisibilityOp
  | SetLockedOp
  | UpdateDataOp
  | CreateTrackOp
  | DeleteTrackOp
  | AddKeyframeOp
  | UpdateKeyframeOp
  | DeleteKeyframeOp
  | UpdateTimelineOp
  | UpdateSceneOp
  | CreateSceneOp
  | DeleteSceneOp
  | RenameProjectOp;

// --- Server Response Types ---

export interface OperationAck {
  operationId: string;
  serverSeq: number; // Authoritative sequence number
  serverTimestamp: number;
}

export interface OperationNack {
  operationId: string;
  reason: string;
  conflictingOp?: Operation; // For conflict resolution
}

export interface OperationBroadcast {
  operation: Operation;
  userId: string;
  serverSeq: number;
}

// --- Helper Types ---

// Operation without metadata (for dispatching)
export type OperationInput<T extends Operation = Operation> = Omit<
  T,
  "id" | "timestamp" | "clientSeq"
>;

// Type guard helpers
export function isTransformOp(op: Operation): op is TransformObjectOp {
  return op.type === "object.transform";
}

export function isStyleOp(op: Operation): op is UpdateStyleOp {
  return op.type === "object.style";
}

export function isDeleteOp(op: Operation): op is DeleteObjectOp {
  return op.type === "object.delete";
}

export function isCreateOp(op: Operation): op is CreateObjectOp {
  return op.type === "object.create";
}

export function isReparentOp(op: Operation): op is ReparentObjectOp {
  return op.type === "object.reparent";
}
