package collab

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/inamate/inamate/backend-go/internal/document"
)

// DocumentState holds the authoritative document state for a room
type DocumentState struct {
	mu        sync.RWMutex
	doc       *document.InDocument
	serverSeq int64
	opLog     []Operation // Operation history for persistence
	dirty     bool        // Has unsaved changes
}

// NewDocumentState creates a new document state from an initial document
func NewDocumentState(doc *document.InDocument) *DocumentState {
	return &DocumentState{
		doc:       doc,
		serverSeq: 0,
		opLog:     make([]Operation, 0),
		dirty:     false,
	}
}

// IsDirty returns whether the document has unsaved changes
func (ds *DocumentState) IsDirty() bool {
	ds.mu.RLock()
	defer ds.mu.RUnlock()
	return ds.dirty
}

// MarkClean marks the document as saved
func (ds *DocumentState) MarkClean() {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	ds.dirty = false
}

// GetDocument returns a copy of the current document
func (ds *DocumentState) GetDocument() *document.InDocument {
	ds.mu.RLock()
	defer ds.mu.RUnlock()
	// Return the document directly (caller should not mutate)
	return ds.doc
}

// ApplyOperation applies an operation to the document and returns the server sequence
func (ds *DocumentState) ApplyOperation(op Operation) (int64, error) {
	ds.mu.Lock()
	defer ds.mu.Unlock()

	if err := ds.applyOperationLocked(op); err != nil {
		return 0, err
	}

	ds.serverSeq++
	ds.opLog = append(ds.opLog, op)
	ds.dirty = true

	return ds.serverSeq, nil
}

// applyOperationLocked applies the operation without locking (caller must hold lock)
func (ds *DocumentState) applyOperationLocked(op Operation) error {
	switch op.Type {
	case "object.transform":
		return ds.applyTransform(op)
	case "object.style":
		return ds.applyStyle(op)
	case "object.delete":
		return ds.applyDelete(op)
	case "object.create":
		return ds.applyCreate(op)
	case "object.reparent":
		return ds.applyReparent(op)
	case "object.visibility":
		return ds.applyVisibility(op)
	case "object.locked":
		return ds.applyLocked(op)
	case "object.data":
		return ds.applyData(op)
	case "timeline.update":
		return ds.applyTimelineUpdate(op)
	case "scene.update":
		return ds.applySceneUpdate(op)
	case "scene.create":
		return ds.applySceneCreate(op)
	case "scene.delete":
		return ds.applySceneDelete(op)
	case "project.rename":
		return ds.applyProjectRename(op)
	case "track.create":
		return ds.applyTrackCreate(op)
	case "track.delete":
		return ds.applyTrackDelete(op)
	case "keyframe.add":
		return ds.applyKeyframeAdd(op)
	case "keyframe.update":
		return ds.applyKeyframeUpdate(op)
	case "keyframe.delete":
		return ds.applyKeyframeDelete(op)
	default:
		return fmt.Errorf("unknown operation type: %s", op.Type)
	}
}

func (ds *DocumentState) applyTransform(op Operation) error {
	obj, ok := ds.doc.Objects[op.ObjectID]
	if !ok {
		return fmt.Errorf("object not found: %s", op.ObjectID)
	}

	// Parse transform changes
	var changes map[string]float64
	if err := json.Unmarshal(op.Transform, &changes); err != nil {
		return fmt.Errorf("invalid transform: %w", err)
	}

	// Apply changes
	if v, ok := changes["x"]; ok {
		obj.Transform.X = v
	}
	if v, ok := changes["y"]; ok {
		obj.Transform.Y = v
	}
	if v, ok := changes["sx"]; ok {
		obj.Transform.SX = v
	}
	if v, ok := changes["sy"]; ok {
		obj.Transform.SY = v
	}
	if v, ok := changes["r"]; ok {
		obj.Transform.R = v
	}
	if v, ok := changes["ax"]; ok {
		obj.Transform.AX = v
	}
	if v, ok := changes["ay"]; ok {
		obj.Transform.AY = v
	}
	if v, ok := changes["skewX"]; ok {
		obj.Transform.SkewX = v
	}
	if v, ok := changes["skewY"]; ok {
		obj.Transform.SkewY = v
	}

	ds.doc.Objects[op.ObjectID] = obj
	return nil
}

