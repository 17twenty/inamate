package engine

import (
	"encoding/json"
)

// DrawCommand represents a single drawing operation for the frontend to execute.
// The frontend receives a list of these and executes them on a Canvas2D context.
type DrawCommand struct {
	Op           string        `json:"op"`                     // Operation: "path", "image", "save", "restore", "clip"
	ObjectID     string        `json:"objectId,omitempty"`     // For hit correlation
	Transform    []float64     `json:"transform,omitempty"`    // [a, b, c, d, e, f] affine matrix
	Path         []PathCommand `json:"path,omitempty"`         // Path data for "path" ops
	Fill         string        `json:"fill,omitempty"`         // Fill color
	Stroke       string        `json:"stroke,omitempty"`       // Stroke color
	StrokeWidth  float64       `json:"strokeWidth,omitempty"`  // Stroke width
	Opacity      float64       `json:"opacity,omitempty"`      // Global alpha
	ImageAssetID string        `json:"imageAssetId,omitempty"` // Asset ID for image lookup
	ImageWidth   float64       `json:"imageWidth,omitempty"`   // Image natural width
	ImageHeight  float64       `json:"imageHeight,omitempty"`  // Image natural height
}

// CompileDrawCommands generates a draw command buffer from a scene graph.
// Commands are in painter's order (back to front).
func CompileDrawCommands(sg *SceneGraph) []DrawCommand {
	if sg == nil || sg.Root == nil {
		return nil
	}

	var commands []DrawCommand
	compileNode(sg.Root, &commands)
	return commands
}

// compileNode recursively generates draw commands for a node and its children.
func compileNode(node *SceneNode, commands *[]DrawCommand) {
	if node == nil || !node.Visible {
		return
	}

	// Handle clipping/masking
	hasClip := node.ClipPath != nil
	if hasClip {
		*commands = append(*commands, DrawCommand{Op: "save"})
		// Compile the clip path
		if len(node.ClipPath.Path) > 0 {
			*commands = append(*commands, DrawCommand{
				Op:        "clip",
				Transform: node.ClipPath.WorldTransform.ToSlice(),
				Path:      node.ClipPath.Path,
			})
		}
	}

	// If this node has renderable content, emit a draw command
	if node.Type == "image" && node.ImageAssetID != "" {
		cmd := DrawCommand{
			Op:           "image",
			ObjectID:     node.ID,
			Transform:    node.WorldTransform.ToSlice(),
			Opacity:      node.Opacity,
			ImageAssetID: node.ImageAssetID,
			ImageWidth:   node.ImageWidth,
			ImageHeight:  node.ImageHeight,
		}
		*commands = append(*commands, cmd)
	} else if len(node.Path) > 0 {
		cmd := DrawCommand{
			Op:          "path",
			ObjectID:    node.ID,
			Transform:   node.WorldTransform.ToSlice(),
			Path:        node.Path,
			Opacity:     node.Opacity,
			Fill:        node.Fill,
			Stroke:      node.Stroke,
			StrokeWidth: node.StrokeWidth,
		}
		*commands = append(*commands, cmd)
	}

	// Recurse into children
	for _, child := range node.Children {
		compileNode(child, commands)
	}

	// Restore state if we saved it for clipping
	if hasClip {
		*commands = append(*commands, DrawCommand{Op: "restore"})
	}
}

// DrawCommandsToJSON serializes draw commands to JSON.
func DrawCommandsToJSON(commands []DrawCommand) (string, error) {
	data, err := json.Marshal(commands)
	if err != nil {
		return "[]", err
	}
	return string(data), nil
}

// HitTestResult contains information about a hit test.
type HitTestResult struct {
	ObjectID string  `json:"objectId"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
}

// HitTest performs a hit test on the scene graph at the given point.
// Returns the ID of the topmost (frontmost) object containing the point, or empty string.
func HitTest(sg *SceneGraph, x, y float64) string {
	if sg == nil || sg.Root == nil {
		return ""
	}

	// Traverse in reverse order (front to back) to get topmost hit
	return hitTestNode(sg.Root, x, y)
}

// hitTestNode recursively tests a node and its children.
// Children are tested first (they're on top in painter's order).
func hitTestNode(node *SceneNode, x, y float64) string {
	if node == nil || !node.Visible {
		return ""
	}

	// Test children first (front to back = reverse order)
	for i := len(node.Children) - 1; i >= 0; i-- {
		if hit := hitTestNode(node.Children[i], x, y); hit != "" {
			return hit
		}
	}

	// Test this node if it has bounds and renderable content (path or image)
	if (len(node.Path) > 0 || node.Type == "image") && !node.Bounds.IsEmpty() {
		if node.Bounds.Contains(x, y) {
			return node.ID
		}
	}

	return ""
}

// GetSelectionBounds returns the combined bounding box of the given object IDs.
func GetSelectionBounds(sg *SceneGraph, objectIDs []string) Rect {
	if sg == nil || len(objectIDs) == 0 {
		return Rect{}
	}

	var result Rect
	first := true

	for _, id := range objectIDs {
		node, ok := sg.NodesById[id]
		if !ok || node.Bounds.IsEmpty() {
			continue
		}

		if first {
			result = node.Bounds
			first = false
		} else {
			result = result.Union(node.Bounds)
		}
	}

	return result
}

// RectToJSON serializes a Rect to JSON.
func RectToJSON(r Rect) string {
	data, _ := json.Marshal(map[string]float64{
		"x":      r.X,
		"y":      r.Y,
		"width":  r.Width,
		"height": r.Height,
	})
	return string(data)
}
