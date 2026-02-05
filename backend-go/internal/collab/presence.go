package collab

import (
	"encoding/json"
	"log/slog"
	"sync"
)

type PresenceManager struct {
	mu        sync.RWMutex
	presences map[string]*PresencePayload // userID -> presence
}

func NewPresenceManager() *PresenceManager {
	return &PresenceManager{
		presences: make(map[string]*PresencePayload),
	}
}

func (pm *PresenceManager) Update(userID string, p *PresencePayload) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.presences[userID] = p
}

func (pm *PresenceManager) Remove(userID string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	delete(pm.presences, userID)
}

func (pm *PresenceManager) GetAll() map[string]*PresencePayload {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	result := make(map[string]*PresencePayload, len(pm.presences))
	for k, v := range pm.presences {
		result[k] = v
	}
	return result
}

func (pm *PresenceManager) StateMessage() *Message {
	all := pm.GetAll()
	payload, err := json.Marshal(PresenceStatePayload{Presences: all})
	if err != nil {
		slog.Error("marshal presence state", "error", err)
		return nil
	}
	return &Message{
		Type:    TypePresenceState,
		Payload: payload,
	}
}
