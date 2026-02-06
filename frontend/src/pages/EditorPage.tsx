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
import { exportPngSequence } from "../utils/export";

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
  Keyframe,
  PathCommand,
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
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
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

  // Track modifier key states
  const shiftHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Drag state
  const dragRef = useRef<{
    objectId: string;
    dragType: DragType;
    startX: number;
    startY: number;
    // Original transform values
    origX: number;
    origY: number;
    origSx: number;
    origSy: number;
    origR: number;
    // Bounds at drag start (for scale/rotate calculations)
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

  // Wire Stage events to React state (lightweight — only frame number and play state)
  useEffect(() => {
    stageRef.current.setEvents({
      onFrameChange: (frame) => setCurrentFrame(frame),
      onPlayStateChange: (playing) => setIsPlaying(playing),
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

  // Initialize editing stack when document loads
  useEffect(() => {
    if (!doc) return;
    if (editingStack.length === 0) {
      setEditingStack([
        { objectId: null, timelineId: doc.project.rootTimeline },
      ]);
    }
  }, [doc, editingStack.length]);

  // Scene metadata (for layout) - get from document directly, not WASM
  // Defined early because callbacks below depend on it
  const scene = useMemo(() => {
    if (!doc) return null;
    // Get the first scene from the document
    const sceneId = Object.keys(doc.scenes)[0];
    return sceneId ? doc.scenes[sceneId] : null;
  }, [doc]);

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
    stageRef.current.setSelectedObjectId(selectedObjectId);
  }, [selectedObjectId]);

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
      setSelectedObjectId(null);
    },
    [doc],
  );

  const handleNavigateBreadcrumb = useCallback((index: number) => {
    setEditingStack((prev) => prev.slice(0, index + 1));
    setSelectedObjectId(null);
  }, []);

  const breadcrumb: BreadcrumbEntry[] = useMemo(() => {
    if (!doc) return [];
    return editingStack.map((ctx) => {
      if (ctx.objectId === null) {
        return { id: null, name: "Scene 1" };
      }
      const obj = doc.objects[ctx.objectId];
      return { id: ctx.objectId, name: obj?.type || "Symbol" };
    });
  }, [doc, editingStack]);

  // --- Canvas interaction callbacks ---

  const handleObjectClick = useCallback((objectId: string | null) => {
    setSelectedObjectId(objectId);
  }, []);

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
      const obj = doc.objects[objectId];
      if (!obj) return;

      // Calculate original dimensions from bounds
      let origWidth = 0;
      let origHeight = 0;
      if (bounds) {
        origWidth = bounds.maxX - bounds.minX;
        origHeight = bounds.maxY - bounds.minY;
      }

      dragRef.current = {
        objectId,
        dragType,
        startX: x,
        startY: y,
        origX: obj.transform.x,
        origY: obj.transform.y,
        origSx: obj.transform.sx,
        origSy: obj.transform.sy,
        origR: obj.transform.r,
        bounds,
        origWidth,
        origHeight,
      };
    },
    [doc],
  );

  const handleDragMove = useCallback((x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag) return;

    // During drag: apply directly to store for visual feedback (no undo tracking)
    // This is an optimistic visual update - the real operation is dispatched on drag end
    const store = useEditorStore.getState();
    const currentDoc = store.document;
    if (!currentDoc) return;
    const obj = currentDoc.objects[drag.objectId];
    if (!obj) return;

    let newTransform = { ...obj.transform };

    if (drag.dragType === "move") {
      // Simple move
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      newTransform.x = drag.origX + dx;
      newTransform.y = drag.origY + dy;
    } else if (drag.dragType === "rotate") {
      // Rotation around object center
      if (drag.bounds) {
        const centerX = (drag.bounds.minX + drag.bounds.maxX) / 2;
        const centerY = (drag.bounds.minY + drag.bounds.maxY) / 2;

        // Calculate angle from center to current mouse position
        const startAngle = Math.atan2(
          drag.startY - centerY,
          drag.startX - centerX,
        );
        const currentAngle = Math.atan2(y - centerY, x - centerX);
        const deltaAngle = currentAngle - startAngle;

        // Convert to degrees and add to original rotation
        newTransform.r = drag.origR + (deltaAngle * 180) / Math.PI;
      }
    } else if (drag.dragType && drag.dragType.startsWith("scale-")) {
      // Scale from corner handle
      if (drag.bounds && drag.origWidth > 0 && drag.origHeight > 0) {
        const { minX, minY, maxX, maxY } = drag.bounds;

        // Check if shift is held (scale from center)
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
            newTransform.sx = drag.origSx * scaleFactor;
            newTransform.sy = drag.origSy * scaleFactor;
          }
        } else {
          // No shift: scale from opposite corner (anchor)
          // The anchor corner stays fixed while the dragged corner follows the mouse

          // Determine which corner is being dragged and which is the anchor
          const isDraggingLeft =
            drag.dragType === "scale-nw" || drag.dragType === "scale-sw";
          const isDraggingTop =
            drag.dragType === "scale-nw" || drag.dragType === "scale-ne";

          // Anchor is the opposite corner
          const anchorX = isDraggingLeft ? maxX : minX;
          const anchorY = isDraggingTop ? maxY : minY;

          // Calculate new width/height based on mouse distance from anchor
          // For left-side handles, width grows as mouse moves left (negative x direction)
          // For top-side handles, height grows as mouse moves up (negative y direction)
          const newWidth = isDraggingLeft ? anchorX - x : x - anchorX;
          const newHeight = isDraggingTop ? anchorY - y : y - anchorY;

          // Calculate scale factors (prevent negative/zero scale)
          const scaleX = Math.max(0.01, newWidth / drag.origWidth);
          const scaleY = Math.max(0.01, newHeight / drag.origHeight);

          newTransform.sx = drag.origSx * scaleX;
          newTransform.sy = drag.origSy * scaleY;

          // Adjust position to keep the anchor corner fixed
          // When scaling from left, the left edge moves, so x position changes
          // When scaling from top, the top edge moves, so y position changes
          if (isDraggingLeft) {
            // New left edge should be at mouse x position
            // Object x is the left edge, so set it to where the mouse is
            newTransform.x = x;
          }
          if (isDraggingTop) {
            // New top edge should be at mouse y position
            newTransform.y = y;
          }
        }
      }
    }

    store.setDocument({
      ...currentDoc,
      objects: {
        ...currentDoc.objects,
        [drag.objectId]: {
          ...obj,
          transform: newTransform,
        },
      },
    });

    // Force re-render on next rAF tick without waiting for React
    stageRef.current.invalidate();
  }, []);

  const handleDragEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    // Get current transform after drag
    const currentDoc = useEditorStore.getState().document;
    if (!currentDoc) {
      dragRef.current = null;
      return;
    }
    const obj = currentDoc.objects[drag.objectId];
    if (!obj) {
      dragRef.current = null;
      return;
    }

    const finalTransform = obj.transform;

    // Check if any transform values changed
    const hasChanged =
      finalTransform.x !== drag.origX ||
      finalTransform.y !== drag.origY ||
      finalTransform.sx !== drag.origSx ||
      finalTransform.sy !== drag.origSy ||
      finalTransform.r !== drag.origR;

    if (hasChanged) {
      // Reset to original transform first (so the operation captures correct previous state)
      useEditorStore.getState().setDocument({
        ...currentDoc,
        objects: {
          ...currentDoc.objects,
          [drag.objectId]: {
            ...obj,
            transform: {
              ...obj.transform,
              x: drag.origX,
              y: drag.origY,
              sx: drag.origSx,
              sy: drag.origSy,
              r: drag.origR,
            },
          },
        },
      });

      // Build the transform changes based on what was dragged
      const transformChanges: Record<string, number> = {};

      if (drag.dragType === "move") {
        transformChanges.x = finalTransform.x;
        transformChanges.y = finalTransform.y;
      } else if (drag.dragType === "rotate") {
        transformChanges.r = finalTransform.r;
      } else if (drag.dragType && drag.dragType.startsWith("scale-")) {
        transformChanges.sx = finalTransform.sx;
        transformChanges.sy = finalTransform.sy;
        // Also include position if it changed (for anchor-based scaling)
        if (finalTransform.x !== drag.origX) {
          transformChanges.x = finalTransform.x;
        }
        if (finalTransform.y !== drag.origY) {
          transformChanges.y = finalTransform.y;
        }
      }

      // Now dispatch the operation (this will apply the change and track for undo)
      commandDispatcher.dispatch({
        type: "object.transform",
        objectId: drag.objectId,
        transform: transformChanges,
      });
    }

    dragRef.current = null;
  }, []);

  // --- Playback controls (delegated to Stage) ---

  const togglePlay = useCallback(() => {
    stageRef.current.togglePlay();
  }, []);

  const handleFrameChange = useCallback((frame: number) => {
    stageRef.current.seek(frame);
  }, []);

  // --- Menu bar actions ---

  const handleDeleteObject = useCallback(() => {
    if (!selectedObjectId) return;
    commandDispatcher.dispatch({
      type: "object.delete",
      objectId: selectedObjectId,
    });
    setSelectedObjectId(null);
  }, [selectedObjectId]);

  const handleSelectAll = useCallback(() => {
    if (!doc) return;
    const scene = Object.values(doc.scenes)[0];
    if (!scene) return;
    const root = doc.objects[scene.root];
    if (root && root.children.length > 0) {
      setSelectedObjectId(root.children[0]);
    }
  }, [doc]);

  const handleDeselect = useCallback(() => {
    setSelectedObjectId(null);
  }, []);

  const handleDeleteAll = useCallback(() => {
    if (!doc) return;
    const scene = Object.values(doc.scenes)[0];
    if (!scene) return;
    const root = doc.objects[scene.root];
    if (!root) return;

    // Delete all children of the root (all objects on canvas)
    for (const childId of [...root.children]) {
      commandDispatcher.dispatch({
        type: "object.delete",
        objectId: childId,
      });
    }
    setSelectedObjectId(null);
  }, [doc]);

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

  const handleObjectUpdate = useCallback(
    (
      objectId: string,
      changes: {
        transform?: Partial<typeof selectedObject.transform>;
        style?: Partial<typeof selectedObject.style>;
      },
    ) => {
      if (changes.transform) {
        commandDispatcher.dispatch({
          type: "object.transform",
          objectId,
          transform: changes.transform,
        });
      }
      if (changes.style) {
        commandDispatcher.dispatch({
          type: "object.style",
          objectId,
          style: changes.style,
        });
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
      setSelectedObjectId(objectId);
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
      setSelectedObjectId(objectId);
      setActiveTool("select");
    },
    [doc, scene],
  );

  // --- Keyframe handlers ---

  // Helper to get property value from object
  const getPropertyValue = useCallback(
    (obj: ObjectNode, property: string): number => {
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
        case "style.opacity":
          return obj.style.opacity;
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

      const value = getPropertyValue(obj, property);

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
    if (!selectedObjectId || !doc) return;
    const obj = doc.objects[selectedObjectId];
    if (!obj?.parent) return;
    const parent = doc.objects[obj.parent];
    if (!parent) return;
    const currentIndex = parent.children.indexOf(selectedObjectId);
    if (currentIndex === parent.children.length - 1) return; // Already at front

    commandDispatcher.dispatch({
      type: "object.reparent",
      objectId: selectedObjectId,
      newParentId: obj.parent,
      newIndex: parent.children.length - 1,
    });
  }, [selectedObjectId, doc]);

  const handleSendToBack = useCallback(() => {
    if (!selectedObjectId || !doc) return;
    const obj = doc.objects[selectedObjectId];
    if (!obj?.parent) return;
    const parent = doc.objects[obj.parent];
    if (!parent) return;
    const currentIndex = parent.children.indexOf(selectedObjectId);
    if (currentIndex === 0) return; // Already at back

    commandDispatcher.dispatch({
      type: "object.reparent",
      objectId: selectedObjectId,
      newParentId: obj.parent,
      newIndex: 0,
    });
  }, [selectedObjectId, doc]);

  const handleBringForward = useCallback(() => {
    if (!selectedObjectId || !doc) return;
    const obj = doc.objects[selectedObjectId];
    if (!obj?.parent) return;
    const parent = doc.objects[obj.parent];
    if (!parent) return;
    const currentIndex = parent.children.indexOf(selectedObjectId);
    if (currentIndex >= parent.children.length - 1) return; // Already at front

    commandDispatcher.dispatch({
      type: "object.reparent",
      objectId: selectedObjectId,
      newParentId: obj.parent,
      newIndex: currentIndex + 2, // +2 because removal shifts indices
    });
  }, [selectedObjectId, doc]);

  const handleSendBackward = useCallback(() => {
    if (!selectedObjectId || !doc) return;
    const obj = doc.objects[selectedObjectId];
    if (!obj?.parent) return;
    const parent = doc.objects[obj.parent];
    if (!parent) return;
    const currentIndex = parent.children.indexOf(selectedObjectId);
    if (currentIndex <= 0) return; // Already at back

    commandDispatcher.dispatch({
      type: "object.reparent",
      objectId: selectedObjectId,
      newParentId: obj.parent,
      newIndex: currentIndex - 1,
    });
  }, [selectedObjectId, doc]);

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

  // --- Toast helper ---

  const showToast = useCallback((message: string, duration = 2000) => {
    setToast(message);
    setTimeout(() => setToast(null), duration);
  }, []);

  // --- Record Keyframe handler ---

  const handleRecordKeyframe = useCallback(() => {
    // Get fresh document state from store
    const freshDoc = useEditorStore.getState().document;

    if (!selectedObjectId || !freshDoc || !currentContext) {
      showToast("Select an object to record keyframe");
      return;
    }

    const obj = freshDoc.objects[selectedObjectId];
    if (!obj) return;

    const frame = stageRef.current.getCurrentFrame();

    // Record all numeric transform and style properties at current frame
    const propertiesToRecord = [
      "transform.x",
      "transform.y",
      "transform.sx",
      "transform.sy",
      "transform.r",
      "style.opacity",
    ];

    for (const property of propertiesToRecord) {
      handleAddKeyframe(selectedObjectId, frame, property);
    }

    // Show feedback
    showToast(`Keyframe recorded at frame ${frame}`);
  }, [selectedObjectId, currentContext, handleAddKeyframe, showToast]);

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
    const previousSelection = selectedObjectId;
    stageRef.current.setSelectedObjectId(null);
    stageRef.current.invalidate();

    // Wait for next frame to ensure render completes without selection
    requestAnimationFrame(() => {
      const canvas = containerRef.current?.querySelector("canvas");
      if (!canvas) {
        // Restore selection
        stageRef.current.setSelectedObjectId(previousSelection);
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
      stageRef.current.setSelectedObjectId(previousSelection);
      stageRef.current.invalidate();
    });
  }, [doc, scene, selectedObjectId, currentFrame]);

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
    const previousSelection = selectedObjectId;
    const previousFrame = currentFrame;

    // Clear selection for clean export
    stageRef.current.setSelectedObjectId(null);

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
      stageRef.current.setSelectedObjectId(previousSelection);
      stageRef.current.invalidate();
    }
  }, [doc, scene, selectedObjectId, currentFrame, totalFrames]);

  const selectedObject = useMemo(() => {
    if (!doc || !selectedObjectId) return null;
    return doc.objects[selectedObjectId] || null;
  }, [doc, selectedObjectId]);

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
        selectedObjectId={selectedObjectId}
        onDeleteObject={handleDeleteObject}
        onSelectAll={handleSelectAll}
        onDeselect={handleDeselect}
        onNewDocument={handleNewDocument}
        onExportPng={handleExportPng}
        onExportPngSequence={handleExportPngSequence}
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
            selectedObjectId={selectedObjectId}
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
          />
        </div>

        {/* Properties panel (right) */}
        {showProperties && (
          <PropertiesPanel
            selectedObject={selectedObject}
            scene={scene}
            onSceneUpdate={handleSceneUpdate}
            onObjectUpdate={handleObjectUpdate}
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
          selectedObjectId={selectedObjectId}
          onSelectObject={setSelectedObjectId}
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
