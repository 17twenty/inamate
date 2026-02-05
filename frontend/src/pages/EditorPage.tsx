import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useAuthStore } from "../stores/authStore";
import { useEditorStore } from "../stores/editorStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { usePresence } from "../hooks/usePresence";
import { Stage } from "../engine/Stage";
import { commandDispatcher } from "../engine/commandDispatcher";
import { CanvasSurface } from "../components/canvas/CanvasSurface";
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
import type { SymbolData, InDocument } from "../types/document";

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
    startX: number;
    startY: number;
    origX: number;
    origY: number;
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
    (objectId: string, x: number, y: number) => {
      if (!doc) return;
      const obj = doc.objects[objectId];
      if (!obj) return;
      dragRef.current = {
        objectId,
        startX: x,
        startY: y,
        origX: obj.transform.x,
        origY: obj.transform.y,
      };
    },
    [doc],
  );

  const handleDragMove = useCallback((x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    const newX = drag.origX + dx;
    const newY = drag.origY + dy;

    // During drag: apply directly to store for visual feedback (no undo tracking)
    // This is an optimistic visual update - the real operation is dispatched on drag end
    const store = useEditorStore.getState();
    const currentDoc = store.document;
    if (!currentDoc) return;
    const obj = currentDoc.objects[drag.objectId];
    if (!obj) return;

    store.setDocument({
      ...currentDoc,
      objects: {
        ...currentDoc.objects,
        [drag.objectId]: {
          ...obj,
          transform: { ...obj.transform, x: newX, y: newY },
        },
      },
    });

    // Force re-render on next rAF tick without waiting for React
    stageRef.current.invalidate();
  }, []);

  const handleDragEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    // Get current position after drag
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

    const finalX = obj.transform.x;
    const finalY = obj.transform.y;

    // Only dispatch if position actually changed
    if (finalX !== drag.origX || finalY !== drag.origY) {
      // Reset to original position first (so the operation captures correct previous state)
      useEditorStore.getState().setDocument({
        ...currentDoc,
        objects: {
          ...currentDoc.objects,
          [drag.objectId]: {
            ...obj,
            transform: { ...obj.transform, x: drag.origX, y: drag.origY },
          },
        },
      });

      // Now dispatch the operation (this will apply the change and track for undo)
      commandDispatcher.dispatch({
        type: "object.transform",
        objectId: drag.objectId,
        transform: { x: finalX, y: finalY },
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

  // Scene metadata (for layout) - get from document directly, not WASM
  const scene = useMemo(() => {
    if (!doc) return null;
    // Get the first scene from the document
    const sceneId = Object.keys(doc.scenes)[0];
    return sceneId ? doc.scenes[sceneId] : null;
  }, [doc]);

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
            onMouseMove={throttledSendCursor}
            onObjectClick={handleObjectClick}
            onDoubleClick={handleCanvasDoubleClick}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          />
          <CursorOverlay
            canvasWidth={scene.width}
            canvasHeight={scene.height}
            containerRef={containerRef}
          />
        </div>

        {/* Properties panel (right) */}
        {showProperties && <PropertiesPanel selectedObject={selectedObject} />}
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
        />
      )}
    </div>
  );
}
