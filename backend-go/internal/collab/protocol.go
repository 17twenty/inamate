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
)
