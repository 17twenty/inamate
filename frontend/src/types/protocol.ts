export interface Message {
  type: string
  projectId?: string
  clientId?: string
  userId?: string
  seq?: number
  payload: unknown
}

export interface PresencePayload {
  cursor?: { x: number; y: number }
  selection?: string[]
  displayName?: string
}

export interface PresenceStatePayload {
  presences: Record<string, PresencePayload>
}

export interface PresenceJoinPayload {
  userId: string
  displayName: string
}

export interface PresenceLeavePayload {
  userId: string
}
