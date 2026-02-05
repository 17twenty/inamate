import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useAuthStore } from "../stores/authStore";
import { useEditorStore } from "../stores/editorStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { usePresence } from "../hooks/usePresence";
import { Stage } from "../engine/Stage";
import { commandDispatcher } from "../engine/commandDispatcher";
import {
  CanvasSurface,
  type DragType,
} from "../components/canvas/CanvasSurface";
import type { Bounds } from "../engine/commands";
import { CursorOverlay } from "../components/canvas/CursorOverlay";
import { Toolbar, type Tool } from "../components/editor/Toolbar";
import { PropertiesPanel } from "../components/editor/PropertiesPanel";
import { TimelinePanel } from "../components/editor/TimelinePanel";
import type { BreadcrumbEntry } from "../components/editor/TimelinePanel";
import { MenuBar } from "../components/editor/MenuBar";
import { getLatestSnapshot } from "../api/projects";

import { MessageTypes } from "../types/protocol";
import type { Message } from "../types/protocol";
import type {
  OperationAckPayload,
  OperationNackPayload,
  OperationBroadcastPayload,
} from "../types/protocol";
import type {
  SymbolData,
  InDocument,
  ObjectNode,
  Keyframe,
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

  // Editing context stack for nested Symbol editing
  const [editingStack, setEditingStack] = useState<EditingContext[]>([]);

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

      // Handle document sync (sent when client joins)
      if (msg.type === MessageTypes.DOC_SYNC) {
        const syncedDoc = msg.payload as InDocument;
        setDocument(syncedDoc);
        stageRef.current.loadDocument(syncedDoc);
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

  // Undo/Redo keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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

  // Reload engine when document changes (e.g. from drag moves)
  const docVersionRef = useRef(0);
  useEffect(() => {
    if (!doc) return;
    docVersionRef.current++;
    // Skip first load — already loaded in the effect above
    if (docVersionRef.current <= 1) return;
    stageRef.current.loadDocument(doc);
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
      if (drag.bounds) {
        const { minX, minY, maxX, maxY } = drag.bounds;
        const origWidth = maxX - minX;
        const origHeight = maxY - minY;

        if (origWidth > 0 && origHeight > 0) {
          // Determine which corner is the anchor (opposite to dragged handle)
          let anchorX: number, anchorY: number;
          switch (drag.dragType) {
            case "scale-nw":
              anchorX = maxX;
              anchorY = maxY;
              break;
            case "scale-ne":
              anchorX = minX;
              anchorY = maxY;
              break;
            case "scale-sw":
              anchorX = maxX;
              anchorY = minY;
              break;
            case "scale-se":
            default:
              anchorX = minX;
              anchorY = minY;
              break;
          }

          // Calculate new width/height based on mouse position relative to anchor
          const newWidth = Math.abs(x - anchorX);
          const newHeight = Math.abs(y - anchorY);

          // Calculate scale factors
          const scaleX = newWidth / origWidth;
          const scaleY = newHeight / origHeight;

          newTransform.sx = drag.origSx * scaleX;
          newTransform.sy = drag.origSy * scaleY;

          // Adjust position to keep anchor fixed
          // The position offset depends on which handle is being dragged
          if (drag.dragType === "scale-nw" || drag.dragType === "scale-sw") {
            newTransform.x = drag.origX + (origWidth - newWidth);
          }
          if (drag.dragType === "scale-nw" || drag.dragType === "scale-ne") {
            newTransform.y = drag.origY + (origHeight - newHeight);
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
      const newObject: ObjectNode = {
        id: objectId,
        type: tool === "rect" ? "ShapeRect" : "ShapeEllipse",
        parent: scene.root,
        children: [],
        transform: {
          x: x - defaultSize / 2,
          y: y - defaultSize / 2,
          sx: 1,
          sy: 1,
          r: 0,
          ax: 0,
          ay: 0,
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

  // --- Keyframe handlers ---

  const handleAddKeyframe = useCallback(
    (objectId: string, frame: number, property: string) => {
      if (!doc || !currentContext) return;

      const timeline = doc.timelines[currentContext.timelineId];
      if (!timeline) return;

      // Find or we'll need to create a track for this object/property
      let trackId = timeline.tracks.find((tid) => {
        const track = doc.tracks[tid];
        return (
          track && track.objectId === objectId && track.property === property
        );
      });

      // For now, if no track exists, we can't add keyframes
      // (Track creation would be a separate operation)
      if (!trackId) {
        console.warn("No track found for object/property, cannot add keyframe");
        return;
      }

      const keyframeId = crypto.randomUUID();
      const obj = doc.objects[objectId];
      if (!obj) return;

      // Get current value based on property
      let value: unknown = 0;
      if (property === "transform.x") value = obj.transform.x;
      else if (property === "transform.y") value = obj.transform.y;

      const keyframe: Keyframe = {
        id: keyframeId,
        frame,
        value: value as number,
        easing: "linear",
      };

      commandDispatcher.dispatch({
        type: "keyframe.add",
        trackId,
        keyframe,
      });
    },
    [doc, currentContext],
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

  const handleNewDocument = useCallback(() => {
    // Navigate to projects list to create a new project
    navigate("/projects");
  }, [navigate]);

  const handleExportPng = useCallback(() => {
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "inamate-export.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

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

  const selectedObject = useMemo(() => {
    if (!doc || !selectedObjectId) return null;
    return doc.objects[selectedObjectId] || null;
  }, [doc, selectedObjectId]);

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
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToScreen={handleFitToScreen}
        onToggleTimeline={() => setShowTimeline((v) => !v)}
        onToggleProperties={() => setShowProperties((v) => !v)}
      />

      {/* Main editor area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tools panel (left) */}
        <Toolbar activeTool={activeTool} onToolChange={setActiveTool} />

        {/* Stage / Canvas (center) */}
        <div
          ref={containerRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-gray-950"
        >
          <CanvasSurface
            stage={stageRef.current}
            width={scene.width}
            height={scene.height}
            selectedObjectId={selectedObjectId}
            activeTool={activeTool}
            onMouseMove={throttledSendCursor}
            onObjectClick={handleObjectClick}
            onDoubleClick={handleCanvasDoubleClick}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onCreateObject={handleCreateObject}
          />
          <CursorOverlay
            canvasWidth={scene.width}
            canvasHeight={scene.height}
            containerRef={containerRef}
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
        />
      )}
    </div>
  );
}
