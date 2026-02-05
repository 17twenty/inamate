package collab

import (
	"encoding/json"
	"log/slog"
	"sync"
)

type Room struct {
	projectID string
	clients   map[string]*Client // clientID -> client
	presence  *PresenceManager
}

func NewRoom(projectID string) *Room {
	return &Room{
		projectID: projectID,
		clients:   make(map[string]*Client),
		presence:  NewPresenceManager(),
	}
}

type Hub struct {
	mu         sync.RWMutex
	rooms      map[string]*Room // projectID -> room
	register   chan *Client
	unregister chan *Client
}

func NewHub() *Hub {
	return &Hub{
		rooms:      make(map[string]*Room),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.addClient(client)
		case client := <-h.unregister:
			h.removeClient(client)
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) addClient(client *Client) {
	h.mu.Lock()
	room, ok := h.rooms[client.ProjectID]
	if !ok {
		room = NewRoom(client.ProjectID)
		h.rooms[client.ProjectID] = room
	}
	room.clients[client.ClientID] = client
	h.mu.Unlock()

	// Send current presence state to new client
	stateMsg := room.presence.StateMessage()
	if stateMsg != nil {
		client.Send(stateMsg)
	}

	// Broadcast join to other clients
	joinPayload, _ := json.Marshal(PresenceJoinPayload{
		UserID:      client.UserID,
		DisplayName: client.DisplayName,
	})
	joinMsg := &Message{
		Type:    TypePresenceJoin,
		UserID:  client.UserID,
		Payload: joinPayload,
	}
	h.broadcastToRoom(client.ProjectID, joinMsg, client.ClientID)

	slog.Info("client joined", "user", client.UserID, "project", client.ProjectID)
}

func (h *Hub) removeClient(client *Client) {
	h.mu.Lock()
	room, ok := h.rooms[client.ProjectID]
	if !ok {
		h.mu.Unlock()
		return
	}

	delete(room.clients, client.ClientID)
	close(client.send)
	room.presence.Remove(client.UserID)

	if len(room.clients) == 0 {
		delete(h.rooms, client.ProjectID)
	}
	h.mu.Unlock()

	// Broadcast leave to remaining clients
	leavePayload, _ := json.Marshal(PresenceLeavePayload{
		UserID: client.UserID,
	})
	leaveMsg := &Message{
		Type:    TypePresenceLeave,
		UserID:  client.UserID,
		Payload: leavePayload,
	}
	h.broadcastToRoom(client.ProjectID, leaveMsg, "")

	slog.Info("client left", "user", client.UserID, "project", client.ProjectID)
}

func (h *Hub) handleMessage(sender *Client, msg *Message) {
	switch msg.Type {
	case TypePresenceUpdate:
		h.handlePresenceUpdate(sender, msg)
	default:
		slog.Warn("unknown message type", "type", msg.Type, "user", sender.UserID)
	}
}

func (h *Hub) handlePresenceUpdate(sender *Client, msg *Message) {
	var presence PresencePayload
	if err := json.Unmarshal(msg.Payload, &presence); err != nil {
		slog.Warn("invalid presence payload", "error", err)
		return
	}

	presence.DisplayName = sender.DisplayName

	h.mu.RLock()
	room, ok := h.rooms[sender.ProjectID]
	h.mu.RUnlock()
	if !ok {
		return
	}

	room.presence.Update(sender.UserID, &presence)

	// Broadcast to other clients in room
	outPayload, _ := json.Marshal(presence)
	outMsg := &Message{
		Type:    TypePresenceUpdate,
		UserID:  sender.UserID,
		Payload: outPayload,
	}
	h.broadcastToRoom(sender.ProjectID, outMsg, sender.ClientID)
}

func (h *Hub) broadcastToRoom(projectID string, msg *Message, excludeClientID string) {
	h.mu.RLock()
	room, ok := h.rooms[projectID]
	if !ok {
		h.mu.RUnlock()
		return
	}

	clients := make([]*Client, 0, len(room.clients))
	for _, c := range room.clients {
		if c.ClientID != excludeClientID {
			clients = append(clients, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range clients {
		c.Send(msg)
	}
}
