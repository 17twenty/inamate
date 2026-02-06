export interface Message {
  type: string;
  projectId?: string;
  clientId?: string;
  userId?: string;
  seq?: number;
  payload: unknown;
}

export interface PresencePayload {
  cursor?: { x: number; y: number };
  selection?: string[];
  displayName?: string;
}

export interface PresenceStatePayload {
  presences: Record<string, PresencePayload>;
}

export interface PresenceJoinPayload {
  userId: string;
  displayName: string;
}

export interface PresenceLeavePayload {
  userId: string;
}

// --- Operation Message Types ---

import type {
  Operation,
  OperationAck,
  OperationNack,
  OperationBroadcast,
} from "./operations";

// Client → Server: Submit an operation
export interface OperationSubmitPayload {
  operation: Operation;
}

// Server → Client: Operation acknowledged
export interface OperationAckPayload extends OperationAck {}

// Server → Client: Operation rejected
export interface OperationNackPayload extends OperationNack {}

// Server → Client: Operation from another user
export interface OperationBroadcastPayload extends OperationBroadcast {}

// Error payload from server
export interface ErrorPayload {
  code: string;
  message: string;
}

// Message type constants
export const MessageTypes = {
  // Presence
  PRESENCE_UPDATE: "presence.update",
  PRESENCE_STATE: "presence.state",
  PRESENCE_JOIN: "presence.join",
  PRESENCE_LEAVE: "presence.leave",

  // Connection
  WELCOME: "welcome",
  ERROR: "error",

  // Document sync
  DOC_SYNC: "doc.sync",

  // Operations
  OP_SUBMIT: "op.submit",
  OP_ACK: "op.ack",
  OP_NACK: "op.nack",
  OP_BROADCAST: "op.broadcast",
} as const;
