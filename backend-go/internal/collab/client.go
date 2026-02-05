package collab

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/coder/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 30 * time.Second
	maxMsgSize = 64 * 1024
)

type Client struct {
	hub         *Hub
	conn        *websocket.Conn
	send        chan []byte
	UserID      string
	DisplayName string
	ProjectID   string
	ClientID    string
}

func NewClient(hub *Hub, conn *websocket.Conn, userID, displayName, projectID, clientID string) *Client {
	return &Client{
		hub:         hub,
		conn:        conn,
		send:        make(chan []byte, 256),
		UserID:      userID,
		DisplayName: displayName,
		ProjectID:   projectID,
		ClientID:    clientID,
	}
}

func (c *Client) ReadPump(ctx context.Context) {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	c.conn.SetReadLimit(maxMsgSize)

	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure ||
				websocket.CloseStatus(err) == websocket.StatusGoingAway {
				return
			}
			slog.Debug("read error", "error", err, "user", c.UserID)
			return
		}

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Warn("invalid message", "error", err, "user", c.UserID)
			continue
		}

		msg.UserID = c.UserID
		msg.ClientID = c.ClientID
		msg.ProjectID = c.ProjectID

		c.hub.handleMessage(c, &msg)
	}
}

func (c *Client) WritePump(ctx context.Context) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				return
			}

			writeCtx, cancel := context.WithTimeout(ctx, writeWait)
			err := c.conn.Write(writeCtx, websocket.MessageText, message)
			cancel()
			if err != nil {
				slog.Debug("write error", "error", err, "user", c.UserID)
				return
			}

		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, writeWait)
			err := c.conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}

		case <-ctx.Done():
			return
		}
	}
}

func (c *Client) Send(msg *Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		slog.Error("marshal message", "error", err)
		return
	}

	select {
	case c.send <- data:
	default:
		slog.Warn("client send buffer full, dropping message", "user", c.UserID)
	}
}
