/**
 * CommandDispatcher - Central hub for all document mutations.
 *
 * All edits flow through here, enabling:
 * - Optimistic updates (instant local response)
 * - Undo/redo (local stack)
 * - Backend sync (WebSocket, when connected)
 * - Collaboration (operation broadcasting)
 */

import { useEditorStore } from "../stores/editorStore";
import type {
  Operation,
  OperationInput,
  OperationAck,
  OperationNack,
  OperationBroadcast,
  TransformObjectOp,
  UpdateStyleOp,
  DeleteObjectOp,
  CreateObjectOp,
  ReparentObjectOp,
  SetVisibilityOp,
  SetLockedOp,
  CreateTrackOp,
  DeleteTrackOp,
  UpdateTimelineOp,
  UpdateSceneOp,
  CreateSceneOp,
  DeleteSceneOp,
  AddKeyframeOp,
  UpdateKeyframeOp,
  DeleteKeyframeOp,
} from "../types/operations";
import type { Message } from "../types/protocol";

// Maximum undo history size
const MAX_UNDO_STACK = 100;

class CommandDispatcher {
  private pendingOps = new Map<string, Operation>();
  private clientSeq = 0;
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];
  private sendFn: ((msg: Message) => void) | null = null;

  /**
   * Set the WebSocket send function for backend sync.
   * Call this when WebSocket connects.
   */
  setSendFunction(fn: ((msg: Message) => void) | null): void {
    this.sendFn = fn;
  }

  /**
   * Dispatch an operation.
   * 1. Adds metadata (id, timestamp, seq)
   * 2. Captures previous state for undo
   * 3. Applies optimistically to store
   * 4. Adds to undo stack
   * 5. Sends to backend if connected
   */
  dispatch<T extends Operation>(input: OperationInput<T>): void {
    const store = useEditorStore.getState();
    const doc = store.document;
    if (!doc) return;

    // Add metadata
    const op: Operation = {
      ...input,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      clientSeq: ++this.clientSeq,
    } as Operation;

    // Capture previous state for undo
    const opWithPrevious = this.capturePreviousState(op, doc);

    // Apply optimistically to store
    this.applyOperation(opWithPrevious);

    // Add to undo stack
    this.undoStack.push(opWithPrevious);
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }

    // Clear redo stack on new operation
    this.redoStack = [];

    // Send to backend if connected
    if (this.sendFn) {
      this.pendingOps.set(op.id, opWithPrevious);
      this.sendFn({
        type: "op.submit",
        payload: opWithPrevious,
      });
    }
  }

  /**
   * Handle ACK from server - operation confirmed.
   */
  handleAck(ack: OperationAck): void {
    this.pendingOps.delete(ack.operationId);
    // Operation is now confirmed - nothing else to do
    // Server seq could be stored for conflict resolution
  }

  /**
   * Handle NACK from server - operation rejected.
   * Rollback the optimistic update.
   */
  handleNack(nack: OperationNack): void {
    const op = this.pendingOps.get(nack.operationId);
    if (op) {
      // Rollback by applying inverse
      const inverse = this.invertOperation(op);
      if (inverse) {
        this.applyOperation(inverse);
      }
      this.pendingOps.delete(nack.operationId);

      // Remove from undo stack
      const idx = this.undoStack.findIndex((o) => o.id === op.id);
      if (idx !== -1) {
        this.undoStack.splice(idx, 1);
      }

      console.warn(`Operation rejected: ${nack.reason}`);
    }
  }

  /**
   * Handle operation broadcast from another client.
   */
  handleRemoteOp(broadcast: OperationBroadcast): void {
    // Apply the remote operation
    this.applyOperation(broadcast.operation);

    // Don't add to our undo stack - it's not our operation
  }

  /**
   * Undo the last operation.
   */
  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;

    // Generate and apply inverse
    const inverse = this.invertOperation(op);
    if (!inverse) {
      // Can't invert - put it back
      this.undoStack.push(op);
      return false;
    }

    this.applyOperation(inverse);
    this.redoStack.push(op);

    // Send inverse to backend
    if (this.sendFn) {
      const inverseWithMeta: Operation = {
        ...inverse,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        clientSeq: ++this.clientSeq,
      } as Operation;
      this.sendFn({
        type: "op.submit",
        payload: inverseWithMeta,
      });
    }

    return true;
  }

  /**
   * Redo the last undone operation.
   */
  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;

    // Reapply the original operation
    this.applyOperation(op);
    this.undoStack.push(op);

    // Send to backend
    if (this.sendFn) {
      const opWithMeta: Operation = {
        ...op,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        clientSeq: ++this.clientSeq,
      } as Operation;
      this.sendFn({
        type: "op.submit",
        payload: opWithMeta,
      });
    }

    return true;
  }

  /**
   * Check if undo is available.
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clear undo/redo history (e.g., on document load).
   */
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingOps.clear();
  }

  // --- Private Methods ---

  /**
   * Capture previous state for undo support.
   */
  private capturePreviousState(
    op: Operation,
    doc: NonNullable<ReturnType<typeof useEditorStore.getState>["document"]>,
  ): Operation {
    switch (op.type) {
      case "object.transform": {
        const obj = doc.objects[op.objectId];
        if (obj) {
          return {
            ...op,
            previous: { ...obj.transform },
          } as TransformObjectOp;
        }
        break;
      }

      case "object.style": {
        const obj = doc.objects[op.objectId];
        if (obj) {
          return {
            ...op,
            previous: { ...obj.style },
          } as UpdateStyleOp;
        }
        break;
      }

      case "object.delete": {
        const obj = doc.objects[op.objectId];
        if (obj && obj.parent) {
          const parent = doc.objects[obj.parent];
          return {
            ...op,
            previous: { ...obj },
            previousParentChildren: parent ? [...parent.children] : undefined,
          } as DeleteObjectOp;
        }
        break;
      }

      case "object.reparent": {
        const obj = doc.objects[op.objectId];
        if (obj && obj.parent) {
          const oldParent = doc.objects[obj.parent];
          const oldIndex = oldParent?.children.indexOf(op.objectId) ?? -1;
          return {
            ...op,
            previousParentId: obj.parent,
            previousIndex: oldIndex >= 0 ? oldIndex : undefined,
          } as ReparentObjectOp;
        }
        break;
      }

      case "object.visibility": {
        const obj = doc.objects[op.objectId];
        if (obj) {
          return {
            ...op,
            previous: obj.visible,
          } as SetVisibilityOp;
        }
        break;
      }

      case "object.locked": {
        const obj = doc.objects[op.objectId];
        if (obj) {
          return {
            ...op,
            previous: obj.locked,
          } as SetLockedOp;
        }
        break;
      }

      case "scene.update": {
        const scene = doc.scenes[op.sceneId];
        if (scene) {
          const previous: UpdateSceneOp["previous"] = {};
          if (op.changes.name !== undefined) previous.name = scene.name;
          if (op.changes.width !== undefined) previous.width = scene.width;
          if (op.changes.height !== undefined) previous.height = scene.height;
          if (op.changes.background !== undefined)
            previous.background = scene.background;
          return {
            ...op,
            previous,
          } as UpdateSceneOp;
        }
        break;
      }

      case "track.create": {
        // No previous state needed for create - inverse is delete
        return op;
      }

      case "track.delete": {
        const track = doc.tracks[op.trackId];
        if (track) {
          return {
            ...op,
            previous: { ...track },
          } as DeleteTrackOp;
        }
        break;
      }

      case "keyframe.add": {
        // No previous state needed for add - inverse is delete
        return op;
      }

      case "keyframe.update": {
        const keyframe = doc.keyframes[op.keyframeId];
        if (keyframe) {
          return {
            ...op,
            previous: {
              frame: keyframe.frame,
              value: keyframe.value,
              easing: keyframe.easing,
            },
          } as UpdateKeyframeOp;
        }
        break;
      }

      case "keyframe.delete": {
        const keyframe = doc.keyframes[op.keyframeId];
        if (keyframe) {
          return {
            ...op,
            previous: { ...keyframe },
          } as DeleteKeyframeOp;
        }
        break;
      }

      case "timeline.update": {
        const timeline = doc.timelines[op.timelineId];
        if (timeline) {
          const previous: UpdateTimelineOp["previous"] = {};
          if (op.changes.length !== undefined)
            previous.length = timeline.length;
          return { ...op, previous } as UpdateTimelineOp;
        }
        break;
      }

      case "scene.create": {
        // No previous state needed for create - inverse is delete
        return op;
      }

      case "scene.delete": {
        const scene = doc.scenes[op.sceneId];
        if (scene) {
          const rootObject = doc.objects[scene.root];
          const sceneIndex = doc.project.scenes.indexOf(op.sceneId);
          return {
            ...op,
            previous: {
              scene: { ...scene },
              rootObject: rootObject ? { ...rootObject } : undefined,
              sceneIndex: sceneIndex >= 0 ? sceneIndex : 0,
            },
          } as DeleteSceneOp;
        }
        break;
      }
    }

    return op;
  }

  /**
   * Generate inverse operation for undo.
   */
  private invertOperation(op: Operation): Operation | null {
    switch (op.type) {
      case "object.transform": {
        if (!op.previous) return null;
        return {
          ...op,
          id: crypto.randomUUID(),
          transform: op.previous,
          previous: op.transform,
        };
      }

      case "object.style": {
        if (!op.previous) return null;
        return {
          ...op,
          id: crypto.randomUUID(),
          style: op.previous,
          previous: op.style,
        };
      }

      case "object.delete": {
        if (!op.previous) return null;
        // Inverse of delete is create
        return {
          id: crypto.randomUUID(),
          type: "object.create",
          timestamp: Date.now(),
          clientSeq: 0,
          object: op.previous,
          parentId: op.previous.parent || "",
        } as CreateObjectOp;
      }

      case "object.create": {
        // Inverse of create is delete
        return {
          id: crypto.randomUUID(),
          type: "object.delete",
          timestamp: Date.now(),
          clientSeq: 0,
          objectId: op.object.id,
          previous: op.object,
        } as DeleteObjectOp;
      }

      case "object.reparent": {
        if (!op.previousParentId) return null;
        return {
          ...op,
          id: crypto.randomUUID(),
          newParentId: op.previousParentId,
          newIndex: op.previousIndex ?? 0,
          previousParentId: op.newParentId,
          previousIndex: op.newIndex,
        };
      }

      case "object.visibility": {
        if (op.previous === undefined) return null;
        return {
          ...op,
          id: crypto.randomUUID(),
          visible: op.previous,
          previous: op.visible,
        };
      }

      case "object.locked": {
        if (op.previous === undefined) return null;
        return {
          ...op,
          id: crypto.randomUUID(),
          locked: op.previous,
          previous: op.locked,
        };
      }

      case "scene.update": {
        if (!op.previous) return null;
        return {
          ...op,
          id: crypto.randomUUID(),
          changes: op.previous,
          previous: op.changes,
        };
      }

      case "track.create": {
        // Inverse of create is delete
        return {
          id: crypto.randomUUID(),
          type: "track.delete",
          timestamp: Date.now(),
          clientSeq: 0,
          trackId: op.track.id,
          timelineId: op.timelineId,
          previous: op.track,
        } as DeleteTrackOp;
      }

      case "track.delete": {
        if (!op.previous) return null;
        // Inverse of delete is create
        return {
          id: crypto.randomUUID(),
          type: "track.create",
          timestamp: Date.now(),
          clientSeq: 0,
          track: op.previous,
          timelineId: op.timelineId,
        } as CreateTrackOp;
      }

      case "keyframe.add": {
        // Inverse of add is delete
        return {
          id: crypto.randomUUID(),
          type: "keyframe.delete",
          timestamp: Date.now(),
          clientSeq: 0,
          keyframeId: op.keyframe.id,
          trackId: op.trackId,
          previous: op.keyframe,
        } as DeleteKeyframeOp;
      }

      case "keyframe.update": {
        if (!op.previous) return null;
        return {
          ...op,
          id: crypto.randomUUID(),
          changes: op.previous,
          previous: op.changes,
        };
      }

      case "keyframe.delete": {
        if (!op.previous) return null;
        // Inverse of delete is add
        return {
          id: crypto.randomUUID(),
          type: "keyframe.add",
          timestamp: Date.now(),
          clientSeq: 0,
          trackId: op.trackId,
          keyframe: op.previous,
        } as AddKeyframeOp;
      }

      case "timeline.update": {
        if (!op.previous) return null;
        return {
          ...op,
          id: crypto.randomUUID(),
          changes: op.previous,
          previous: op.changes,
        };
      }

      case "scene.create": {
        // Inverse of create is delete
        return {
          id: crypto.randomUUID(),
          type: "scene.delete",
          timestamp: Date.now(),
          clientSeq: 0,
          sceneId: op.scene.id,
        } as DeleteSceneOp;
      }

      case "scene.delete": {
        if (!op.previous) return null;
        // Inverse of delete is create
        return {
          id: crypto.randomUUID(),
          type: "scene.create",
          timestamp: Date.now(),
          clientSeq: 0,
          scene: op.previous.scene,
          rootObject: op.previous.rootObject,
        } as CreateSceneOp;
      }

      default:
        return null;
    }
  }

  /**
   * Apply an operation to the store.
   */
  private applyOperation(op: Operation): void {
    const store = useEditorStore.getState();
    const doc = store.document;
    if (!doc) return;

    switch (op.type) {
      case "object.transform": {
        const obj = doc.objects[op.objectId];
        if (!obj) return;
        store.setDocument({
          ...doc,
          objects: {
            ...doc.objects,
            [op.objectId]: {
              ...obj,
              transform: { ...obj.transform, ...op.transform },
            },
          },
        });
        break;
      }

      case "object.style": {
        const obj = doc.objects[op.objectId];
        if (!obj) return;
        store.setDocument({
          ...doc,
          objects: {
            ...doc.objects,
            [op.objectId]: {
              ...obj,
              style: { ...obj.style, ...op.style },
            },
          },
        });
        break;
      }

      case "object.delete": {
        const obj = doc.objects[op.objectId];
        if (!obj) return;
        const newObjects = { ...doc.objects };
        delete newObjects[op.objectId];
        // Remove from parent's children
        if (obj.parent && newObjects[obj.parent]) {
          newObjects[obj.parent] = {
            ...newObjects[obj.parent],
            children: newObjects[obj.parent].children.filter(
              (id) => id !== op.objectId,
            ),
          };
        }
        store.setDocument({ ...doc, objects: newObjects });
        break;
      }

      case "object.create": {
        const newObjects = { ...doc.objects };
        newObjects[op.object.id] = op.object;
        // Add to parent's children (if not already present)
        if (op.parentId && newObjects[op.parentId]) {
          const parent = newObjects[op.parentId];
          // Check if child already exists to prevent duplicates
          if (!parent.children.includes(op.object.id)) {
            const children = [...parent.children];
            if (op.index !== undefined && op.index >= 0) {
              children.splice(op.index, 0, op.object.id);
            } else {
              children.push(op.object.id);
            }
            newObjects[op.parentId] = { ...parent, children };
          }
        }
        store.setDocument({ ...doc, objects: newObjects });
        break;
      }

      case "object.reparent": {
        const obj = doc.objects[op.objectId];
        if (!obj) return;
        const newObjects = { ...doc.objects };

        // Remove from old parent
        if (obj.parent && newObjects[obj.parent]) {
          const oldParent = newObjects[obj.parent];
          newObjects[obj.parent] = {
            ...oldParent,
            children: oldParent.children.filter((id) => id !== op.objectId),
          };
        }

        // Add to new parent
        if (newObjects[op.newParentId]) {
          const newParent = newObjects[op.newParentId];
          const children = [...newParent.children];
          children.splice(op.newIndex, 0, op.objectId);
          newObjects[op.newParentId] = { ...newParent, children };
        }

        // Update object's parent reference
        newObjects[op.objectId] = { ...obj, parent: op.newParentId };

        store.setDocument({ ...doc, objects: newObjects });
        break;
      }

      case "object.visibility": {
        const obj = doc.objects[op.objectId];
        if (!obj) return;
        store.setDocument({
          ...doc,
          objects: {
            ...doc.objects,
            [op.objectId]: { ...obj, visible: op.visible },
          },
        });
        break;
      }

      case "object.locked": {
        const obj = doc.objects[op.objectId];
        if (!obj) return;
        store.setDocument({
          ...doc,
          objects: {
            ...doc.objects,
            [op.objectId]: { ...obj, locked: op.locked },
          },
        });
        break;
      }

      case "scene.update": {
        const scene = doc.scenes[op.sceneId];
        if (!scene) return;
        store.setDocument({
          ...doc,
          scenes: {
            ...doc.scenes,
            [op.sceneId]: { ...scene, ...op.changes },
          },
        });
        break;
      }

      case "project.rename": {
        store.setDocument({
          ...doc,
          project: { ...doc.project, name: op.name },
        });
        break;
      }

      case "track.create": {
        const timeline = doc.timelines[op.timelineId];
        if (!timeline) return;

        // Add track to tracks map
        const newTracks = {
          ...doc.tracks,
          [op.track.id]: {
            id: op.track.id,
            objectId: op.track.objectId,
            property: op.track.property,
            keys: op.track.keys || [],
          },
        };

        // Add track ID to timeline's tracks array
        store.setDocument({
          ...doc,
          tracks: newTracks,
          timelines: {
            ...doc.timelines,
            [op.timelineId]: {
              ...timeline,
              tracks: [...timeline.tracks, op.track.id],
            },
          },
        });
        break;
      }

      case "track.delete": {
        const timeline = doc.timelines[op.timelineId];
        if (!timeline) return;

        // Remove track from tracks map
        const newTracks = { ...doc.tracks };
        delete newTracks[op.trackId];

        // Remove track ID from timeline's tracks array
        store.setDocument({
          ...doc,
          tracks: newTracks,
          timelines: {
            ...doc.timelines,
            [op.timelineId]: {
              ...timeline,
              tracks: timeline.tracks.filter((t) => t !== op.trackId),
            },
          },
        });
        break;
      }

      case "keyframe.add": {
        const newKeyframes = { ...doc.keyframes };
        newKeyframes[op.keyframe.id] = op.keyframe;

        // Add to track's keys array (maintain sorted order by frame)
        const track = doc.tracks[op.trackId];
        if (track) {
          // Check if keyframe already exists in track to prevent duplicates
          if (track.keys.includes(op.keyframe.id)) {
            // Already exists, just update the keyframe data
            store.setDocument({ ...doc, keyframes: newKeyframes });
            break;
          }

          const newKeys = [...track.keys];
          let insertIdx = newKeys.length;
          for (let i = 0; i < newKeys.length; i++) {
            const existingKey = doc.keyframes[newKeys[i]];
            if (existingKey && existingKey.frame > op.keyframe.frame) {
              insertIdx = i;
              break;
            }
          }
          newKeys.splice(insertIdx, 0, op.keyframe.id);

          store.setDocument({
            ...doc,
            keyframes: newKeyframes,
            tracks: {
              ...doc.tracks,
              [op.trackId]: { ...track, keys: newKeys },
            },
          });
        } else {
          store.setDocument({ ...doc, keyframes: newKeyframes });
        }
        break;
      }

      case "keyframe.update": {
        const keyframe = doc.keyframes[op.keyframeId];
        if (!keyframe) return;

        const updatedKeyframe = { ...keyframe, ...op.changes };
        const newKeyframes = {
          ...doc.keyframes,
          [op.keyframeId]: updatedKeyframe,
        };

        // If frame changed and trackId provided, re-sort the track's keys
        if (op.changes.frame !== undefined && op.trackId) {
          const track = doc.tracks[op.trackId];
          if (track) {
            // Remove keyframe from current position
            const keysWithoutThis = track.keys.filter(
              (k) => k !== op.keyframeId,
            );

            // Re-insert at correct sorted position
            let insertIdx = keysWithoutThis.length;
            for (let i = 0; i < keysWithoutThis.length; i++) {
              const existingKey = newKeyframes[keysWithoutThis[i]];
              if (existingKey && existingKey.frame > updatedKeyframe.frame) {
                insertIdx = i;
                break;
              }
            }
            const newKeys = [...keysWithoutThis];
            newKeys.splice(insertIdx, 0, op.keyframeId);

            store.setDocument({
              ...doc,
              keyframes: newKeyframes,
              tracks: {
                ...doc.tracks,
                [op.trackId]: { ...track, keys: newKeys },
              },
            });
            break;
          }
        }

        store.setDocument({ ...doc, keyframes: newKeyframes });
        break;
      }

      case "timeline.update": {
        const timeline = doc.timelines[op.timelineId];
        if (!timeline) return;
        store.setDocument({
          ...doc,
          timelines: {
            ...doc.timelines,
            [op.timelineId]: { ...timeline, ...op.changes },
          },
        });
        break;
      }

      case "scene.create": {
        // Guard against duplicate application
        if (doc.scenes[op.scene.id]) break;
        const newObjects = { ...doc.objects };
        newObjects[op.rootObject.id] = op.rootObject;
        store.setDocument({
          ...doc,
          scenes: {
            ...doc.scenes,
            [op.scene.id]: op.scene,
          },
          objects: newObjects,
          project: {
            ...doc.project,
            scenes: [...doc.project.scenes, op.scene.id],
          },
        });
        break;
      }

      case "scene.delete": {
        const scene = doc.scenes[op.sceneId];
        if (!scene) return;
        const newScenes = { ...doc.scenes };
        delete newScenes[op.sceneId];
        const newObjects = { ...doc.objects };
        delete newObjects[scene.root];
        store.setDocument({
          ...doc,
          scenes: newScenes,
          objects: newObjects,
          project: {
            ...doc.project,
            scenes: doc.project.scenes.filter((id) => id !== op.sceneId),
          },
        });
        break;
      }

      case "keyframe.delete": {
        const newKeyframes = { ...doc.keyframes };
        delete newKeyframes[op.keyframeId];

        // Remove from track's keys
        const track = doc.tracks[op.trackId];
        if (track) {
          store.setDocument({
            ...doc,
            keyframes: newKeyframes,
            tracks: {
              ...doc.tracks,
              [op.trackId]: {
                ...track,
                keys: track.keys.filter((k) => k !== op.keyframeId),
              },
            },
          });
        } else {
          store.setDocument({ ...doc, keyframes: newKeyframes });
        }
        break;
      }
    }
  }
}

// Singleton instance
export const commandDispatcher = new CommandDispatcher();
