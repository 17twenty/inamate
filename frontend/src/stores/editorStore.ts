import { create } from "zustand";
import type { InDocument, Transform } from "../types/document";

export interface PresenceEntry {
  userId: string;
  displayName: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
  color: string;
}

interface EditorState {
  document: InDocument | null;
  presences: Map<string, PresenceEntry>;
  connected: boolean;
  setDocument: (doc: InDocument) => void;
  setConnected: (connected: boolean) => void;
  updateObjectTransform: (
    objectId: string,
    partial: Partial<Transform>,
  ) => void;
  removeObject: (objectId: string) => void;
  updatePresence: (userId: string, entry: Partial<PresenceEntry>) => void;
  removePresence: (userId: string) => void;
  setPresences: (presences: Map<string, PresenceEntry>) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  document: null,
  presences: new Map(),
  connected: false,

  setDocument: (doc) => set({ document: doc }),
  setConnected: (connected) => set({ connected }),

  updateObjectTransform: (objectId, partial) => {
    const doc = get().document;
    if (!doc) return;
    const obj = doc.objects[objectId];
    if (!obj) return;
    set({
      document: {
        ...doc,
        objects: {
          ...doc.objects,
          [objectId]: {
            ...obj,
            transform: { ...obj.transform, ...partial },
          },
        },
      },
    });
  },

  removeObject: (objectId) => {
    const doc = get().document;
    if (!doc) return;
    const obj = doc.objects[objectId];
    if (!obj) return;
    const newObjects = { ...doc.objects };
    delete newObjects[objectId];
    // Remove from parent's children
    if (obj.parent && newObjects[obj.parent]) {
      newObjects[obj.parent] = {
        ...newObjects[obj.parent],
        children: newObjects[obj.parent].children.filter(
          (id) => id !== objectId,
        ),
      };
    }
    set({ document: { ...doc, objects: newObjects } });
  },

  updatePresence: (userId, entry) => {
    const presences = new Map(get().presences);
    const existing = presences.get(userId) || {
      userId,
      displayName: "",
      cursor: null,
      selection: [],
      color: userIdToColor(userId),
    };
    presences.set(userId, { ...existing, ...entry });
    set({ presences });
  },

  removePresence: (userId) => {
    const presences = new Map(get().presences);
    presences.delete(userId);
    set({ presences });
  },

  setPresences: (presences) => set({ presences }),
}));

function userIdToColor(userId: string): string {
  const colors = [
    "#e94560",
    "#0f3460",
    "#53d769",
    "#f5a623",
    "#bd10e0",
    "#4a90d9",
    "#50e3c2",
    "#d0021b",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}
