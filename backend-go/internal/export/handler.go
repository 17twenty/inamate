package export

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

const maxUploadSize = 500 << 20 // 500MB

type Handler struct {
	ffmpegPath string
}

func NewHandler(ffmpegPath string) *Handler {
	return &Handler{ffmpegPath: ffmpegPath}
}

func (h *Handler) ExportVideo(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		http.Error(w, "request too large", http.StatusBadRequest)
		return
	}
	defer r.MultipartForm.RemoveAll()

	format := r.FormValue("format")
	if format != "mp4" && format != "gif" && format != "webm" {
		http.Error(w, "invalid format: must be mp4, gif, or webm", http.StatusBadRequest)
		return
	}

	fps, err := strconv.Atoi(r.FormValue("fps"))
	if err != nil || fps <= 0 || fps > 120 {
		fps = 24
	}

	name := r.FormValue("name")
	if name == "" {
		name = "animation"
	}
	// Sanitize filename
	name = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, name)

	// Create temp directory for frames
	tempDir, err := os.MkdirTemp("", "inamate-export-*")
	if err != nil {
		slog.Error("create temp dir", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(tempDir)

	// Write uploaded frames to temp directory, preserving the frame index
	// from the key name (e.g. "frame_0003" → "frame_0003.png").
	// Map iteration order is random in Go, so we must use the key name
	// rather than a counter to keep frames in the correct sequence.
	frameCount := 0
	for key, files := range r.MultipartForm.File {
		if !strings.HasPrefix(key, "frame_") {
			continue
		}
		if len(files) == 0 {
			continue
		}

		// Extract frame index from key name (e.g. "frame_0003" → 3)
		indexStr := strings.TrimPrefix(key, "frame_")
		frameIdx, err := strconv.Atoi(indexStr)
		if err != nil {
			slog.Error("parse frame index", "key", key, "error", err)
			http.Error(w, "invalid frame key: "+key, http.StatusBadRequest)
			return
		}

		f, err := files[0].Open()
		if err != nil {
			slog.Error("open uploaded frame", "key", key, "error", err)
			http.Error(w, "failed to read frame", http.StatusBadRequest)
			return
		}

		outPath := filepath.Join(tempDir, fmt.Sprintf("frame_%04d.png", frameIdx))
		out, err := os.Create(outPath)
		if err != nil {
			f.Close()
			slog.Error("create frame file", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		_, err = io.Copy(out, f)
		f.Close()
		out.Close()
		if err != nil {
			slog.Error("write frame file", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		frameCount++
	}

	if frameCount == 0 {
		http.Error(w, "no frames uploaded", http.StatusBadRequest)
		return
	}

	slog.Info("export started", "format", format, "frames", frameCount, "fps", fps)

	// Build and run ffmpeg command
	var outputFile string
	var contentType string
	var cmdErr error

	switch format {
	case "mp4":
		outputFile = filepath.Join(tempDir, "output.mp4")
		contentType = "video/mp4"
		cmdErr = h.runFfmpeg(r, tempDir, fps,
			"-framerate", strconv.Itoa(fps),
			"-i", filepath.Join(tempDir, "frame_%04d.png"),
			"-c:v", "libx264",
			"-pix_fmt", "yuv420p",
			"-crf", "18",
			"-preset", "fast",
			"-movflags", "+faststart",
			outputFile,
		)

	case "gif":
		outputFile = filepath.Join(tempDir, "output.gif")
		contentType = "image/gif"
		// Two-pass GIF: generate palette then apply
		palettePath := filepath.Join(tempDir, "palette.png")
		cmdErr = h.runFfmpeg(r, tempDir, fps,
			"-framerate", strconv.Itoa(fps),
			"-i", filepath.Join(tempDir, "frame_%04d.png"),
			"-vf", "palettegen=stats_mode=diff",
			palettePath,
		)
		if cmdErr == nil {
			cmdErr = h.runFfmpeg(r, tempDir, fps,
				"-framerate", strconv.Itoa(fps),
				"-i", filepath.Join(tempDir, "frame_%04d.png"),
				"-i", palettePath,
				"-lavfi", "paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
				outputFile,
			)
		}

	case "webm":
		outputFile = filepath.Join(tempDir, "output.webm")
		contentType = "video/webm"
		cmdErr = h.runFfmpeg(r, tempDir, fps,
			"-framerate", strconv.Itoa(fps),
			"-i", filepath.Join(tempDir, "frame_%04d.png"),
			"-c:v", "libvpx-vp9",
			"-crf", "30",
			"-b:v", "0",
			"-pix_fmt", "yuva420p",
			outputFile,
		)
	}

	if cmdErr != nil {
		slog.Error("ffmpeg failed", "error", cmdErr)
		http.Error(w, fmt.Sprintf("encoding failed: %v", cmdErr), http.StatusInternalServerError)
		return
	}

	// Stream result file back
	outFile, err := os.Open(outputFile)
	if err != nil {
		slog.Error("open output file", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer outFile.Close()

	stat, err := outFile.Stat()
	if err != nil {
		slog.Error("stat output file", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.%s"`, name, format))
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	io.Copy(w, outFile)

	slog.Info("export complete", "format", format, "size", stat.Size())
}

func (h *Handler) runFfmpeg(r *http.Request, _ string, _ int, args ...string) error {
	// Prepend -y to overwrite output without prompting
	fullArgs := append([]string{"-y"}, args...)
	cmd := exec.CommandContext(r.Context(), h.ffmpegPath, fullArgs...)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%v: %s", err, stderr.String())
	}
	return nil
}