func (ds *DocumentState) applyStyle(op Operation) error {
	obj, ok := ds.doc.Objects[op.ObjectID]
	if !ok {
		return fmt.Errorf("object not found: %s", op.ObjectID)
	}

	// Parse style changes
	var changes map[string]interface{}
	if err := json.Unmarshal(op.Style, &changes); err != nil {
		return fmt.Errorf("invalid style: %w", err)
	}

	// Apply changes
	if v, ok := changes["fill"].(string); ok {
		obj.Style.Fill = v
	}
	if v, ok := changes["stroke"].(string); ok {
		obj.Style.Stroke = v
	}
	if v, ok := changes["strokeWidth"].(float64); ok {
		obj.Style.StrokeWidth = v
	}
	if v, ok := changes["opacity"].(float64); ok {
		obj.Style.Opacity = v
	}

	ds.doc.Objects[op.ObjectID] = obj
	return nil
}

func (ds *DocumentState) applyDelete(op Operation) error {
	obj, ok := ds.doc.Objects[op.ObjectID]
	if !ok {
		return fmt.Errorf("object not found: %s", op.ObjectID)
	}

	// Remove from parent's children
	if obj.Parent != nil {
		parent, ok := ds.doc.Objects[*obj.Parent]
		if ok {
			newChildren := make([]string, 0, len(parent.Children))
			for _, childID := range parent.Children {
				if childID != op.ObjectID {
					newChildren = append(newChildren, childID)
				}
			}
			parent.Children = newChildren
			ds.doc.Objects[*obj.Parent] = parent
		}
	}

	// Delete the object
	delete(ds.doc.Objects, op.ObjectID)
	return nil
}

func (ds *DocumentState) applyCreate(op Operation) error {
	// Parse the object
	var obj document.ObjectNode
	if err := json.Unmarshal(op.Object, &obj); err != nil {
		return fmt.Errorf("invalid object: %w", err)
	}

	// If a bundled asset is included (e.g. for RasterImage), add it to the document
	if op.Asset != nil {
		var asset document.Asset
		if err := json.Unmarshal(op.Asset, &asset); err != nil {
			return fmt.Errorf("invalid asset: %w", err)
		}
		if ds.doc.Assets == nil {
			ds.doc.Assets = make(map[string]document.Asset)
		}
		ds.doc.Assets[asset.ID] = asset
		ds.doc.Project.Assets = append(ds.doc.Project.Assets, asset.ID)
	}

	// Add to objects map
	ds.doc.Objects[obj.ID] = obj

	// Add to parent's children
	if op.ParentID != "" {
		parent, ok := ds.doc.Objects[op.ParentID]
		if ok {
			if op.Index != nil && *op.Index >= 0 && *op.Index <= len(parent.Children) {
				// Insert at specific index
				newChildren := make([]string, 0, len(parent.Children)+1)
				newChildren = append(newChildren, parent.Children[:*op.Index]...)
				newChildren = append(newChildren, obj.ID)
				newChildren = append(newChildren, parent.Children[*op.Index:]...)
				parent.Children = newChildren
			} else {
				// Append to end
				parent.Children = append(parent.Children, obj.ID)
			}
			ds.doc.Objects[op.ParentID] = parent
		}
	}

	return nil
}

func (ds *DocumentState) applyReparent(op Operation) error {
	obj, ok := ds.doc.Objects[op.ObjectID]
	if !ok {
		return fmt.Errorf("object not found: %s", op.ObjectID)
	}

	// Remove from old parent
	if obj.Parent != nil {
		oldParent, ok := ds.doc.Objects[*obj.Parent]
		if ok {
			newChildren := make([]string, 0, len(oldParent.Children))
			for _, childID := range oldParent.Children {
				if childID != op.ObjectID {
					newChildren = append(newChildren, childID)
				}
			}
			oldParent.Children = newChildren
			ds.doc.Objects[*obj.Parent] = oldParent
		}
	}

	// Add to new parent
	newParent, ok := ds.doc.Objects[op.NewParentID]
	if !ok {
		return fmt.Errorf("new parent not found: %s", op.NewParentID)
	}

	// Insert at specific index
	if op.NewIndex >= 0 && op.NewIndex <= len(newParent.Children) {
		newChildren := make([]string, 0, len(newParent.Children)+1)
		newChildren = append(newChildren, newParent.Children[:op.NewIndex]...)
		newChildren = append(newChildren, op.ObjectID)
		newChildren = append(newChildren, newParent.Children[op.NewIndex:]...)
		newParent.Children = newChildren
	} else {
		newParent.Children = append(newParent.Children, op.ObjectID)
	}
	ds.doc.Objects[op.NewParentID] = newParent

	// Update object's parent reference
	obj.Parent = &op.NewParentID
	ds.doc.Objects[op.ObjectID] = obj

	return nil
}

