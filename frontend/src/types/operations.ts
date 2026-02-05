/**
 * Operation types for document mutations.
 * All edits flow through the command dispatcher as operations.
 * Operations capture previous state for undo/redo.
 */

import type { Transform, Style, ObjectNode, Keyframe } from "./document";

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

// --- Keyframe Operations ---

export interface AddKeyframeOp extends BaseOperation {
  type: "keyframe.add";
  trackId: string;
  keyframe: Keyframe;
}

export interface UpdateKeyframeOp extends BaseOperation {
  type: "keyframe.update";
  keyframeId: string;
  changes: Partial<Keyframe>;
  previous?: Partial<Keyframe>; // For undo
}

export interface DeleteKeyframeOp extends BaseOperation {
  type: "keyframe.delete";
  keyframeId: string;
  trackId: string; // Needed to remove from track.keys
  previous?: Keyframe; // Full keyframe for undo
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
  | AddKeyframeOp
  | UpdateKeyframeOp
  | DeleteKeyframeOp
  | UpdateSceneOp
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
