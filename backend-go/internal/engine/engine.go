package engine

import (
	"encoding/json"

	"github.com/inamate/inamate/backend-go/internal/document"
)

// Engine is the main animation engine that owns the document and scene graph state.
// It processes commands from the frontend and returns query results.
type Engine struct {
	// Document state
	doc     *document.InDocument
	sceneID string

	// Retained scene graph
	sceneGraph *SceneGraph

	// Playback state
	frame   int
	playing bool
	fps     int

	// Total frames in root timeline
	totalFrames int

	// Selection state (backend owns this)
	selection []string

	// Dirty flag - scene graph needs rebuild
	dirty bool
}

// NewEngine creates a new engine instance.
func NewEngine() *Engine {
	return &Engine{
		fps:        24,
		sceneGraph: NewSceneGraph(),
		dirty:      true,
	}
}

// --- Commands (frontend → backend) ---

// LoadDocument loads a document from JSON.
func (e *Engine) LoadDocument(jsonData string) error {
	var doc document.InDocument
	if err := json.Unmarshal([]byte(jsonData), &doc); err != nil {
		return err
	}

	e.doc = &doc
	e.fps = doc.Project.FPS
	if e.fps <= 0 {
		e.fps = 24
	}

	// Set default scene
	if len(doc.Project.Scenes) > 0 {
		e.sceneID = doc.Project.Scenes[0]
	}

	// Get total frames from root timeline
	if tl, ok := doc.Timelines[doc.Project.RootTimeline]; ok {
		e.totalFrames = tl.Length
	} else {
		e.totalFrames = 48
	}

	e.frame = 0
	e.playing = false
	e.selection = nil
	e.dirty = true

	return nil
}

// UpdateDocument reloads a document from JSON while preserving playback state.
// Used when the document changes during editing/playback (e.g. keyframe recording).
func (e *Engine) UpdateDocument(jsonData string) error {
	var doc document.InDocument
	if err := json.Unmarshal([]byte(jsonData), &doc); err != nil {
		return err
	}

	e.doc = &doc
	e.fps = doc.Project.FPS
	if e.fps <= 0 {
		e.fps = 24
	}

	if len(doc.Project.Scenes) > 0 {
		e.sceneID = doc.Project.Scenes[0]
	}

	if tl, ok := doc.Timelines[doc.Project.RootTimeline]; ok {
		e.totalFrames = tl.Length
	} else {
		e.totalFrames = 48
	}

	// Clamp frame to valid range (but don't reset it)
	if e.frame >= e.totalFrames {
		e.frame = e.totalFrames - 1
	}
	if e.frame < 0 {
		e.frame = 0
	}

	// Preserve playing state and selection — don't reset them
	e.dirty = true

	return nil
}

// LoadSampleDocument loads the built-in sample document.
func (e *Engine) LoadSampleDocument(projectID string) {
	e.doc = document.NewSampleDocument(projectID)
	e.fps = e.doc.Project.FPS
	if e.fps <= 0 {
		e.fps = 24
	}

	if len(e.doc.Project.Scenes) > 0 {
		e.sceneID = e.doc.Project.Scenes[0]
	}

	if tl, ok := e.doc.Timelines[e.doc.Project.RootTimeline]; ok {
		e.totalFrames = tl.Length
	} else {
		e.totalFrames = 48
	}

	e.frame = 0
	e.playing = false
	e.selection = nil
	e.dirty = true
}

// SetPlayhead sets the current frame.
func (e *Engine) SetPlayhead(frame int) {
	if frame < 0 {
		frame = 0
	}
	if frame >= e.totalFrames {
		frame = e.totalFrames - 1
	}
	if e.frame != frame {
		e.frame = frame
		e.dirty = true
	}
}

// Play starts playback.
func (e *Engine) Play() {
	e.playing = true
}

// Pause stops playback.
func (e *Engine) Pause() {
	e.playing = false
}

// TogglePlay toggles play/pause state.
func (e *Engine) TogglePlay() {
	e.playing = !e.playing
}

// SetSelection sets the selected object IDs.
func (e *Engine) SetSelection(ids []string) {
	e.selection = ids
}

// Tick advances the frame if playing and returns draw commands.
// This is called once per animation frame from the frontend.
func (e *Engine) Tick() string {
	if e.playing {
		e.frame = (e.frame + 1) % e.totalFrames
		e.dirty = true
	}

	return e.Render()
}

// --- Queries (frontend ← backend) ---

// Render evaluates the scene graph and returns draw commands as JSON.
func (e *Engine) Render() string {
	if e.doc == nil {
		return "[]"
	}

	// Rebuild scene graph if dirty
	if e.dirty {
		e.sceneGraph = BuildSceneGraph(
			e.doc,
			e.sceneID,
			e.frame,
			e.doc.Project.RootTimeline,
			e.playing, // Only apply animation overrides when playing
		)
		e.dirty = false
	}

	// Compile to draw commands
	commands := CompileDrawCommands(e.sceneGraph)

	// Serialize to JSON
	result, _ := DrawCommandsToJSON(commands)
	return result
}

// HitTest performs a hit test at the given coordinates.
// Returns the object ID of the topmost hit, or empty string.
func (e *Engine) HitTest(x, y float64) string {
	if e.sceneGraph == nil {
		return ""
	}
	return HitTest(e.sceneGraph, x, y)
}

// GetSelectionBounds returns the bounding box of the current selection as JSON.
func (e *Engine) GetSelectionBounds() string {
	if e.sceneGraph == nil || len(e.selection) == 0 {
		return RectToJSON(Rect{})
	}
	bounds := GetSelectionBounds(e.sceneGraph, e.selection)
	return RectToJSON(bounds)
}

// GetScene returns the current scene metadata as JSON.
func (e *Engine) GetScene() string {
	if e.doc == nil || e.sceneID == "" {
		return "{}"
	}

	scene, ok := e.doc.Scenes[e.sceneID]
	if !ok {
		return "{}"
	}

	data, _ := json.Marshal(scene)
	return string(data)
}

// GetPlaybackState returns the current playback state as JSON.
func (e *Engine) GetPlaybackState() string {
	data, _ := json.Marshal(map[string]interface{}{
		"frame":       e.frame,
		"playing":     e.playing,
		"fps":         e.fps,
		"totalFrames": e.totalFrames,
	})
	return string(data)
}

// GetRootTimelineID returns the root timeline ID.
func (e *Engine) GetRootTimelineID() string {
	if e.doc == nil {
		return ""
	}
	return e.doc.Project.RootTimeline
}

// GetTimelineLength returns the length of a timeline.
func (e *Engine) GetTimelineLength(timelineID string) int {
	if e.doc == nil {
		return 0
	}
	if tl, ok := e.doc.Timelines[timelineID]; ok {
		return tl.Length
	}
	return 0
}

// GetDocument returns the full document as JSON (for debugging/sync).
func (e *Engine) GetDocument() string {
	if e.doc == nil {
		return "{}"
	}
	data, _ := json.Marshal(e.doc)
	return string(data)
}

// GetSelection returns the current selection as JSON.
func (e *Engine) GetSelection() string {
	data, _ := json.Marshal(e.selection)
	return string(data)
}

// GetFrame returns the current frame number.
func (e *Engine) GetFrame() int {
	return e.frame
}

// IsPlaying returns whether playback is active.
func (e *Engine) IsPlaying() bool {
	return e.playing
}

// GetFPS returns the frames per second.
func (e *Engine) GetFPS() int {
	return e.fps
}

// GetTotalFrames returns the total number of frames.
func (e *Engine) GetTotalFrames() int {
	return e.totalFrames
}
