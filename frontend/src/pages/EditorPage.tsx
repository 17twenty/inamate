import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useAuthStore } from "../stores/authStore";
import { useEditorStore } from "../stores/editorStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { usePresence } from "../hooks/usePresence";
import { Stage } from "../engine/Stage";
import { commandDispatcher } from "../engine/commandDispatcher";
import {
  CanvasViewport,
  type DragType,
} from "../components/canvas/CanvasViewport";
import type { Bounds } from "../engine/commands";
import { Toolbar, type Tool } from "../components/editor/Toolbar";
import { PropertiesPanel } from "../components/editor/PropertiesPanel";
import { TimelinePanel } from "../components/editor/TimelinePanel";
import type { BreadcrumbEntry } from "../components/editor/TimelinePanel";
import { MenuBar } from "../components/editor/MenuBar";
import { getLatestSnapshot } from "../api/projects";
import { exportPngSequence, exportVideo } from "../utils/export";

import { MessageTypes } from "../types/protocol";
import type { Message } from "../types/protocol";
import type {
  OperationAckPayload,
  OperationNackPayload,
  OperationBroadcastPayload,
  ErrorPayload,
} from "../types/protocol";
import type {
  SymbolData,
  InDocument,
  ObjectNode,
  Transform,
  Keyframe,
  PathCommand,
  Asset,
} from "../types/document";

