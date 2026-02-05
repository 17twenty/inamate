import { useCallback, useMemo, useRef } from 'react'
import { useEditorStore } from '../stores/editorStore'
import type { Message, PresencePayload, PresenceStatePayload, PresenceJoinPayload, PresenceLeavePayload } from '../types/protocol'

function userIdToColor(userId: string): string {
  const colors = [
    '#e94560', '#0f3460', '#53d769', '#f5a623',
    '#bd10e0', '#4a90d9', '#50e3c2', '#d0021b',
  ]
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return colors[Math.abs(hash) % colors.length]
}

export function usePresence(
  send: (msg: Message) => void,
  projectId: string,
) {
  const updatePresence = useEditorStore((s) => s.updatePresence)
  const removePresence = useEditorStore((s) => s.removePresence)
  const setPresences = useEditorStore((s) => s.setPresences)

  const lastSendTime = useRef(0)
  const throttleMs = 60

  const sendCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now()
      if (now - lastSendTime.current < throttleMs) return
      lastSendTime.current = now

      send({
        type: 'presence.update',
        projectId,
        payload: { cursor: { x, y }, selection: [] },
      })
    },
    [send, projectId],
  )

  const handleMessage = useCallback(
    (msg: Message) => {
      switch (msg.type) {
        case 'presence.state': {
          const payload = msg.payload as PresenceStatePayload
          const map = new Map<string, { userId: string; displayName: string; cursor: { x: number; y: number } | null; selection: string[]; color: string }>()
          for (const [userId, p] of Object.entries(payload.presences)) {
            map.set(userId, {
              userId,
              displayName: p.displayName || '',
              cursor: p.cursor || null,
              selection: p.selection || [],
              color: userIdToColor(userId),
            })
          }
          setPresences(map)
          break
        }
        case 'presence.update': {
          const userId = msg.userId
          if (!userId) break
          const payload = msg.payload as PresencePayload
          updatePresence(userId, {
            displayName: payload.displayName || undefined,
            cursor: payload.cursor || null,
            selection: payload.selection || [],
          })
          break
        }
        case 'presence.join': {
          const payload = msg.payload as PresenceJoinPayload
          updatePresence(payload.userId, {
            displayName: payload.displayName,
            cursor: null,
            selection: [],
            color: userIdToColor(payload.userId),
          })
          break
        }
        case 'presence.leave': {
          const payload = msg.payload as PresenceLeavePayload
          removePresence(payload.userId)
          break
        }
      }
    },
    [updatePresence, removePresence, setPresences],
  )

  return useMemo(() => ({ sendCursor, handleMessage }), [sendCursor, handleMessage])
}
