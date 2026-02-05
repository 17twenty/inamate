package main

import (
	"context"
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

	"github.com/inamate/inamate/backend-go/internal/auth"
	"github.com/inamate/inamate/backend-go/internal/collab"
	"github.com/inamate/inamate/backend-go/internal/config"
	"github.com/inamate/inamate/backend-go/internal/db"
	"github.com/inamate/inamate/backend-go/internal/db/dbgen"
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

	hub := collab.NewHub()
	go hub.Run()

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
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		slog.Info("shutting down server")
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

	// Auth via query param
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	userID, err := authSvc.ValidateToken(token)
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

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:5173", "localhost:3000"},
	})
	if err != nil {
		slog.Error("websocket accept", "error", err)
		return
	}

	clientID := uuid.New().String()
	client := collab.NewClient(hub, conn, userID, user.DisplayName, projectID, clientID)

	hub.Register(client)

	ctx := r.Context()
	go client.WritePump(ctx)
	client.ReadPump(ctx)
}