func (ds *DocumentState) applyVisibility(op Operation) error {
	obj, ok := ds.doc.Objects[op.ObjectID]
	if !ok {
		return fmt.Errorf("object not found: %s", op.ObjectID)
	}

	if op.Visible != nil {
		obj.Visible = *op.Visible
	}

	ds.doc.Objects[op.ObjectID] = obj
	return nil
}

func (ds *DocumentState) applyLocked(op Operation) error {
	obj, ok := ds.doc.Objects[op.ObjectID]
	if !ok {
		return fmt.Errorf("object not found: %s", op.ObjectID)
	}

	if op.Locked != nil {
		obj.Locked = *op.Locked
	}

	ds.doc.Objects[op.ObjectID] = obj
	return nil
}

func (ds *DocumentState) applyData(op Operation) error {
	obj, ok := ds.doc.Objects[op.ObjectID]
	if !ok {
		return fmt.Errorf("object not found: %s", op.ObjectID)
	}

	// Merge changes into existing data
	var existing map[string]interface{}
	if len(obj.Data) > 0 {
		if err := json.Unmarshal(obj.Data, &existing); err != nil {
			existing = make(map[string]interface{})
		}
	} else {
		existing = make(map[string]interface{})
	}

	var changes map[string]interface{}
	if err := json.Unmarshal(op.Data, &changes); err != nil {
		return fmt.Errorf("invalid data: %w", err)
	}

	for k, v := range changes {
		existing[k] = v
	}

	merged, err := json.Marshal(existing)
	if err != nil {
		return fmt.Errorf("failed to marshal data: %w", err)
	}
	obj.Data = merged
	ds.doc.Objects[op.ObjectID] = obj
	return nil
}

func (ds *DocumentState) applySceneUpdate(op Operation) error {
	scene, ok := ds.doc.Scenes[op.SceneID]
	if !ok {
		return fmt.Errorf("scene not found: %s", op.SceneID)
	}

	var changes map[string]interface{}
	if err := json.Unmarshal(op.Changes, &changes); err != nil {
		return fmt.Errorf("invalid scene changes: %w", err)
	}

	if v, ok := changes["name"].(string); ok {
		scene.Name = v
	}
	if v, ok := changes["width"].(float64); ok {
		scene.Width = int(v)
	}
	if v, ok := changes["height"].(float64); ok {
		scene.Height = int(v)
	}
	if v, ok := changes["background"].(string); ok {
		scene.Background = v
	}

	ds.doc.Scenes[op.SceneID] = scene
	return nil
}

func (ds *DocumentState) applyTimelineUpdate(op Operation) error {
	if op.TimelineID == "" {
		return fmt.Errorf("timelineId is required")
	}

	timeline, ok := ds.doc.Timelines[op.TimelineID]
	if !ok {
		return fmt.Errorf("timeline not found: %s", op.TimelineID)
	}

	var changes map[string]interface{}
	if err := json.Unmarshal(op.Changes, &changes); err != nil {
		return fmt.Errorf("invalid timeline changes: %w", err)
	}

	if v, ok := changes["length"].(float64); ok {
		timeline.Length = int(v)
	}

	ds.doc.Timelines[op.TimelineID] = timeline
	return nil
}

func (ds *DocumentState) applySceneCreate(op Operation) error {
	if op.Scene == nil {
		return fmt.Errorf("scene is required")
	}
	if op.RootObject == nil {
		return fmt.Errorf("rootObject is required")
	}

	var scene document.Scene
	if err := json.Unmarshal(op.Scene, &scene); err != nil {
		return fmt.Errorf("invalid scene data: %w", err)
	}

	// Guard against duplicate application
	if _, exists := ds.doc.Scenes[scene.ID]; exists {
		return nil
	}

	var rootObj document.ObjectNode
	if err := json.Unmarshal(op.RootObject, &rootObj); err != nil {
		return fmt.Errorf("invalid root object data: %w", err)
	}

	ds.doc.Scenes[scene.ID] = scene
	ds.doc.Objects[rootObj.ID] = rootObj
	ds.doc.Project.Scenes = append(ds.doc.Project.Scenes, scene.ID)

	return nil
}

