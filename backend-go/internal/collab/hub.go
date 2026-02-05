package collab

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/inamate/inamate/backend-go/internal/document"
)

type Room struct {
	projectID string
	clients   map[string]*Client // clientID -> client
	presence  *PresenceManager
	docState  *DocumentState // Authoritative document state
}

func NewRoom(projectID string, initialDoc *document.InDocument) *Room {
	return &Room{
		projectID: projectID,
		clients:   make(map[string]*Client),
		presence:  NewPresenceManager(),
		docState:  NewDocumentState(initialDoc),
	}
}

// DocumentLoader loads a document for a project
type DocumentLoader func(projectID string) (*document.InDocument, error)

type Hub struct {
	mu         sync.RWMutex
	rooms      map[string]*Room // projectID -> room
	register   chan *Client
	unregister chan *Client
	loadDoc    DocumentLoader // Function to load documents
}

func NewHub(loadDoc DocumentLoader) *Hub {
	return &Hub{
		rooms:      make(map[string]*Room),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		loadDoc:    loadDoc,
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
		// Load document for new room
		if h.loadDoc == nil {
			slog.Error("no document loader configured", "project", client.ProjectID)
			h.mu.Unlock()
			return
		}
		doc, err := h.loadDoc(client.ProjectID)
		if err != nil {
			slog.Error("failed to load document", "project", client.ProjectID, "error", err)
			h.mu.Unlock()
			return
		}
		room = NewRoom(client.ProjectID, doc)
		h.rooms[client.ProjectID] = room
	}
	room.clients[client.ClientID] = client
	h.mu.Unlock()

	// Send welcome message with user's identity
	welcomePayload, _ := json.Marshal(map[string]string{
		"userId":      client.UserID,
		"displayName": client.DisplayName,
	})
	welcomeMsg := &Message{
		Type:    TypeWelcome,
		Payload: welcomePayload,
	}
	client.Send(welcomeMsg)

	// Send current document state to new client
	docPayload, _ := json.Marshal(room.docState.GetDocument())
	docMsg := &Message{
		Type:    TypeDocSync,
		Payload: docPayload,
	}
	client.Send(docMsg)

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
	case TypeOpSubmit:
		h.handleOperationSubmit(sender, msg)
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

func (h *Hub) handleOperationSubmit(sender *Client, msg *Message) {
	// Parse the operation from the message payload
	var op Operation
	if err := json.Unmarshal(msg.Payload, &op); err != nil {
		slog.Warn("invalid operation payload", "error", err, "user", sender.UserID)
		h.sendNack(sender, "", "invalid operation payload")
		return
	}

	h.mu.RLock()
	room, ok := h.rooms[sender.ProjectID]
	h.mu.RUnlock()
	if !ok {
		h.sendNack(sender, op.ID, "room not found")
		return
	}

	// Apply the operation to the authoritative document
	serverSeq, err := room.docState.ApplyOperation(op)
	if err != nil {
		slog.Warn("operation failed", "error", err, "opType", op.Type, "user", sender.UserID)
		h.sendNack(sender, op.ID, err.Error())
		return
	}

	// Send ACK to the sender
	h.sendAck(sender, op.ID, serverSeq)

	// Broadcast to other clients in the room
	broadcastPayload, _ := json.Marshal(OperationBroadcastPayload{
		Operation: op,
		UserID:    sender.UserID,
		ServerSeq: serverSeq,
	})
	broadcastMsg := &Message{
		Type:    TypeOpBroadcast,
		UserID:  sender.UserID,
		Payload: broadcastPayload,
	}
	h.broadcastToRoom(sender.ProjectID, broadcastMsg, sender.ClientID)

	slog.Debug("operation applied", "opType", op.Type, "opId", op.ID, "serverSeq", serverSeq, "user", sender.UserID)
}

func (h *Hub) sendAck(client *Client, operationID string, serverSeq int64) {
	payload, _ := json.Marshal(OperationAckPayload{
		OperationID:     operationID,
		ServerSeq:       serverSeq,
		ServerTimestamp: GetServerTimestamp(),
	})
	client.Send(&Message{
		Type:    TypeOpAck,
		Payload: payload,
	})
}

func (h *Hub) sendNack(client *Client, operationID string, reason string) {
	payload, _ := json.Marshal(OperationNackPayload{
		OperationID: operationID,
		Reason:      reason,
	})
	client.Send(&Message{
		Type:    TypeOpNack,
		Payload: payload,
	})
}
