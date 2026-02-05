package project

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/inamate/inamate/backend-go/internal/auth"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

type createRequest struct {
	Name string `json:"name"`
}

type inviteRequest struct {
	Email string `json:"email"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}

	project, err := h.service.Create(r.Context(), req.Name, userID)
	if err != nil {
		slog.Error("create project failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusCreated, project)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	projectID := mux.Vars(r)["projectId"]

	project, err := h.service.Get(r.Context(), projectID, userID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, project)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())

	projects, err := h.service.List(r.Context(), userID)
	if err != nil {
		slog.Error("list projects failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusOK, projects)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	projectID := mux.Vars(r)["projectId"]

	err := h.service.Delete(r.Context(), projectID, userID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Invite(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	projectID := mux.Vars(r)["projectId"]

	var req inviteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email is required"})
		return
	}

	err := h.service.InviteByEmail(r.Context(), projectID, userID, req.Email)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "invited"})
}

func (h *Handler) ListMembers(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	projectID := mux.Vars(r)["projectId"]

	members, err := h.service.ListMembers(r.Context(), projectID, userID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, members)
}

func (h *Handler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	projectID := mux.Vars(r)["projectId"]
	targetUserID := mux.Vars(r)["userId"]

	err := h.service.RemoveMember(r.Context(), projectID, userID, targetUserID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetLatestSnapshot(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromContext(r.Context())
	projectID := mux.Vars(r)["projectId"]

	doc, err := h.service.GetLatestSnapshot(r.Context(), projectID, userID)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(doc)
}

func handleServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
	case errors.Is(err, ErrNotMember):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not a project member"})
	default:
		slog.Error("service error", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