func (ds *DocumentState) applySceneDelete(op Operation) error {
	if op.SceneID == "" {
		return fmt.Errorf("sceneId is required")
	}

	scene, ok := ds.doc.Scenes[op.SceneID]
	if !ok {
		return fmt.Errorf("scene not found: %s", op.SceneID)
	}

	// Remove the root object
	delete(ds.doc.Objects, scene.Root)

	// Remove the scene
	delete(ds.doc.Scenes, op.SceneID)

	// Remove from project scenes list
	newScenes := make([]string, 0, len(ds.doc.Project.Scenes))
	for _, id := range ds.doc.Project.Scenes {
		if id != op.SceneID {
			newScenes = append(newScenes, id)
		}
	}
	ds.doc.Project.Scenes = newScenes

	return nil
}

func (ds *DocumentState) applyProjectRename(op Operation) error {
	ds.doc.Project.Name = op.Name
	return nil
}

func (ds *DocumentState) applyTrackCreate(op Operation) error {
	if op.TimelineID == "" {
		return fmt.Errorf("timelineId is required")
	}
	if op.Track == nil {
		return fmt.Errorf("track is required")
	}

	// Parse the track data
	var trackData struct {
		ID       string   `json:"id"`
		ObjectID string   `json:"objectId"`
		Property string   `json:"property"`
		Keys     []string `json:"keys"`
	}
	if err := json.Unmarshal(op.Track, &trackData); err != nil {
		return fmt.Errorf("invalid track data: %w", err)
	}

	// Get the timeline
	timeline, ok := ds.doc.Timelines[op.TimelineID]
	if !ok {
		return fmt.Errorf("timeline not found: %s", op.TimelineID)
	}

	// Create the track
	track := document.Track{
		ID:       trackData.ID,
		ObjectID: trackData.ObjectID,
		Property: trackData.Property,
		Keys:     trackData.Keys,
	}
	if track.Keys == nil {
		track.Keys = []string{}
	}

	// Add to tracks map
	ds.doc.Tracks[trackData.ID] = track

	// Add track ID to timeline's tracks array
	timeline.Tracks = append(timeline.Tracks, trackData.ID)
	ds.doc.Timelines[op.TimelineID] = timeline

	return nil
}

func (ds *DocumentState) applyTrackDelete(op Operation) error {
	if op.TrackID == "" {
		return fmt.Errorf("trackId is required")
	}
	if op.TimelineID == "" {
		return fmt.Errorf("timelineId is required")
	}

	// Get the timeline
	timeline, ok := ds.doc.Timelines[op.TimelineID]
	if !ok {
		return fmt.Errorf("timeline not found: %s", op.TimelineID)
	}

	// Remove track from timeline's tracks array
	newTracks := make([]string, 0, len(timeline.Tracks))
	for _, tid := range timeline.Tracks {
		if tid != op.TrackID {
			newTracks = append(newTracks, tid)
		}
	}
	timeline.Tracks = newTracks
	ds.doc.Timelines[op.TimelineID] = timeline

	// Remove from tracks map
	delete(ds.doc.Tracks, op.TrackID)

	return nil
}

func (ds *DocumentState) applyKeyframeAdd(op Operation) error {
	if op.TrackID == "" {
		return fmt.Errorf("trackId is required")
	}

	// Parse keyframe from nested object
	var kfData struct {
		ID     string          `json:"id"`
		Frame  int             `json:"frame"`
		Value  json.RawMessage `json:"value"`
		Easing string          `json:"easing"`
	}
	if op.Keyframe != nil {
		if err := json.Unmarshal(op.Keyframe, &kfData); err != nil {
			return fmt.Errorf("invalid keyframe data: %w", err)
		}
	} else {
		// Fallback to flat fields for backwards compatibility
		if op.KeyframeID == "" {
			return fmt.Errorf("keyframeId is required")
		}
		if op.Frame == nil {
			return fmt.Errorf("frame is required")
		}
		kfData.ID = op.KeyframeID
		kfData.Frame = *op.Frame
		kfData.Value = op.Value
		kfData.Easing = op.Easing
	}

	// Get the track
	track, ok := ds.doc.Tracks[op.TrackID]
	if !ok {
		return fmt.Errorf("track not found: %s", op.TrackID)
	}

	// Create the keyframe
	easing := document.EasingLinear
	if kfData.Easing != "" {
		easing = document.EasingType(kfData.Easing)
	}

	keyframe := document.Keyframe{
		ID:     kfData.ID,
		Frame:  kfData.Frame,
		Value:  kfData.Value,
		Easing: easing,
	}

	// Add to keyframes map
	ds.doc.Keyframes[kfData.ID] = keyframe

	// Add to track's keys array (maintain sorted order by frame)
	inserted := false
	newKeys := make([]string, 0, len(track.Keys)+1)
	for _, keyID := range track.Keys {
		existingKey, exists := ds.doc.Keyframes[keyID]
		if exists && !inserted && existingKey.Frame > kfData.Frame {
			newKeys = append(newKeys, kfData.ID)
			inserted = true
		}
		newKeys = append(newKeys, keyID)
	}
	if !inserted {
		newKeys = append(newKeys, kfData.ID)
	}
	track.Keys = newKeys
	ds.doc.Tracks[op.TrackID] = track

	return nil
}

