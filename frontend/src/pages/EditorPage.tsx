import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useAuthStore } from "../stores/authStore";
import { useEditorStore } from "../stores/editorStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { usePresence } from "../hooks/usePresence";
import { Stage } from "../engine/Stage";
import { CanvasSurface } from "../components/canvas/CanvasSurface";
import { CursorOverlay } from "../components/canvas/CursorOverlay";
import { Toolbar, type Tool } from "../components/editor/Toolbar";
import { PropertiesPanel } from "../components/editor/PropertiesPanel";
import { TimelinePanel } from "../components/editor/TimelinePanel";
import type { BreadcrumbEntry } from "../components/editor/TimelinePanel";
import { MenuBar } from "../components/editor/MenuBar";
import { getLatestSnapshot } from "../api/projects";
import { createSampleDocument } from "../engine/sampleDocument";
import type { Message } from "../types/protocol";
import type { SymbolData } from "../types/document";

interface EditingContext {
  objectId: string | null; // null = scene root
  timelineId: string;
}

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const isLocalMode = !projectId;
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const {
    document: doc,
    setDocument,
    setConnected,
    updateObjectTransform,
    removeObject,
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
  const { handleMessage } = usePresence(stableSend, projectId || "");

  const handleMessageRef = useRef(handleMessage);
  useEffect(() => {
    handleMessageRef.current = handleMessage;
  }, [handleMessage]);

  const { connected, send } = useWebSocket(projectId || "", token, (msg) => {
    handleMessageRef.current(msg);
  });

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Wire Stage events to React state (lightweight — only frame number and play state)
  useEffect(() => {
    stageRef.current.setEvents({
      onFrameChange: (frame) => setCurrentFrame(frame),
      onPlayStateChange: (playing) => setIsPlaying(playing),
    });
  }, []);

  // Load document
  useEffect(() => {
    if (isLocalMode) {
      const sample = createSampleDocument();
      setDocument(sample);
      stageRef.current.loadDocument(sample);
      return;
    }

    if (!projectId || !token) return;

    getLatestSnapshot(projectId)
      .then((snapshot) => {
        setDocument(snapshot);
        stageRef.current.loadDocument(snapshot);
      })
      .catch(() => {
        navigate("/projects");
      });
  }, [isLocalMode, projectId, token, setDocument, navigate]);

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
      if (isLocalMode) return;
      const now = Date.now();
      if (now - lastCursorSend.current < 60) return;
      lastCursorSend.current = now;
      sendCursor(x, y);
    },
    [isLocalMode, sendCursor],
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

  const handleDragMove = useCallback(
    (x: number, y: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      updateObjectTransform(drag.objectId, {
        x: drag.origX + dx,
        y: drag.origY + dy,
      });
      // Force re-render on next rAF tick without waiting for React
      stageRef.current.invalidate();
    },
    [updateObjectTransform],
  );

  const handleDragEnd = useCallback(() => {
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
    removeObject(selectedObjectId);
    setSelectedObjectId(null);
  }, [selectedObjectId, removeObject]);

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
    const sample = createSampleDocument();
    setDocument(sample);
    stageRef.current.loadDocument(sample);
    stageRef.current.pause();
    stageRef.current.seek(0);
    setSelectedObjectId(null);
    setCurrentFrame(0);
    setIsPlaying(false);
    setEditingStack([
      { objectId: null, timelineId: sample.project.rootTimeline },
    ]);
  }, [setDocument]);

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

  // Scene metadata (for layout)
  const scene = useMemo(() => {
    return stageRef.current.getScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        isLocalMode={isLocalMode}
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
