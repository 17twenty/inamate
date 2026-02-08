package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/inamate/inamate/backend-go/internal/asset"
	"github.com/inamate/inamate/backend-go/internal/auth"
	"github.com/inamate/inamate/backend-go/internal/collab"
	"github.com/inamate/inamate/backend-go/internal/config"
	"github.com/inamate/inamate/backend-go/internal/db"
	"github.com/inamate/inamate/backend-go/internal/db/dbgen"
	"github.com/inamate/inamate/backend-go/internal/document"
	"github.com/inamate/inamate/backend-go/internal/export"
	mw "github.com/inamate/inamate/backend-go/internal/middleware"
	"github.com/inamate/inamate/backend-go/internal/project"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	queries := dbgen.New(pool)

	authService := auth.NewService(queries, cfg.JWTSecret)
	authHandler := auth.NewHandler(authService)

	projectService := project.NewService(queries)
	projectHandler := project.NewHandler(projectService)

	// Document loader for the collaboration hub
	docLoader := func(projectID string) (*document.InDocument, error) {
		// Use a background context since this runs in the hub goroutine
		snap, err := queries.GetLatestSnapshot(context.Background(), projectID)
		if err != nil {
			return nil, err
		}
		var doc document.InDocument
		if err := json.Unmarshal(snap.Document, &doc); err != nil {
			return nil, err
		}
		return &doc, nil
	}

	// Document saver for the collaboration hub
	docSaver := func(projectID string, doc *document.InDocument) error {
		docJSON, err := json.Marshal(doc)
		if err != nil {
			return fmt.Errorf("marshal document: %w", err)
		}

		// Get current version to increment
		currentSnap, err := queries.GetLatestSnapshot(context.Background(), projectID)
		nextVersion := int32(1)
		if err == nil {
			nextVersion = currentSnap.Version + 1
		}

		_, err = queries.CreateSnapshot(context.Background(), dbgen.CreateSnapshotParams{
			ID:        fmt.Sprintf("snap_%s", uuid.New().String()[:8]),
			ProjectID: projectID,
			Version:   nextVersion,
			Document:  docJSON,
		})
		if err != nil {
			return fmt.Errorf("create snapshot: %w", err)
		}

		return nil
	}

	hub := collab.NewHub(docLoader, docSaver)
	go hub.Run()

	assetHandler := asset.NewHandler(cfg.AssetDir)
	exportHandler := export.NewHandler(cfg.FfmpegPath)

	r := mux.NewRouter()

	// Global middleware
	r.Use(mw.Recovery)
	r.Use(mw.Logger)
	r.Use(mw.CORS)

	// Auth routes (public)
	r.HandleFunc("/auth/register", authHandler.Register).Methods("POST")
	r.HandleFunc("/auth/login", authHandler.Login).Methods("POST")

	// Health check
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}).Methods("GET")

	// Asset endpoints (public — used by playground and authenticated users)
	r.HandleFunc("/assets/upload", assetHandler.Upload).Methods("POST", "OPTIONS")
	r.PathPrefix("/assets/").Handler(assetHandler.Serve()).Methods("GET")

	// Export endpoint (public — used by playground and authenticated users)
	r.HandleFunc("/export/video", exportHandler.ExportVideo).Methods("POST", "OPTIONS")

	// Protected API routes
	api := r.PathPrefix("/api").Subrouter()
	api.Use(authService.AuthMiddleware)

	api.HandleFunc("/projects", projectHandler.List).Methods("GET")
	api.HandleFunc("/projects", projectHandler.Create).Methods("POST")
	api.HandleFunc("/projects/{projectId}", projectHandler.Get).Methods("GET")
	api.HandleFunc("/projects/{projectId}", projectHandler.Delete).Methods("DELETE")
	api.HandleFunc("/projects/{projectId}/invite", projectHandler.Invite).Methods("POST")
	api.HandleFunc("/projects/{projectId}/members", projectHandler.ListMembers).Methods("GET")
	api.HandleFunc("/projects/{projectId}/members/{userId}", projectHandler.RemoveMember).Methods("DELETE")
	api.HandleFunc("/projects/{projectId}/snapshots/latest", projectHandler.GetLatestSnapshot).Methods("GET")

	// WebSocket endpoint
	r.HandleFunc("/ws/project/{projectId}", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(w, r, hub, authService, queries)
	})

	addr := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		slog.Info("shutting down server")

		// Stop hub first to save all dirty documents
		slog.Info("saving all documents...")
		hub.Stop()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		srv.Shutdown(shutdownCtx)
	}()

	slog.Info("server starting", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request, hub *collab.Hub, authSvc *auth.Service, queries *dbgen.Queries) {
	vars := mux.Vars(r)
	projectID := vars["projectId"]

	var userID string
	var displayName string

	// Playground project allows anonymous access
	const playgroundProjectID = "proj_playground"
	if projectID == playgroundProjectID {
		// Anonymous user for playground
		userID = "anon-" + uuid.New().String()[:8]
		displayName = "Anonymous"
	} else {
		// Auth via query param for real projects
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "missing token", http.StatusUnauthorized)
			return
		}

		var err error
		userID, err = authSvc.ValidateToken(token)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		// Check membership
		_, err = queries.GetProjectMember(r.Context(), dbgen.GetProjectMemberParams{
			ProjectID: projectID,
			UserID:    userID,
		})
		if err != nil {
			http.Error(w, "not a project member", http.StatusForbidden)
			return
		}

		// Get user display name
		user, err := authSvc.GetUser(r.Context(), userID)
		if err != nil {
			http.Error(w, "user not found", http.StatusInternalServerError)
			return
		}
		displayName = user.DisplayName
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:5173", "localhost:3000"},
	})
	if err != nil {
		slog.Error("websocket accept", "error", err)
		return
	}

	clientID := uuid.New().String()
	client := collab.NewClient(hub, conn, userID, displayName, projectID, clientID)

	hub.Register(client)

	ctx := r.Context()
	go client.WritePump(ctx)
	client.ReadPump(ctx)
}
