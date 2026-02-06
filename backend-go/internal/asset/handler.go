package asset

import (
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/inamate/inamate/backend-go/internal/typeid"
)

const maxUploadSize = 10 << 20 // 10MB

// UploadResponse is returned from the upload endpoint.
type UploadResponse struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Type   string `json:"type"`
	Name   string `json:"name"`
}

// Handler serves asset upload and retrieval endpoints.
type Handler struct {
	dir string // directory to store asset files
}

// NewHandler creates a new asset handler that stores files in dir.
func NewHandler(dir string) *Handler {
	// Ensure directory exists
	if err := os.MkdirAll(dir, 0755); err != nil {
		slog.Error("create asset dir", "error", err, "dir", dir)
	}
	return &Handler{dir: dir}
}

// Upload handles POST /assets/upload (multipart form with "file" field).
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		http.Error(w, "file too large (max 10MB)", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file field", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Validate content type
	contentType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/png") && !strings.HasPrefix(contentType, "image/jpeg") {
		http.Error(w, "only PNG and JPEG images are supported", http.StatusBadRequest)
		return
	}

	// Decode image to get dimensions (and to re-encode as PNG if JPEG)
	img, _, err := image.Decode(file)
	if err != nil {
		http.Error(w, "invalid image: "+err.Error(), http.StatusBadRequest)
		return
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// Generate asset ID and save as PNG
	assetID := typeid.NewAssetID()
	filename := assetID + ".png"
	filePath := filepath.Join(h.dir, filename)

	out, err := os.Create(filePath)
	if err != nil {
		slog.Error("create asset file", "error", err)
		http.Error(w, "failed to save file", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	if err := png.Encode(out, img); err != nil {
		slog.Error("encode png", "error", err)
		os.Remove(filePath)
		http.Error(w, "failed to encode image", http.StatusInternalServerError)
		return
	}

	resp := UploadResponse{
		ID:     assetID,
		URL:    fmt.Sprintf("/assets/%s", filename),
		Width:  width,
		Height: height,
		Type:   "png",
		Name:   header.Filename,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// Serve returns an http.Handler that serves stored asset files with caching headers.
func (h *Handler) Serve() http.Handler {
	fs := http.FileServer(http.Dir(h.dir))
	return http.StripPrefix("/assets/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Asset IDs are unique, so files are immutable
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		fs.ServeHTTP(w, r)
	}))
}

// Delete removes an asset file from disk (for cleanup).
func (h *Handler) Delete(assetID string) error {
	// Try common extensions
	for _, ext := range []string{".png"} {
		path := filepath.Join(h.dir, assetID+ext)
		if err := os.Remove(path); err == nil {
			return nil
		}
	}
	return fmt.Errorf("asset not found: %s", assetID)
}

// copyFile copies src reader to a file at dst path.
func copyFile(dst string, src io.Reader) error {
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, src)
	return err
}