func (ds *DocumentState) applyKeyframeUpdate(op Operation) error {
	if op.KeyframeID == "" {
		return fmt.Errorf("keyframeId is required")
	}

	keyframe, ok := ds.doc.Keyframes[op.KeyframeID]
	if !ok {
		return fmt.Errorf("keyframe not found: %s", op.KeyframeID)
	}

	// Parse changes from nested object if present
	var newFrame *int
	if op.Changes != nil {
		var changes struct {
			Frame  *int            `json:"frame,omitempty"`
			Value  json.RawMessage `json:"value,omitempty"`
			Easing string          `json:"easing,omitempty"`
		}
		if err := json.Unmarshal(op.Changes, &changes); err != nil {
			return fmt.Errorf("invalid changes data: %w", err)
		}
		if changes.Frame != nil {
			keyframe.Frame = *changes.Frame
			newFrame = changes.Frame
		}
		if changes.Value != nil {
			keyframe.Value = changes.Value
		}
		if changes.Easing != "" {
			keyframe.Easing = document.EasingType(changes.Easing)
		}
	} else {
		// Fallback to flat fields for backwards compatibility
		if op.Frame != nil {
			keyframe.Frame = *op.Frame
			newFrame = op.Frame
		}
		if op.Value != nil {
			keyframe.Value = op.Value
		}
		if op.Easing != "" {
			keyframe.Easing = document.EasingType(op.Easing)
		}
	}

	ds.doc.Keyframes[op.KeyframeID] = keyframe

	// If frame changed, re-sort the track's keys
	if newFrame != nil && op.TrackID != "" {
		track, ok := ds.doc.Tracks[op.TrackID]
		if ok {
			// Remove and re-insert to maintain sort order
			newKeys := make([]string, 0, len(track.Keys))
			for _, keyID := range track.Keys {
				if keyID != op.KeyframeID {
					newKeys = append(newKeys, keyID)
				}
			}

			// Re-insert at correct position
			inserted := false
			sortedKeys := make([]string, 0, len(newKeys)+1)
			for _, keyID := range newKeys {
				existingKey, exists := ds.doc.Keyframes[keyID]
				if exists && !inserted && existingKey.Frame > *newFrame {
					sortedKeys = append(sortedKeys, op.KeyframeID)
					inserted = true
				}
				sortedKeys = append(sortedKeys, keyID)
			}
			if !inserted {
				sortedKeys = append(sortedKeys, op.KeyframeID)
			}
			track.Keys = sortedKeys
			ds.doc.Tracks[op.TrackID] = track
		}
	}

	return nil
}

func (ds *DocumentState) applyKeyframeDelete(op Operation) error {
	if op.KeyframeID == "" {
		return fmt.Errorf("keyframeId is required")
	}
	if op.TrackID == "" {
		return fmt.Errorf("trackId is required")
	}

	// Remove from track's keys
	track, ok := ds.doc.Tracks[op.TrackID]
	if ok {
		newKeys := make([]string, 0, len(track.Keys))
		for _, keyID := range track.Keys {
			if keyID != op.KeyframeID {
				newKeys = append(newKeys, keyID)
			}
		}
		track.Keys = newKeys
		ds.doc.Tracks[op.TrackID] = track
	}

	// Remove from keyframes map
	delete(ds.doc.Keyframes, op.KeyframeID)

	return nil
}

// GetServerTimestamp returns the current server timestamp
func GetServerTimestamp() int64 {
	return time.Now().UnixMilli()
}
