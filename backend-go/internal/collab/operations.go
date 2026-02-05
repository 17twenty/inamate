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
}

// NewDocumentState creates a new document state from an initial document
func NewDocumentState(doc *document.InDocument) *DocumentState {
	return &DocumentState{
		doc:       doc,
		serverSeq: 0,
		opLog:     make([]Operation, 0),
	}
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
	case "scene.update":
		return ds.applySceneUpdate(op)
	case "project.rename":
		return ds.applyProjectRename(op)
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

func (ds *DocumentState) applyProjectRename(op Operation) error {
	ds.doc.Project.Name = op.Name
	return nil
}

// GetServerTimestamp returns the current server timestamp
func GetServerTimestamp() int64 {
	return time.Now().UnixMilli()
}