interface EditingContext {
  objectId: string | null; // null = scene root
  timelineId: string;
}

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  // Use playground project for anonymous editing
  const effectiveProjectId = projectId || "proj_playground";
  const {
    document: doc,
    setDocument,
    setConnected,
    setLocalUserId,
  } = useEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage>(new Stage());

  // Editor UI state
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{
    current: number;
    total: number;
    phase: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Editing context stack for nested Symbol editing
  const [editingStack, setEditingStack] = useState<EditingContext[]>([]);

  // Derived convenience for single-selection cases
  const singleSelectedId =
    selectedObjectIds.length === 1 ? selectedObjectIds[0] : null;

  // Active scene (for multi-scene support)
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);

  // Track modifier key states
  const shiftHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Drag state
  const dragRef = useRef<{
    objectIds: string[];
    dragType: DragType;
    startX: number;
    startY: number;
    // Animated transforms at drag start (visual positions, used for drag math)
    origTransforms: Map<string, Transform>;
    // Latest overlay transforms (for reading final position at drag end)
    lastOverlay: Record<string, Transform>;
    // Bounds at drag start (for scale/rotate calculations, single object only)
    bounds: Bounds | null;
    // Original object dimensions (for scale calculations)
    origWidth: number;
    origHeight: number;
  } | null>(null);

  // Stable send ref for WS
  const sendRef = useRef<(msg: Message) => void>(() => {});
  const stableSend = useCallback((msg: Message) => sendRef.current(msg), []);
  const { handleMessage } = usePresence(stableSend, effectiveProjectId);

  // Handle incoming WebSocket messages (presence + operations + doc sync)
  const handleWsMessage = useCallback(
    (msg: Message) => {
      // Handle welcome message (tells us our userId)
      if (msg.type === MessageTypes.WELCOME) {
        const welcome = msg.payload as { userId: string; displayName: string };
        setLocalUserId(welcome.userId);
        return;
      }

      // Handle error message (e.g., document load failed)
      if (msg.type === MessageTypes.ERROR) {
        const error = msg.payload as ErrorPayload;
        setLoadError(error.message);
        return;
      }

      // Handle document sync (sent when client joins)
      if (msg.type === MessageTypes.DOC_SYNC) {
        const syncedDoc = msg.payload as InDocument;
        setDocument(syncedDoc);
        stageRef.current.loadDocument(syncedDoc);
        setLoadError(null); // Clear any previous error
        return;
      }

      // Handle operation messages
      switch (msg.type) {
        case MessageTypes.OP_ACK:
          commandDispatcher.handleAck(msg.payload as OperationAckPayload);
          return;
        case MessageTypes.OP_NACK:
          commandDispatcher.handleNack(msg.payload as OperationNackPayload);
          return;
        case MessageTypes.OP_BROADCAST:
          commandDispatcher.handleRemoteOp(
            msg.payload as OperationBroadcastPayload,
          );
          return;
      }
      // Handle presence messages
      handleMessage(msg);
    },
    [handleMessage, setDocument, setLocalUserId],
  );

  const { connected, send } = useWebSocket(
    effectiveProjectId,
    token, // Can be null for local mode
    handleWsMessage,
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Wire command dispatcher to WebSocket
  useEffect(() => {
    commandDispatcher.setSendFunction(connected ? send : null);
  }, [connected, send]);

  // Clear command history when document changes (new document loaded)
  useEffect(() => {
    commandDispatcher.clearHistory();
  }, [doc?.project.id]);

  // Undo/Redo keyboard shortcuts + modifier key tracking
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Track shift key for scale modifier
      if (e.key === "Shift") {
        shiftHeldRef.current = true;
      }

      // Track space key for pan mode
      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      }

      // Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          // Redo: Cmd+Shift+Z
          commandDispatcher.redo();
        } else {
          // Undo: Cmd+Z
          commandDispatcher.undo();
        }
      }
      // Alternative Redo: Cmd+Y (Windows convention)
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        commandDispatcher.redo();
      }

      // Tool keyboard shortcuts (skip when typing in inputs or with modifiers)
      const target = e.target as HTMLElement;
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        target.tagName !== "INPUT" &&
        target.tagName !== "TEXTAREA"
      ) {
        const toolMap: Record<string, Tool> = {
          v: "select",
          a: "subselect",
          r: "rect",
          o: "ellipse",
          p: "pen",
          l: "line",
          h: "hand",
          s: "shear",
          z: "zoom",
        };
        const tool = toolMap[e.key.toLowerCase()];
        if (tool) {
          e.preventDefault();
          setActiveTool(tool);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftHeldRef.current = false;
      }
      if (e.key === " ") {
        setSpaceHeld(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Wire Stage events to React state
  useEffect(() => {
    stageRef.current.setEvents({
      onFrameChange: (frame) => {
        setCurrentFrame(frame);
      },
      onPlayStateChange: (playing) => {
        setIsPlaying(playing);
        if (!playing) {
          setCurrentFrame(stageRef.current.getCurrentFrame());
        }
      },
    });
  }, []);

  // Load document - from API for authenticated projects only
  // Anonymous/local users receive their document via WebSocket doc.sync message
  useEffect(() => {
    if (projectId && token) {
      // Authenticated project - load from API
      getLatestSnapshot(projectId)
        .then((snapshot) => {
          setDocument(snapshot);
          stageRef.current.loadDocument(snapshot);
        })
        .catch(() => {
          navigate("/projects");
        });
    }
    // For local mode (!projectId), document comes from WebSocket doc.sync
  }, [projectId, token, setDocument, navigate]);

  // Initialize editing stack and active scene when document loads
  useEffect(() => {
    if (!doc) return;
    if (editingStack.length === 0) {
      setEditingStack([
        { objectId: null, timelineId: doc.project.rootTimeline },
      ]);
    }
    if (!activeSceneId && doc.project.scenes.length > 0) {
      setActiveSceneId(doc.project.scenes[0]);
    }
  }, [doc, editingStack.length, activeSceneId]);

  // Scene metadata (for layout) - get from document directly, not WASM
  // Defined early because callbacks below depend on it
  const scene = useMemo(() => {
    if (!doc) return null;
    const sceneId = activeSceneId || doc.project.scenes[0];
    return sceneId ? doc.scenes[sceneId] : null;
  }, [doc, activeSceneId]);

  // Reload engine when document changes (e.g. from drag moves, keyframe recording)
  const docVersionRef = useRef(0);
  useEffect(() => {
    if (!doc) return;
    docVersionRef.current++;
    // Skip first load — already loaded in the effect above
    if (docVersionRef.current <= 1) return;
    // Use updateDocument to preserve playback state (frame position, playing flag)
    stageRef.current.updateDocument(doc);
  }, [doc]);

  useEffect(() => {
    setConnected(connected);
  }, [connected, setConnected]);

  // Sync selection to Stage (so it renders the outline imperatively)
  useEffect(() => {
    stageRef.current.setSelectedObjectIds(selectedObjectIds);
  }, [selectedObjectIds]);

  // Cursor presence send
  const sendCursor = useCallback(
    (x: number, y: number) => {
      sendRef.current({
        type: "presence.update",
        projectId: projectId || "",
        payload: { cursor: { x, y }, selection: [] },
      });
    },
    [projectId],
  );

  const lastCursorSend = useRef(0);
  const throttledSendCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      if (now - lastCursorSend.current < 60) return;
      lastCursorSend.current = now;
      sendCursor(x, y);
    },
    [sendCursor],
  );

  // --- Editing context ---

  const currentContext = useMemo(() => {
    if (editingStack.length === 0) return null;
    return editingStack[editingStack.length - 1];
  }, [editingStack]);

  const handleEnterSymbol = useCallback(
    (objectId: string) => {
      if (!doc) return;
      const obj = doc.objects[objectId];
      if (!obj || obj.type !== "Symbol") return;
      const symbolData = obj.data as SymbolData;
      if (!symbolData.timelineId) return;
      setEditingStack((prev) => [
        ...prev,
        { objectId, timelineId: symbolData.timelineId },
      ]);
      setSelectedObjectIds([]);
    },
    [doc],
  );

  const handleNavigateBreadcrumb = useCallback((index: number) => {
    setEditingStack((prev) => prev.slice(0, index + 1));
    setSelectedObjectIds([]);
  }, []);

  const breadcrumb: BreadcrumbEntry[] = useMemo(() => {
    if (!doc) return [];
    return editingStack.map((ctx) => {
      if (ctx.objectId === null) {
        return { id: null, name: scene?.name || "Scene 1" };
      }
      const obj = doc.objects[ctx.objectId];
      return { id: ctx.objectId, name: obj?.type || "Symbol" };
    });
  }, [doc, editingStack, scene]);

  // --- Canvas interaction callbacks ---

  const handleObjectClick = useCallback(
    (objectId: string | null, shiftKey: boolean) => {
      if (objectId === null) {
        setSelectedObjectIds([]);
        return;
      }
      if (shiftKey) {
        // Toggle in/out of selection
        setSelectedObjectIds((prev) =>
          prev.includes(objectId)
            ? prev.filter((id) => id !== objectId)
            : [...prev, objectId],
        );
      } else {
        setSelectedObjectIds([objectId]);
      }
    },
    [],
  );

  const handleMarqueeSelect = useCallback(
    (rect: { minX: number; minY: number; maxX: number; maxY: number }) => {
      if (!doc || !scene) return;
      const root = doc.objects[scene.root];
      if (!root) return;

      const selected: string[] = [];
      for (const childId of root.children) {
        const bounds = stageRef.current.getObjectWorldBounds(childId);
        if (!bounds) continue;
        // AABB intersection test
        if (
          bounds.minX <= rect.maxX &&
          bounds.maxX >= rect.minX &&
          bounds.minY <= rect.maxY &&
          bounds.maxY >= rect.minY
        ) {
          selected.push(childId);
        }
      }
      setSelectedObjectIds(selected);
    },
    [doc, scene],
  );

  const handleCanvasDoubleClick = useCallback(
    (objectId: string) => {
      if (!doc) return;
      const obj = doc.objects[objectId];
      if (obj && obj.type === "Symbol") {
        handleEnterSymbol(objectId);
      }
    },
    [doc, handleEnterSymbol],
  );

  const handleDragStart = useCallback(
    (
      objectId: string,
      x: number,
      y: number,
      dragType: DragType,
      bounds: Bounds | null,
    ) => {
      if (!doc) return;

      // For move, drag all selected objects; for scale/rotate, only the single object
      const objectIds =
        dragType === "move" ? [...selectedObjectIds] : [objectId];

      // Capture animated transforms (visual positions for drag math)
      const origTransforms = new Map<string, Transform>();
      const overlayTransforms: Record<string, Transform> = {};

      for (const id of objectIds) {
        const obj = doc.objects[id];
        if (!obj) continue;

        const animated = stageRef.current.getAnimatedTransform(id);
        if (animated) {
          const animTransform: Transform = {
            ...obj.transform, // preserve ax, ay
            x: animated.x,
            y: animated.y,
            sx: animated.sx,
            sy: animated.sy,
            r: animated.r,
            skewX: animated.skewX,
            skewY: animated.skewY,
          };
          origTransforms.set(id, animTransform);
          overlayTransforms[id] = animTransform;
        } else {
          origTransforms.set(id, { ...obj.transform });
          overlayTransforms[id] = { ...obj.transform };
        }
      }

      // Tell the engine to render dragged objects at their animated positions via overlay
      // No document mutation — other objects are completely unaffected
      stageRef.current.setDragOverlay(overlayTransforms);

      // Calculate original dimensions from bounds
      let origWidth = 0;
      let origHeight = 0;
      if (bounds) {
        origWidth = bounds.maxX - bounds.minX;
        origHeight = bounds.maxY - bounds.minY;
      }

      dragRef.current = {
        objectIds,
        dragType,
        startX: x,
        startY: y,
        origTransforms,
        lastOverlay: overlayTransforms,
        bounds,
        origWidth,
        origHeight,
      };
    },
    [doc, selectedObjectIds],
  );

  const handleDragMove = useCallback((x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag) return;

    const overlayUpdates: Record<string, Transform> = {};

    if (drag.dragType === "move") {
      // Multi-move: apply delta to all dragged objects
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      for (const id of drag.objectIds) {
        const orig = drag.origTransforms.get(id);
        if (orig) {
          overlayUpdates[id] = { ...orig, x: orig.x + dx, y: orig.y + dy };
        }
      }
    } else {
      // Scale/rotate: single object only
      const singleId = drag.objectIds[0];
      if (!singleId) return;
      const orig = drag.origTransforms.get(singleId);
      if (!orig) return;

      const newTransform = { ...orig };

      if (drag.dragType === "rotate") {
        // Rotation around object center
        if (drag.bounds) {
          const centerX = (drag.bounds.minX + drag.bounds.maxX) / 2;
          const centerY = (drag.bounds.minY + drag.bounds.maxY) / 2;

          const startAngle = Math.atan2(
            drag.startY - centerY,
            drag.startX - centerX,
          );
          const currentAngle = Math.atan2(y - centerY, x - centerX);
          const deltaAngle = currentAngle - startAngle;

          newTransform.r = orig.r + (deltaAngle * 180) / Math.PI;
        }
      } else if (drag.dragType === "anchor") {
        // Anchor point drag: move anchor in local space, compensate position
        // The mouse delta in scene space needs to be converted to anchor delta
        // For simplicity, we compute the new anchor as: orig_anchor + mouse_delta / scale
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        // Approximate local-space delta by dividing by scale and undoing rotation
        const cosR = Math.cos((-orig.r * Math.PI) / 180);
        const sinR = Math.sin((-orig.r * Math.PI) / 180);
        const localDx = (dx * cosR - dy * sinR) / orig.sx;
        const localDy = (dx * sinR + dy * cosR) / orig.sy;
        const newAx = orig.ax + localDx;
        const newAy = orig.ay + localDy;
        // Compensate position to keep visual placement stable
        newTransform.ax = newAx;
        newTransform.ay = newAy;
        newTransform.x = orig.x + dx;
        newTransform.y = orig.y + dy;
      } else if (drag.dragType === "shear") {
        // Shear: horizontal mouse delta = skewX, vertical = skewY
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        const sensitivity = 0.5; // degrees per pixel
        newTransform.skewX = (orig.skewX ?? 0) + dx * sensitivity;
        newTransform.skewY = (orig.skewY ?? 0) + dy * sensitivity;
      } else if (drag.dragType && drag.dragType.startsWith("scale-")) {
        // Scale from corner handle
        if (drag.bounds && drag.origWidth > 0 && drag.origHeight > 0) {
          const { minX, minY, maxX, maxY } = drag.bounds;

          const shiftHeld = shiftHeldRef.current;

          if (shiftHeld) {
            // Shift held: uniform scale from center
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const startDist = Math.hypot(
              drag.startX - centerX,
              drag.startY - centerY,
            );
            const currentDist = Math.hypot(x - centerX, y - centerY);

            if (startDist > 0) {
              const scaleFactor = currentDist / startDist;
              newTransform.sx = orig.sx * scaleFactor;
              newTransform.sy = orig.sy * scaleFactor;
            }
          } else {
            // No shift: scale from opposite corner
            const isDraggingLeft =
              drag.dragType === "scale-nw" || drag.dragType === "scale-sw";
            const isDraggingTop =
              drag.dragType === "scale-nw" || drag.dragType === "scale-ne";

            const fixedX = isDraggingLeft ? maxX : minX;
            const fixedY = isDraggingTop ? maxY : minY;

            const origDistX = drag.startX - fixedX;
            const origDistY = drag.startY - fixedY;
            const curDistX = x - fixedX;
            const curDistY = y - fixedY;

            const ratioX = Math.abs(origDistX) > 1 ? curDistX / origDistX : 1;
            const ratioY = Math.abs(origDistY) > 1 ? curDistY / origDistY : 1;

            newTransform.sx = orig.sx * Math.max(0.01, ratioX);
            newTransform.sy = orig.sy * Math.max(0.01, ratioY);

            const offsetX = (fixedX - orig.x) / orig.sx;
            const offsetY = (fixedY - orig.y) / orig.sy;
            newTransform.x = fixedX - offsetX * newTransform.sx;
            newTransform.y = fixedY - offsetY * newTransform.sy;
          }
        }
      }

      overlayUpdates[singleId] = newTransform;
    }

    // Update overlay and trigger re-render — no document mutation
    drag.lastOverlay = { ...drag.lastOverlay, ...overlayUpdates };
    stageRef.current.updateDragOverlay(overlayUpdates);
    stageRef.current.invalidate();
  }, []);

  // Keyframe-aware property update: when a track exists for a property at the
  // current frame, update/add the keyframe value instead of (or in addition to)
  // the base document value. This ensures edits from the Properties panel, drag
  // handles, and any other source all behave consistently for both transform and
  // style properties.
  const updateWithKeyframes = useCallback(
    (
      objectId: string,
      propertyValues: Record<string, number | string>,
    ): Set<string> => {
      const freshDoc = useEditorStore.getState().document;
      const frame = stageRef.current.getCurrentFrame();
      const timelineId = currentContext?.timelineId;
      const handled = new Set<string>();
      if (!freshDoc || !timelineId) return handled;

      const timeline = freshDoc.timelines[timelineId];
      if (!timeline) return handled;

      for (const [property, value] of Object.entries(propertyValues)) {
        const trackId = timeline.tracks.find((tid) => {
          const track = freshDoc.tracks[tid];
          return (
            track && track.objectId === objectId && track.property === property
          );
        });

        if (!trackId) continue;

        const track = freshDoc.tracks[trackId];
        if (!track) continue;

        const existingKeyframeId = track.keys.find((kfId) => {
          const kf = freshDoc.keyframes[kfId];
          return kf && kf.frame === frame;
        });

        if (existingKeyframeId) {
          commandDispatcher.dispatch({
            type: "keyframe.update",
            keyframeId: existingKeyframeId,
            trackId,
            changes: { value },
          });
        } else {
          commandDispatcher.dispatch({
            type: "keyframe.add",
            trackId,
            keyframe: {
              id: crypto.randomUUID(),
              frame,
              value,
              easing: "linear" as const,
            },
          });
        }

        handled.add(property);
      }

      return handled;
    },
    [currentContext],
  );

  // Convenience wrapper for transform-only updates (used by drag handlers)
  const updateTransformWithKeyframes = useCallback(
    (objectId: string, absoluteValues: Record<string, number>): void => {
      const handled = updateWithKeyframes(objectId, absoluteValues);

      // Update base document transform for properties NOT handled by keyframes
      const baseChanges: Record<string, number> = {};
      for (const [property, value] of Object.entries(absoluteValues)) {
        if (!handled.has(property)) {
          const key = property.replace("transform.", "");
          baseChanges[key] = value;
        }
      }
      if (Object.keys(baseChanges).length > 0) {
        commandDispatcher.dispatch({
          type: "object.transform",
          objectId,
          transform: baseChanges,
        });
      }
    },
    [updateWithKeyframes],
  );

  const handleDragEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.dragType === "move") {
      for (const id of drag.objectIds) {
        const animOrig = drag.origTransforms.get(id);
        const final = drag.lastOverlay[id];
        if (!animOrig || !final) continue;

        const dx = final.x - animOrig.x;
        const dy = final.y - animOrig.y;
        if (dx === 0 && dy === 0) continue;

        // Use absolute final animated values — the shared helper handles
        // keyframe update vs base transform dispatch automatically
        const updates: Record<string, number> = {};
        if (dx !== 0) updates["transform.x"] = final.x;
        if (dy !== 0) updates["transform.y"] = final.y;
        updateTransformWithKeyframes(id, updates);
      }
    } else {
      // Scale/rotate: single object
      const singleId = drag.objectIds[0];
      const animOrig = drag.origTransforms.get(singleId);
      const final = drag.lastOverlay[singleId];
      if (!animOrig || !final) {
        dragRef.current = null;
        stageRef.current.clearDragOverlay();
        return;
      }

      const hasChanged =
        final.x !== animOrig.x ||
        final.y !== animOrig.y ||
        final.sx !== animOrig.sx ||
        final.sy !== animOrig.sy ||
        final.r !== animOrig.r ||
        (final.skewX ?? 0) !== (animOrig.skewX ?? 0) ||
        (final.skewY ?? 0) !== (animOrig.skewY ?? 0);

      if (hasChanged) {
        const updates: Record<string, number> = {};
        if (drag.dragType === "rotate") {
          updates["transform.r"] = final.r;
        } else if (drag.dragType === "anchor") {
          updates["transform.ax"] = final.ax;
          updates["transform.ay"] = final.ay;
          updates["transform.x"] = final.x;
          updates["transform.y"] = final.y;
        } else if (drag.dragType === "shear") {
          updates["transform.skewX"] = final.skewX ?? 0;
          updates["transform.skewY"] = final.skewY ?? 0;
        } else if (drag.dragType && drag.dragType.startsWith("scale-")) {
          updates["transform.sx"] = final.sx;
          updates["transform.sy"] = final.sy;
          if (final.x !== animOrig.x) updates["transform.x"] = final.x;
          if (final.y !== animOrig.y) updates["transform.y"] = final.y;
        }
        updateTransformWithKeyframes(singleId, updates);
      }
    }

    // Dispatch updates the Zustand store synchronously, but the useEffect([doc])
    // that syncs to WASM fires asynchronously. Push the updated doc to WASM now
    // so that when we clear the overlay, the engine already has the new transforms.
    const updatedDoc = useEditorStore.getState().document;
    if (updatedDoc) {
      stageRef.current.updateDocument(updatedDoc);
    }

    // Now safe to clear — WASM has the new document with correct transforms
    stageRef.current.clearDragOverlay();

    dragRef.current = null;
  }, [updateTransformWithKeyframes]);

  // --- Playback controls (delegated to Stage) ---

  const togglePlay = useCallback(() => {
    stageRef.current.togglePlay();
  }, []);

  const handleFrameChange = useCallback((frame: number) => {
    stageRef.current.seek(frame);
  }, []);

  // --- Menu bar actions ---

  const handleDeleteObject = useCallback(() => {
    if (selectedObjectIds.length === 0) return;
    for (const id of selectedObjectIds) {
      commandDispatcher.dispatch({
        type: "object.delete",
        objectId: id,
      });
    }
    setSelectedObjectIds([]);
  }, [selectedObjectIds]);

  const handleSelectAll = useCallback(() => {
    if (!doc || !scene) return;
    const root = doc.objects[scene.root];
    if (root && root.children.length > 0) {
      setSelectedObjectIds([...root.children]);
    }
  }, [doc, scene]);

  const handleDeselect = useCallback(() => {
    setSelectedObjectIds([]);
  }, []);

  // --- Group / Ungroup ---

  const handleGroupSelection = useCallback(() => {
    if (!doc || !scene || selectedObjectIds.length < 2) return;
    const root = doc.objects[scene.root];
    if (!root) return;

    // Sort selected objects by their index in the parent's children array
    const sorted = [...selectedObjectIds].sort(
      (a, b) => root.children.indexOf(a) - root.children.indexOf(b),
    );

    // Compute combined bounds to determine group position
    let minX = Infinity,
      minY = Infinity;
    for (const id of sorted) {
      const obj = doc.objects[id];
      if (obj) {
        minX = Math.min(minX, obj.transform.x);
        minY = Math.min(minY, obj.transform.y);
      }
    }
    if (!isFinite(minX)) {
      minX = 0;
      minY = 0;
    }

    const groupId = crypto.randomUUID();
    const insertIndex = root.children.indexOf(sorted[0]);

    // Create the group object at the combined min corner
    commandDispatcher.dispatch({
      type: "object.create",
      object: {
        id: groupId,
        type: "Group",
        parent: scene.root,
        children: [],
        transform: {
          x: minX,
          y: minY,
          sx: 1,
          sy: 1,
          r: 0,
          ax: 0,
          ay: 0,
          skewX: 0,
          skewY: 0,
        },
        style: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
        visible: true,
        locked: false,
        data: {},
      },
      parentId: scene.root,
      index: insertIndex,
    });

    // Reparent each selected object into the group, adjusting position
    for (let i = 0; i < sorted.length; i++) {
      const id = sorted[i];
      const obj = doc.objects[id];
      if (!obj) continue;

      // Offset position so it's relative to the group
      commandDispatcher.dispatch({
        type: "object.transform",
        objectId: id,
        transform: {
          x: obj.transform.x - minX,
          y: obj.transform.y - minY,
        },
      });

      commandDispatcher.dispatch({
        type: "object.reparent",
        objectId: id,
        newParentId: groupId,
        newIndex: i,
      });
    }

    setSelectedObjectIds([groupId]);
  }, [doc, scene, selectedObjectIds]);

  const handleUngroupSelection = useCallback(() => {
    if (!doc || !scene || selectedObjectIds.length !== 1) return;
    const groupId = selectedObjectIds[0];
    const group = doc.objects[groupId];
    if (!group || group.type !== "Group" || !group.parent) return;

    const parent = doc.objects[group.parent];
    if (!parent) return;

    const groupIndex = parent.children.indexOf(groupId);
    const children = [...group.children];

    // Reparent each child back to the group's parent
    for (let i = 0; i < children.length; i++) {
      const childId = children[i];
      const child = doc.objects[childId];
      if (!child) continue;

      // Add group's position to child so visual position is preserved
      commandDispatcher.dispatch({
        type: "object.transform",
        objectId: childId,
        transform: {
          x: child.transform.x + group.transform.x,
          y: child.transform.y + group.transform.y,
        },
      });

      commandDispatcher.dispatch({
        type: "object.reparent",
        objectId: childId,
        newParentId: group.parent,
        newIndex: groupIndex + i,
      });
    }

    // Delete the empty group
    commandDispatcher.dispatch({
      type: "object.delete",
      objectId: groupId,
    });

    setSelectedObjectIds(children);
  }, [doc, scene, selectedObjectIds]);

  const handleDeleteAll = useCallback(() => {
    if (!doc || !scene) return;
    const root = doc.objects[scene.root];
    if (!root) return;

    // Delete all children of the root (all objects on canvas)
    for (const childId of [...root.children]) {
      commandDispatcher.dispatch({
        type: "object.delete",
        objectId: childId,
      });
    }
    setSelectedObjectIds([]);
  }, [doc, scene]);

  // --- Properties panel handlers ---

  const handleSceneUpdate = useCallback(
    (changes: Partial<typeof scene>) => {
      if (!scene) return;
      commandDispatcher.dispatch({
        type: "scene.update",
        sceneId: scene.id,
        changes,
      });
    },
    [scene],
  );

  const handleTimelineUpdate = useCallback(
    (frames: number) => {
      if (!currentContext) return;
      commandDispatcher.dispatch({
        type: "timeline.update",
        timelineId: currentContext.timelineId,
        changes: { length: frames },
      });
    },
    [currentContext],
  );

  // Ordered scene list for the timeline tabs
  const sceneList = useMemo(() => {
    if (!doc) return [];
    return doc.project.scenes.map((id) => doc.scenes[id]).filter(Boolean);
  }, [doc]);

  const handleCreateScene = useCallback(() => {
    if (!doc) return;
    const sceneId = crypto.randomUUID();
    const rootId = crypto.randomUUID();
    // Copy dimensions from current scene, or use defaults
    const width = scene?.width ?? 1280;
    const height = scene?.height ?? 720;
    const name = `Scene ${doc.project.scenes.length + 1}`;

    commandDispatcher.dispatch({
      type: "scene.create",
      scene: {
        id: sceneId,
        name,
        width,
        height,
        background: "#ffffff",
        root: rootId,
      },
      rootObject: {
        id: rootId,
        type: "Group",
        parent: null,
        children: [],
        transform: {
          x: 0,
          y: 0,
          sx: 1,
          sy: 1,
          r: 0,
          ax: 0,
          ay: 0,
          skewX: 0,
          skewY: 0,
        },
        style: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
        visible: true,
        locked: false,
        data: {},
      },
    });

    // Switch to new scene
    setActiveSceneId(sceneId);
    setSelectedObjectIds([]);
    setEditingStack([{ objectId: null, timelineId: doc.project.rootTimeline }]);
    stageRef.current.setScene(sceneId);
  }, [doc, scene]);

  const handleDeleteScene = useCallback(
    (sceneId: string) => {
      if (!doc || doc.project.scenes.length <= 1) return;
      commandDispatcher.dispatch({
        type: "scene.delete",
        sceneId,
      });

      // Switch to an adjacent scene
      const idx = doc.project.scenes.indexOf(sceneId);
      const nextId = doc.project.scenes[idx === 0 ? 1 : idx - 1];
      setActiveSceneId(nextId);
      setSelectedObjectIds([]);
      setEditingStack([
        { objectId: null, timelineId: doc.project.rootTimeline },
      ]);
      stageRef.current.setScene(nextId);
    },
    [doc],
  );

  const handleSwitchScene = useCallback(
    (sceneId: string) => {
      if (!doc) return;
      setActiveSceneId(sceneId);
      setSelectedObjectIds([]);
      setEditingStack([
        { objectId: null, timelineId: doc.project.rootTimeline },
      ]);
      stageRef.current.setScene(sceneId);
    },
    [doc],
  );

  const handleRenameScene = useCallback((sceneId: string, name: string) => {
    commandDispatcher.dispatch({
      type: "scene.update",
      sceneId,
      changes: { name },
    });
  }, []);

  const handleObjectUpdate = useCallback(
    (
      objectId: string,
      changes: {
        transform?: Partial<typeof selectedObject.transform>;
        style?: Partial<typeof selectedObject.style>;
      },
    ) => {
      if (changes.transform) {
        // Update keyframes if tracks exist for these properties
        const propertyValues: Record<string, number> = {};
        for (const [key, value] of Object.entries(changes.transform)) {
          if (typeof value === "number") {
            propertyValues[`transform.${key}`] = value;
          }
        }
        if (Object.keys(propertyValues).length > 0) {
          updateWithKeyframes(objectId, propertyValues);
        }

        // Always update the base document transform too — the Properties panel
        // reads from the document, so it needs to reflect the user's input.
        commandDispatcher.dispatch({
          type: "object.transform",
          objectId,
          transform: changes.transform,
        });
      }
      if (changes.style) {
        // Update keyframes if tracks exist for these properties
        const propertyValues: Record<string, number | string> = {};
        for (const [key, value] of Object.entries(changes.style)) {
          propertyValues[`style.${key}`] = value;
        }
        updateWithKeyframes(objectId, propertyValues);

        // Always update the base document style too — the Properties panel reads
        // from the document, so it needs to reflect the user's input even when
        // keyframes override the rendered value.
        commandDispatcher.dispatch({
          type: "object.style",
          objectId,
          style: changes.style,
        });
      }

      // Force-sync updated doc to WASM and invalidate so canvas updates immediately
      // rather than waiting for the async useEffect([doc]) cycle
      const updatedDoc = useEditorStore.getState().document;
      if (updatedDoc) {
        stageRef.current.updateDocument(updatedDoc);
      }
    },
    [updateWithKeyframes],
  );

  const handleDataUpdate = useCallback(
    (objectId: string, data: Record<string, unknown>) => {
      commandDispatcher.dispatch({
        type: "object.data",
        objectId,
        data,
      });

      // Force-sync updated doc to WASM so canvas updates immediately
      const updatedDoc = useEditorStore.getState().document;
      if (updatedDoc) {
        stageRef.current.updateDocument(updatedDoc);
      }
    },
    [],
  );

  // --- Object creation ---

  const handleCreateObject = useCallback(
    (x: number, y: number, tool: Tool) => {
      if (!doc || !scene) return;

      const objectId = crypto.randomUUID();
      const defaultSize = 100;

      // Build the new object based on tool type
      // Anchor point differs by shape type:
      // - Rectangles: path is (0,0) to (w,h), so anchor at center is (w/2, h/2)
      // - Ellipses: path is centered at (0,0), so anchor at center is (0, 0)
      const isEllipse = tool === "ellipse";
      const newObject: ObjectNode = {
        id: objectId,
        type: isEllipse ? "ShapeEllipse" : "ShapeRect",
        parent: scene.root,
        children: [],
        transform: {
          x: x - defaultSize / 2,
          y: y - defaultSize / 2,
          sx: 1,
          sy: 1,
          r: 0,
          ax: isEllipse ? 0 : defaultSize / 2,
          ay: isEllipse ? 0 : defaultSize / 2,
          skewX: 0,
          skewY: 0,
        },
        style: {
          fill: "#4a90d9",
          stroke: "#2d5a87",
          strokeWidth: 2,
          opacity: 1,
        },
        visible: true,
        locked: false,
        data:
          tool === "rect"
            ? { width: defaultSize, height: defaultSize }
            : { rx: defaultSize / 2, ry: defaultSize / 2 },
      };

      commandDispatcher.dispatch({
        type: "object.create",
        object: newObject,
        parentId: scene.root,
      });

      // Auto-select the new object and switch to select tool
      setSelectedObjectIds([objectId]);
      setActiveTool("select");
    },
    [doc, scene],
  );

  // --- Pen tool path creation ---

  const handleCreatePath = useCallback(
    (commands: PathCommand[]) => {
      if (!doc || !scene || commands.length === 0) return;

      // Calculate bounds of the path to determine position and anchor
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const cmd of commands) {
        if (cmd[0] === "M" || cmd[0] === "L") {
          minX = Math.min(minX, cmd[1]);
          minY = Math.min(minY, cmd[2]);
          maxX = Math.max(maxX, cmd[1]);
          maxY = Math.max(maxY, cmd[2]);
        } else if (cmd[0] === "C") {
          // Include all bezier control points
          minX = Math.min(minX, cmd[1], cmd[3], cmd[5]);
          minY = Math.min(minY, cmd[2], cmd[4], cmd[6]);
          maxX = Math.max(maxX, cmd[1], cmd[3], cmd[5]);
          maxY = Math.max(maxY, cmd[2], cmd[4], cmd[6]);
        } else if (cmd[0] === "Q") {
          minX = Math.min(minX, cmd[1], cmd[3]);
          minY = Math.min(minY, cmd[2], cmd[4]);
          maxX = Math.max(maxX, cmd[1], cmd[3]);
          maxY = Math.max(maxY, cmd[2], cmd[4]);
        }
      }

      // Normalize path commands relative to minX, minY
      const normalizedCommands: PathCommand[] = commands.map((cmd) => {
        switch (cmd[0]) {
          case "M":
            return ["M", cmd[1] - minX, cmd[2] - minY];
          case "L":
            return ["L", cmd[1] - minX, cmd[2] - minY];
          case "C":
            return [
              "C",
              cmd[1] - minX,
              cmd[2] - minY,
              cmd[3] - minX,
              cmd[4] - minY,
              cmd[5] - minX,
              cmd[6] - minY,
            ];
          case "Q":
            return [
              "Q",
              cmd[1] - minX,
              cmd[2] - minY,
              cmd[3] - minX,
              cmd[4] - minY,
            ];
          case "Z":
            return ["Z"];
          default:
            return cmd;
        }
      });

      const width = maxX - minX;
      const height = maxY - minY;

      const objectId = crypto.randomUUID();
      const newObject: ObjectNode = {
        id: objectId,
        type: "VectorPath",
        parent: scene.root,
        children: [],
        transform: {
          x: minX,
          y: minY,
          sx: 1,
          sy: 1,
          r: 0,
          ax: width / 2,
          ay: height / 2,
          skewX: 0,
          skewY: 0,
        },
        style: {
          fill: "none",
          stroke: "#4a90d9",
          strokeWidth: 2,
          opacity: 1,
        },
        visible: true,
        locked: false,
        data: {
          commands: normalizedCommands,
        },
      };

      commandDispatcher.dispatch({
        type: "object.create",
        object: newObject,
        parentId: scene.root,
      });

      // Auto-select the new object and switch to select tool
      setSelectedObjectIds([objectId]);
      setActiveTool("select");
    },
    [doc, scene],
  );

  // --- Image paste/drop ---

  const uploadAndCreateImage = useCallback(
    async (blob: Blob) => {
      if (!doc || !scene) return;

      // Upload to server
      const formData = new FormData();
      formData.append("file", blob);

      let resp: Response;
      try {
        resp = await fetch("/assets/upload", {
          method: "POST",
          body: formData,
        });
      } catch {
        console.error("Asset upload failed: network error");
        return;
      }
      if (!resp.ok) {
        console.error("Asset upload failed:", resp.status, await resp.text());
        return;
      }

      const result = (await resp.json()) as {
        id: string;
        url: string;
        width: number;
        height: number;
        type: string;
        name: string;
      };

      const objectId = crypto.randomUUID();

      const asset: Asset = {
        id: result.id,
        type: result.type as Asset["type"],
        name: result.name,
        url: result.url,
        meta: {},
      };

      const w = result.width;
      const h = result.height;

      const newObject: ObjectNode = {
        id: objectId,
        type: "RasterImage",
        parent: scene.root,
        children: [],
        transform: {
          x: (scene.width - w) / 2,
          y: (scene.height - h) / 2,
          sx: 1,
          sy: 1,
          r: 0,
          ax: w / 2,
          ay: h / 2,
          skewX: 0,
          skewY: 0,
        },
        style: {
          fill: "",
          stroke: "",
          strokeWidth: 0,
          opacity: 1,
        },
        visible: true,
        locked: false,
        data: { assetId: result.id, width: w, height: h },
      };

      commandDispatcher.dispatch({
        type: "object.create",
        object: newObject,
        parentId: scene.root,
        asset,
      });

      setSelectedObjectIds([objectId]);
      setActiveTool("select");
    },
    [doc, scene],
  );

  // Paste handler (Cmd+V with image on clipboard)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!doc || !scene) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          uploadAndCreateImage(blob);
          return;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [doc, scene, uploadAndCreateImage]);

  // Drag-and-drop handler for image files
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      if (!doc || !scene) return;
      const files = e.dataTransfer?.files;
      if (!files) return;

      for (const file of files) {
        if (file.type.startsWith("image/")) {
          uploadAndCreateImage(file);
          return; // One image at a time
        }
      }
    };

    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
    };
  }, [doc, scene, uploadAndCreateImage]);

  // --- Keyframe handlers ---

  // Helper to get property value from object
  const getPropertyValue = useCallback(
    (obj: ObjectNode, property: string): number | string => {
      switch (property) {
        case "transform.x":
          return obj.transform.x;
        case "transform.y":
          return obj.transform.y;
        case "transform.sx":
          return obj.transform.sx;
        case "transform.sy":
          return obj.transform.sy;
        case "transform.r":
          return obj.transform.r;
        case "transform.skewX":
          return obj.transform.skewX ?? 0;
        case "transform.skewY":
          return obj.transform.skewY ?? 0;
        case "style.opacity":
          return obj.style.opacity;
        case "style.fill":
          return obj.style.fill;
        case "style.stroke":
          return obj.style.stroke;
        case "style.strokeWidth":
          return obj.style.strokeWidth;
        default:
          return 0;
      }
    },
    [],
  );

  const handleAddKeyframe = useCallback(
    (objectId: string, frame: number, property: string) => {
      // Get fresh document state from store to avoid stale closure issues
      // when multiple keyframes are added in rapid succession
      const freshDoc = useEditorStore.getState().document;

      if (!freshDoc || !currentContext) return;

      const timeline = freshDoc.timelines[currentContext.timelineId];
      if (!timeline) return;

      const obj = freshDoc.objects[objectId];
      if (!obj) return;

      // Use the animated (visual) value for transform properties so that
      // recording a keyframe captures what the user sees on screen, not the
      // raw document base value which may differ from the interpolated position.
      let value: number | string = getPropertyValue(obj, property);
      if (property.startsWith("transform.")) {
        const animated = stageRef.current.getAnimatedTransform(objectId);
        if (animated) {
          switch (property) {
            case "transform.x":
              value = animated.x;
              break;
            case "transform.y":
              value = animated.y;
              break;
            case "transform.sx":
              value = animated.sx;
              break;
            case "transform.sy":
              value = animated.sy;
              break;
            case "transform.r":
              value = animated.r;
              break;
            case "transform.skewX":
              value = animated.skewX;
              break;
            case "transform.skewY":
              value = animated.skewY;
              break;
          }
        }
      }

      // Find existing track for this object/property
      const trackId = timeline.tracks.find((tid) => {
        const track = freshDoc.tracks[tid];
        return (
          track && track.objectId === objectId && track.property === property
        );
      });

      // If track exists, check if there's already a keyframe at this frame
      if (trackId) {
        const track = freshDoc.tracks[trackId];
        if (track) {
          const existingKeyframeId = track.keys.find((kfId) => {
            const kf = freshDoc.keyframes[kfId];
            return kf && kf.frame === frame;
          });

          if (existingKeyframeId) {
            // Update existing keyframe instead of adding new one
            commandDispatcher.dispatch({
              type: "keyframe.update",
              keyframeId: existingKeyframeId,
              trackId,
              changes: { value },
            });
            return;
          }
        }

        // No existing keyframe at this frame, add new one
        const keyframeId = crypto.randomUUID();
        commandDispatcher.dispatch({
          type: "keyframe.add",
          trackId,
          keyframe: {
            id: keyframeId,
            frame,
            value,
            easing: "linear",
          },
        });
      } else {
        // No track exists, create one and add keyframe
        const newTrackId = crypto.randomUUID();
        commandDispatcher.dispatch({
          type: "track.create",
          track: {
            id: newTrackId,
            objectId,
            property,
            keys: [],
          },
          timelineId: currentContext.timelineId,
        });

        // Add the keyframe to the new track
        const keyframeId = crypto.randomUUID();
        commandDispatcher.dispatch({
          type: "keyframe.add",
          trackId: newTrackId,
          keyframe: {
            id: keyframeId,
            frame,
            value,
            easing: "linear",
          },
        });
      }
    },
    [currentContext, getPropertyValue],
  );

  const handleDeleteKeyframe = useCallback(
    (keyframeId: string, trackId: string) => {
      commandDispatcher.dispatch({
        type: "keyframe.delete",
        keyframeId,
        trackId,
      });
    },
    [],
  );

  const handleMoveKeyframe = useCallback(
    (keyframeId: string, trackId: string, newFrame: number) => {
      commandDispatcher.dispatch({
        type: "keyframe.update",
        keyframeId,
        trackId, // Include trackId so backend can re-sort keys
        changes: { frame: newFrame },
      });
    },
    [],
  );

  const handleUpdateKeyframeEasing = useCallback(
    (keyframeId: string, easing: Keyframe["easing"]) => {
      // Find the track that contains this keyframe
      const freshDoc = useEditorStore.getState().document;
      if (!freshDoc) return;

      // Search through all tracks to find the one containing this keyframe
      let trackId: string | null = null;
      for (const tid of Object.keys(freshDoc.tracks)) {
        const track = freshDoc.tracks[tid];
        if (track.keys.includes(keyframeId)) {
          trackId = tid;
          break;
        }
      }

      if (!trackId) return;

      commandDispatcher.dispatch({
        type: "keyframe.update",
        keyframeId,
        trackId,
        changes: { easing },
      });
    },
    [],
  );

  // --- Z-Order handlers ---

  const handleBringToFront = useCallback(() => {
    if (!singleSelectedId || !doc) return;
    const obj = doc.objects[singleSelectedId];
    if (!obj?.parent) return;
    const parent = doc.objects[obj.parent];
    if (!parent) return;
    const currentIndex = parent.children.indexOf(singleSelectedId);
    if (currentIndex === parent.children.length - 1) return;

    commandDispatcher.dispatch({
      type: "object.reparent",
      objectId: singleSelectedId,
      newParentId: obj.parent,
      newIndex: parent.children.length - 1,
    });
  }, [singleSelectedId, doc]);

  const handleSendToBack = useCallback(() => {
    if (!singleSelectedId || !doc) return;
    const obj = doc.objects[singleSelectedId];
    if (!obj?.parent) return;
    const parent = doc.objects[obj.parent];
    if (!parent) return;
    const currentIndex = parent.children.indexOf(singleSelectedId);
    if (currentIndex === 0) return;

    commandDispatcher.dispatch({
      type: "object.reparent",
      objectId: singleSelectedId,
      newParentId: obj.parent,
      newIndex: 0,
    });
  }, [singleSelectedId, doc]);

  const handleBringForward = useCallback(() => {
    if (!singleSelectedId || !doc) return;
    const obj = doc.objects[singleSelectedId];
    if (!obj?.parent) return;
    const parent = doc.objects[obj.parent];
    if (!parent) return;
    const currentIndex = parent.children.indexOf(singleSelectedId);
    if (currentIndex >= parent.children.length - 1) return;

    commandDispatcher.dispatch({
      type: "object.reparent",
      objectId: singleSelectedId,
      newParentId: obj.parent,
      newIndex: currentIndex + 2,
    });
  }, [singleSelectedId, doc]);

  const handleSendBackward = useCallback(() => {
    if (!singleSelectedId || !doc) return;
    const obj = doc.objects[singleSelectedId];
    if (!obj?.parent) return;
    const parent = doc.objects[obj.parent];
    if (!parent) return;
    const currentIndex = parent.children.indexOf(singleSelectedId);
    if (currentIndex <= 0) return;

    commandDispatcher.dispatch({
      type: "object.reparent",
      objectId: singleSelectedId,
      newParentId: obj.parent,
      newIndex: currentIndex - 1,
    });
  }, [singleSelectedId, doc]);

  // Z-order keyboard shortcuts (separate useEffect since handlers defined above)
  useEffect(() => {
    const handleZOrderKeys = (e: KeyboardEvent) => {
      // Z-order shortcuts: Cmd+]/[ and Cmd+Shift+]/[
      if ((e.metaKey || e.ctrlKey) && e.key === "]") {
        e.preventDefault();
        if (e.shiftKey) {
          handleBringToFront();
        } else {
          handleBringForward();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "[") {
        e.preventDefault();
        if (e.shiftKey) {
          handleSendToBack();
        } else {
          handleSendBackward();
        }
      }
    };

    window.addEventListener("keydown", handleZOrderKeys);
    return () => window.removeEventListener("keydown", handleZOrderKeys);
  }, [
    handleBringToFront,
    handleSendToBack,
    handleBringForward,
    handleSendBackward,
  ]);

  // Group/Ungroup keyboard shortcuts
  useEffect(() => {
    const handleGroupKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "g") {
        e.preventDefault();
        if (e.shiftKey) {
          handleUngroupSelection();
        } else {
          handleGroupSelection();
        }
      }
    };

    window.addEventListener("keydown", handleGroupKeys);
    return () => window.removeEventListener("keydown", handleGroupKeys);
  }, [handleGroupSelection, handleUngroupSelection]);

  // --- Toast helper ---

  const showToast = useCallback((message: string, duration = 2000) => {
    setToast(message);
    setTimeout(() => setToast(null), duration);
  }, []);

  // --- Record Keyframe handler ---

  const handleRecordKeyframe = useCallback(() => {
    // Get fresh document state from store
    const freshDoc = useEditorStore.getState().document;

    if (selectedObjectIds.length === 0 || !freshDoc || !currentContext) {
      showToast("Select an object to record keyframe");
      return;
    }

    const frame = stageRef.current.getCurrentFrame();

    // Record all animatable properties at current frame
    const propertiesToRecord = [
      "transform.x",
      "transform.y",
      "transform.sx",
      "transform.sy",
      "transform.r",
      "transform.skewX",
      "transform.skewY",
      "style.opacity",
      "style.fill",
      "style.stroke",
      "style.strokeWidth",
    ];

    for (const objectId of selectedObjectIds) {
      for (const property of propertiesToRecord) {
        handleAddKeyframe(objectId, frame, property);
      }
    }

    showToast(
      `Keyframe recorded at frame ${frame} for ${selectedObjectIds.length} object(s)`,
    );
  }, [selectedObjectIds, currentContext, handleAddKeyframe, showToast]);

  // K shortcut for record keyframe
  useEffect(() => {
    const handleRecordKeyframeShortcut = (e: KeyboardEvent) => {
      // K = Record keyframe at current frame (not in input fields)
      if (
        (e.key === "k" || e.key === "K") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

        e.preventDefault();
        handleRecordKeyframe();
      }
    };

    window.addEventListener("keydown", handleRecordKeyframeShortcut);
    return () =>
      window.removeEventListener("keydown", handleRecordKeyframeShortcut);
  }, [handleRecordKeyframe]);

  // Delete and Select All shortcuts
  useEffect(() => {
    const handleEditShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      // Delete/Backspace = Delete selected object
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        handleDeleteObject();
      }

      // Cmd+A = Select All (select first object for now, multi-select later)
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        handleSelectAll();
      }
    };

    window.addEventListener("keydown", handleEditShortcuts);
    return () => window.removeEventListener("keydown", handleEditShortcuts);
  }, [handleDeleteObject, handleSelectAll]);

  const handleNewDocument = useCallback(() => {
    // Navigate to projects list to create a new project
    navigate("/projects");
  }, [navigate]);

  const handleExportPng = useCallback(() => {
    if (!doc || !scene) return;

    // Temporarily clear selection so export doesn't show selection outline
    const previousSelection = selectedObjectIds;
    stageRef.current.setSelectedObjectIds([]);
    stageRef.current.invalidate();

    // Wait for next frame to ensure render completes without selection
    requestAnimationFrame(() => {
      const canvas = containerRef.current?.querySelector("canvas");
      if (!canvas) {
        // Restore selection
        stageRef.current.setSelectedObjectIds(previousSelection);
        return;
      }

      // Create filename from project name
      const safeName = doc.project.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const filename = `${safeName || "inamate-export"}-frame-${currentFrame}.png`;

      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();

      // Restore selection
      stageRef.current.setSelectedObjectIds(previousSelection);
      stageRef.current.invalidate();
    });
  }, [doc, scene, selectedObjectIds, currentFrame]);

  const handleZoomIn = useCallback(() => {
    // Placeholder
  }, []);

  const handleZoomOut = useCallback(() => {
    // Placeholder
  }, []);

  const handleFitToScreen = useCallback(() => {
    // Placeholder
  }, []);

  // Total frames for the currently-editing timeline
  const totalFrames = useMemo(() => {
    if (!doc || !currentContext) return 48;
    const tl = doc.timelines[currentContext.timelineId];
    return tl?.length || 48;
  }, [doc, currentContext]);

  const handleExportPngSequence = useCallback(async () => {
    if (!doc || !scene) return;

    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;

    // Store current state to restore after export
    const previousSelection = selectedObjectIds;
    const previousFrame = currentFrame;

    // Clear selection for clean export
    stageRef.current.setSelectedObjectIds([]);

    try {
      await exportPngSequence(
        stageRef.current,
        canvas,
        doc.project.name,
        totalFrames,
        (progress) => setExportProgress(progress),
      );
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      // Restore previous state
      setExportProgress(null);
      stageRef.current.seek(previousFrame);
      stageRef.current.setSelectedObjectIds(previousSelection);
      stageRef.current.invalidate();
    }
  }, [doc, scene, selectedObjectIds, currentFrame, totalFrames]);

  const handleExportVideo = useCallback(
    async (format: "mp4" | "gif" | "webm") => {
      if (!doc || !scene) return;

      const canvas = containerRef.current?.querySelector("canvas");
      if (!canvas) return;

      const previousSelection = selectedObjectIds;
      const previousFrame = currentFrame;

      stageRef.current.setSelectedObjectIds([]);

      try {
        await exportVideo(
          stageRef.current,
          canvas,
          doc.project.name,
          totalFrames,
          format,
          doc.project.fps || 24,
          (progress) => setExportProgress(progress),
        );
      } catch (error) {
        console.error("Video export failed:", error);
      } finally {
        setExportProgress(null);
        stageRef.current.seek(previousFrame);
        stageRef.current.setSelectedObjectIds(previousSelection);
        stageRef.current.invalidate();
      }
    },
    [doc, scene, selectedObjectIds, currentFrame, totalFrames],
  );

  const selectedObject = useMemo(() => {
    if (!doc || !singleSelectedId) return null;
    return doc.objects[singleSelectedId] || null;
  }, [doc, singleSelectedId]);

  // Map of selected object IDs → ObjectNode for subselection tool
  const selectedObjectsMap = useMemo(() => {
    if (!doc || selectedObjectIds.length === 0) return {};
    const map: Record<string, (typeof doc.objects)[string]> = {};
    for (const id of selectedObjectIds) {
      const obj = doc.objects[id];
      if (obj) map[id] = obj;
    }
    return map;
  }, [doc, selectedObjectIds]);

  // Show error UI if document failed to load
  if (loadError) {
    const isAnonymous = !token;
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-950 text-white">
        <h1 className="text-xl font-bold mb-4">Unable to load project</h1>
        <p className="text-gray-400 mb-6 max-w-md text-center">{loadError}</p>
        <div className="flex gap-4">
          {isAnonymous ? (
            <>
              <button
                onClick={() => navigate("/login")}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium"
              >
                Login to Create Projects
              </button>
              <button
                onClick={() => navigate("/register")}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium"
              >
                Register
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => navigate("/projects")}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium"
              >
                Back to Projects
              </button>
              <button
                disabled
                className="px-4 py-2 bg-gray-700 text-gray-500 rounded cursor-not-allowed"
                title="Coming Soon"
              >
                Import Project
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!doc || !scene || !currentContext) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-500">Loading project...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-white">
      {/* Menu bar */}
      <MenuBar
        isLocalMode={false}
        projectName={doc.project.name}
        hasSelection={selectedObjectIds.length > 0}
        onDeleteObject={handleDeleteObject}
        onSelectAll={handleSelectAll}
        onDeselect={handleDeselect}
        onNewDocument={handleNewDocument}
        onExportPng={handleExportPng}
        onExportPngSequence={handleExportPngSequence}
        onExportMp4={() => handleExportVideo("mp4")}
        onExportGif={() => handleExportVideo("gif")}
        onExportWebm={() => handleExportVideo("webm")}
        isExporting={exportProgress !== null}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToScreen={handleFitToScreen}
        onToggleTimeline={() => setShowTimeline((v) => !v)}
        onToggleProperties={() => setShowProperties((v) => !v)}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        onBringForward={handleBringForward}
        onSendBackward={handleSendBackward}
        onDeleteAll={handleDeleteAll}
        onGroup={handleGroupSelection}
        onUngroup={handleUngroupSelection}
        canGroup={selectedObjectIds.length >= 2}
        canUngroup={
          selectedObjectIds.length === 1 &&
          doc.objects[selectedObjectIds[0]]?.type === "Group"
        }
      />

      {/* Main editor area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tools panel (left) */}
        <Toolbar activeTool={activeTool} onToolChange={setActiveTool} />

        {/* Stage / Canvas (center) */}
        <div
          ref={containerRef}
          className="relative flex flex-1 overflow-hidden"
        >
          <CanvasViewport
            stage={stageRef.current}
            sceneWidth={scene.width}
            sceneHeight={scene.height}
            sceneBackground={scene.background || "#ffffff"}
            selectedObjectIds={selectedObjectIds}
            activeTool={activeTool}
            spaceHeld={spaceHeld}
            containerRef={containerRef}
            onMouseMove={throttledSendCursor}
            onObjectClick={handleObjectClick}
            onDoubleClick={handleCanvasDoubleClick}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onCreateObject={handleCreateObject}
            onCreatePath={handleCreatePath}
            onMarqueeSelect={handleMarqueeSelect}
            selectedObjects={selectedObjectsMap}
            onDataUpdate={handleDataUpdate}
          />
        </div>

        {/* Properties panel (right) */}
        {showProperties && (
          <PropertiesPanel
            selectedObject={selectedObject}
            selectedCount={selectedObjectIds.length}
            scene={scene}
            onSceneUpdate={handleSceneUpdate}
            onObjectUpdate={handleObjectUpdate}
            onDataUpdate={handleDataUpdate}
          />
        )}
      </div>

      {/* Timeline (bottom) */}
      {showTimeline && (
        <TimelinePanel
          document={doc}
          currentFrame={currentFrame}
          totalFrames={totalFrames}
          fps={doc.project.fps}
          isPlaying={isPlaying}
          onFrameChange={handleFrameChange}
          onTogglePlay={togglePlay}
          selectedObjectIds={selectedObjectIds}
          onSelectObject={setSelectedObjectIds}
          editingObjectId={currentContext.objectId}
          editingTimelineId={currentContext.timelineId}
          breadcrumb={breadcrumb}
          onEnterSymbol={handleEnterSymbol}
          onNavigateBreadcrumb={handleNavigateBreadcrumb}
          onAddKeyframe={handleAddKeyframe}
          onDeleteKeyframe={handleDeleteKeyframe}
          onMoveKeyframe={handleMoveKeyframe}
          onRecordKeyframe={handleRecordKeyframe}
          onUpdateKeyframeEasing={handleUpdateKeyframeEasing}
          onTotalFramesChange={handleTimelineUpdate}
          scenes={sceneList}
          activeSceneId={activeSceneId || doc.project.scenes[0]}
          onSwitchScene={handleSwitchScene}
          onCreateScene={handleCreateScene}
          onDeleteScene={handleDeleteScene}
          onRenameScene={handleRenameScene}
        />
      )}

      {/* Export progress overlay */}
      {exportProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-gray-800 p-6 shadow-xl">
            <div className="mb-3 text-sm text-gray-300">
              {exportProgress.phase === "rendering" && (
                <>
                  Rendering frame {exportProgress.current} of{" "}
                  {exportProgress.total}...
                </>
              )}
              {exportProgress.phase === "encoding" && <>Encoding video...</>}
              {exportProgress.phase === "zipping" && <>Creating zip file...</>}
              {exportProgress.phase === "downloading" && (
                <>Starting download...</>
              )}
            </div>
            <div className="h-2 w-64 overflow-hidden rounded-full bg-gray-700">
              <div
                className="h-full bg-blue-500 transition-all duration-100"
                style={{
                  width: `${(exportProgress.current / exportProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-200 shadow-lg border border-gray-700">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
