package collab

import "encoding/json"

type Message struct {
	Type      string          `json:"type"`
	ProjectID string          `json:"projectId,omitempty"`
	ClientID  string          `json:"clientId,omitempty"`
	UserID    string          `json:"userId,omitempty"`
	Seq       int64           `json:"seq,omitempty"`
	Payload   json.RawMessage `json:"payload"`
}

type PresencePayload struct {
	Cursor      *CursorPos `json:"cursor,omitempty"`
	Selection   []string   `json:"selection,omitempty"`
	DisplayName string     `json:"displayName,omitempty"`
}

type CursorPos struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type PresenceStatePayload struct {
	Presences map[string]*PresencePayload `json:"presences"`
}

type PresenceJoinPayload struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
}

type PresenceLeavePayload struct {
	UserID string `json:"userId"`
}

const (
	TypePresenceUpdate = "presence.update"
	TypePresenceState  = "presence.state"
	TypePresenceJoin   = "presence.join"
	TypePresenceLeave  = "presence.leave"
	TypeError          = "error"

	// Connection
	TypeWelcome = "welcome"

	// Document sync
	TypeDocSync = "doc.sync"

	// Operation message types
	TypeOpSubmit    = "op.submit"
	TypeOpAck       = "op.ack"
	TypeOpNack      = "op.nack"
	TypeOpBroadcast = "op.broadcast"
)

// --- Operation Types ---

// Operation represents a document mutation
type Operation struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Timestamp int64           `json:"timestamp"`
	ClientSeq int64           `json:"clientSeq"`
	ObjectID  string          `json:"objectId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"` // Type-specific data

	// For object.transform
	Transform json.RawMessage `json:"transform,omitempty"`
	Previous  json.RawMessage `json:"previous,omitempty"`

	// For object.style
	Style json.RawMessage `json:"style,omitempty"`

	// For object.create
	Object   json.RawMessage `json:"object,omitempty"`
	ParentID string          `json:"parentId,omitempty"`
	Index    *int            `json:"index,omitempty"`

	// For object.delete
	PreviousObject         json.RawMessage `json:"previousObject,omitempty"`
	PreviousParentChildren []string        `json:"previousParentChildren,omitempty"`

	// For object.reparent
	NewParentID      string `json:"newParentId,omitempty"`
	NewIndex         int    `json:"newIndex,omitempty"`
	PreviousParentID string `json:"previousParentId,omitempty"`
	PreviousIndex    *int   `json:"previousIndex,omitempty"`

	// For object.visibility / object.locked
	Visible      *bool `json:"visible,omitempty"`
	Locked       *bool `json:"locked,omitempty"`
	PreviousBool *bool `json:"previousBool,omitempty"`

	// For scene.update
	SceneID string          `json:"sceneId,omitempty"`
	Changes json.RawMessage `json:"changes,omitempty"`

	// For project.rename
	Name         string `json:"name,omitempty"`
	PreviousName string `json:"previousName,omitempty"`
}

// OperationSubmitPayload is the payload for op.submit messages
type OperationSubmitPayload struct {
	Operation Operation `json:"operation"`
}

// OperationAckPayload is the payload for op.ack messages
type OperationAckPayload struct {
	OperationID     string `json:"operationId"`
	ServerSeq       int64  `json:"serverSeq"`
	ServerTimestamp int64  `json:"serverTimestamp"`
}

// OperationNackPayload is the payload for op.nack messages
type OperationNackPayload struct {
	OperationID string     `json:"operationId"`
	Reason      string     `json:"reason"`
	Conflict    *Operation `json:"conflictingOp,omitempty"`
}

// OperationBroadcastPayload is the payload for op.broadcast messages
type OperationBroadcastPayload struct {
	Operation Operation `json:"operation"`
	UserID    string    `json:"userId"`
	ServerSeq int64     `json:"serverSeq"`
}
