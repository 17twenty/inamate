import type { InDocument } from "../types/document";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function createSampleDocument(): InDocument {
  const now = new Date().toISOString();

  const sceneId = id("scene");
  const rootId = id("obj");
  const rectId = id("obj");
  const ellipseId = id("obj");
  const triangleId = id("obj");
  const timelineId = id("tl");
  const projectId = id("proj");

  // Symbol: "Spinner" — a small group that rotates on its own 24-frame timeline
  const spinnerId = id("obj");
  const spinnerRectId = id("obj");
  const spinnerEllipseId = id("obj");
  const spinnerTimelineId = id("tl");
  const spinnerTrackId = id("track");
  const kf0Id = id("kf");
  const kf1Id = id("kf");

  return {
    project: {
      id: projectId,
      name: "Untitled",
      version: 1,
      fps: 24,
      createdAt: now,
      updatedAt: now,
      scenes: [sceneId],
      assets: [],
      rootTimeline: timelineId,
    },
    scenes: {
      [sceneId]: {
        id: sceneId,
        name: "Scene 1",
        width: 1280,
        height: 720,
        background: "#1a1a2e",
        root: rootId,
      },
    },
    objects: {
      [rootId]: {
        id: rootId,
        type: "Group",
        parent: null,
        children: [rectId, ellipseId, triangleId, spinnerId],
        transform: { x: 0, y: 0, sx: 1, sy: 1, r: 0, ax: 0, ay: 0 },
        style: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
        visible: true,
        locked: false,
        data: {},
      },
      [rectId]: {
        id: rectId,
        type: "ShapeRect",
        parent: rootId,
        children: [],
        transform: { x: 200, y: 200, sx: 1, sy: 1, r: 0, ax: 0, ay: 0 },
        style: {
          fill: "#e94560",
          stroke: "#000000",
          strokeWidth: 2,
          opacity: 1,
        },
        visible: true,
        locked: false,
        data: { width: 200, height: 150 },
      },
      [ellipseId]: {
        id: ellipseId,
        type: "ShapeEllipse",
        parent: rootId,
        children: [],
        transform: { x: 640, y: 360, sx: 1, sy: 1, r: 0, ax: 0, ay: 0 },
        style: {
          fill: "#0f3460",
          stroke: "#16213e",
          strokeWidth: 2,
          opacity: 1,
        },
        visible: true,
        locked: false,
        data: { rx: 120, ry: 80 },
      },
      [triangleId]: {
        id: triangleId,
        type: "VectorPath",
        parent: rootId,
        children: [],
        transform: { x: 900, y: 200, sx: 1, sy: 1, r: 0, ax: 0, ay: 0 },
        style: {
          fill: "#53d769",
          stroke: "#2d6a4f",
          strokeWidth: 2,
          opacity: 1,
        },
        visible: true,
        locked: false,
        data: {
          commands: [["M", 0, 150], ["L", 100, 0], ["L", 200, 150], ["Z"]],
        },
      },
      // Spinner Symbol — contains a rect and ellipse, rotates via its own timeline
      [spinnerId]: {
        id: spinnerId,
        type: "Symbol",
        parent: rootId,
        children: [spinnerRectId, spinnerEllipseId],
        transform: { x: 500, y: 450, sx: 1, sy: 1, r: 0, ax: 0, ay: 0 },
        style: { fill: "", stroke: "", strokeWidth: 0, opacity: 1 },
        visible: true,
        locked: false,
        data: { timelineId: spinnerTimelineId },
      },
      [spinnerRectId]: {
        id: spinnerRectId,
        type: "ShapeRect",
        parent: spinnerId,
        children: [],
        transform: { x: -30, y: -50, sx: 1, sy: 1, r: 0, ax: 0, ay: 0 },
        style: {
          fill: "#f5a623",
          stroke: "#c78400",
          strokeWidth: 2,
          opacity: 1,
        },
        visible: true,
        locked: false,
        data: { width: 60, height: 100 },
      },
      [spinnerEllipseId]: {
        id: spinnerEllipseId,
        type: "ShapeEllipse",
        parent: spinnerId,
        children: [],
        transform: { x: 0, y: -70, sx: 1, sy: 1, r: 0, ax: 0, ay: 0 },
        style: {
          fill: "#bd10e0",
          stroke: "#8b0ba8",
          strokeWidth: 2,
          opacity: 1,
        },
        visible: true,
        locked: false,
        data: { rx: 20, ry: 20 },
      },
    },
    timelines: {
      [timelineId]: {
        id: timelineId,
        length: 48,
        tracks: [],
      },
      [spinnerTimelineId]: {
        id: spinnerTimelineId,
        length: 24,
        tracks: [spinnerTrackId],
      },
    },
    tracks: {
      [spinnerTrackId]: {
        id: spinnerTrackId,
        objectId: spinnerId,
        property: "transform.r",
        keys: [kf0Id, kf1Id],
      },
    },
    keyframes: {
      [kf0Id]: {
        id: kf0Id,
        frame: 0,
        value: 0,
        easing: "linear",
      },
      [kf1Id]: {
        id: kf1Id,
        frame: 23,
        value: 360,
        easing: "linear",
      },
    },
    assets: {},
  };
}
