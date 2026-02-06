package engine

import (
	"encoding/json"
	"math"

	"github.com/inamate/inamate/backend-go/internal/document"
)

// BuildSceneGraph builds a render-ready scene graph from the document at the given frame.
// If playing is true, animation keyframes are evaluated and applied to transforms.
// If playing is false, the document's raw transform values are used (edit mode).
func BuildSceneGraph(doc *document.InDocument, sceneID string, frame int, rootTimelineID string, playing bool) *SceneGraph {
	sg := NewSceneGraph()

	scene, ok := doc.Scenes[sceneID]
	if !ok {
		return sg
	}

	rootObj, ok := doc.Objects[scene.Root]
	if !ok {
		return sg
	}

	// Only evaluate timeline overrides when playing (preview mode)
	// In edit mode, show the document's actual transform values
	var overrides map[string]PropertyOverrides
	if playing {
		overrides = EvaluateTimeline(doc, rootTimelineID, frame)
	} else {
		overrides = make(map[string]PropertyOverrides)
	}

	// Build the tree starting from root
	sg.Root = buildNode(doc, &rootObj, nil, Identity(), 1.0, overrides, frame, sg, playing)
	sg.Dirty = false

	return sg
}

// buildNode recursively builds a SceneNode from a document ObjectNode.
func buildNode(
	doc *document.InDocument,
	obj *document.ObjectNode,
	parent *SceneNode,
	parentWorldTransform Matrix2D,
	parentOpacity float64,
	overrides map[string]PropertyOverrides,
	frame int,
	sg *SceneGraph,
	playing bool,
) *SceneNode {
	if !obj.Visible {
		return nil
	}

	// For Symbols, evaluate their nested timeline FIRST so overrides apply to the Symbol itself
	// Only evaluate when playing
	if playing && obj.Type == document.ObjectTypeSymbol {
		symbolTimelineID := GetSymbolTimelineID(obj.Data)
		if symbolTimelineID != "" {
			// Evaluate the symbol's timeline and merge overrides
			symbolOverrides := EvaluateTimeline(doc, symbolTimelineID, frame)
			for objID, props := range symbolOverrides {
				if overrides[objID] == nil {
					overrides[objID] = make(PropertyOverrides)
				}
				for k, v := range props {
					overrides[objID][k] = v
				}
			}
		}
	}

	// Apply property overrides if any
	transform := obj.Transform
	style := obj.Style
	if objOverrides, ok := overrides[obj.ID]; ok {
		transform = ApplyOverridesToTransform(transform, objOverrides)
		style = ApplyOverridesToStyle(style, objOverrides)
	}

	// Compute local and world transforms
	localMatrix := FromTransform(
		transform.X, transform.Y,
		transform.SX, transform.SY,
		transform.R,
		transform.AX, transform.AY,
	)
	worldMatrix := parentWorldTransform.Multiply(localMatrix)

	// Compute inherited opacity
	opacity := parentOpacity * style.Opacity

	// Create the scene node
	node := &SceneNode{
		ID:             obj.ID,
		Type:           mapObjectType(obj.Type),
		LocalTransform: localMatrix,
		WorldTransform: worldMatrix,
		Opacity:        opacity,
		Visible:        true,
		Parent:         parent,
		Fill:           style.Fill,
		Stroke:         style.Stroke,
		StrokeWidth:    style.StrokeWidth,
	}

	// Generate path data based on object type
	switch obj.Type {
	case document.ObjectTypeShapeRect:
		node.Path = generateRectPath(obj.Data)
		node.Bounds = computePathBounds(node.Path, worldMatrix)

	case document.ObjectTypeShapeEllipse:
		node.Path = generateEllipsePath(obj.Data)
		node.Bounds = computePathBounds(node.Path, worldMatrix)

	case document.ObjectTypeVectorPath:
		node.Path = extractVectorPath(obj.Data)
		node.Bounds = computePathBounds(node.Path, worldMatrix)

	case document.ObjectTypeRasterImage:
		node.Type = "image"
		var imgData struct {
			AssetID string  `json:"assetId"`
			Width   float64 `json:"width"`
			Height  float64 `json:"height"`
		}
		if err := json.Unmarshal(obj.Data, &imgData); err == nil {
			node.ImageAssetID = imgData.AssetID
			node.ImageWidth = imgData.Width
			node.ImageHeight = imgData.Height
			// Compute bounds from image dimensions
			corners := [][2]float64{
				{0, 0},
				{imgData.Width, 0},
				{imgData.Width, imgData.Height},
				{0, imgData.Height},
			}
			var bMinX, bMinY, bMaxX, bMaxY float64
			for i, c := range corners {
				wx, wy := worldMatrix.TransformPoint(c[0], c[1])
				if i == 0 {
					bMinX, bMaxX = wx, wx
					bMinY, bMaxY = wy, wy
				} else {
					bMinX = math.Min(bMinX, wx)
					bMaxX = math.Max(bMaxX, wx)
					bMinY = math.Min(bMinY, wy)
					bMaxY = math.Max(bMaxY, wy)
				}
			}
			node.Bounds = Rect{X: bMinX, Y: bMinY, Width: bMaxX - bMinX, Height: bMaxY - bMinY}
		}

	case document.ObjectTypeSymbol:
		// Symbol timeline already evaluated above before applying overrides
	}

	// Register node in the lookup map
	sg.NodesById[obj.ID] = node

	// Build children
	for _, childID := range obj.Children {
		childObj, ok := doc.Objects[childID]
		if !ok {
			continue
		}

		childNode := buildNode(doc, &childObj, node, worldMatrix, opacity, overrides, frame, sg, playing)
		if childNode != nil {
			node.Children = append(node.Children, childNode)

			// Expand bounds to include children
			if !childNode.Bounds.IsEmpty() {
				node.Bounds = node.Bounds.Union(childNode.Bounds)
			}
		}
	}

	return node
}

// mapObjectType converts document ObjectType to scene graph type string.
func mapObjectType(objType document.ObjectType) string {
	switch objType {
	case document.ObjectTypeGroup:
		return "group"
	case document.ObjectTypeShapeRect, document.ObjectTypeShapeEllipse, document.ObjectTypeVectorPath:
		return "shape"
	case document.ObjectTypeSymbol:
		return "symbol"
	case document.ObjectTypeRasterImage:
		return "image"
	default:
		return "unknown"
	}
}

// generateRectPath generates path commands for a rectangle.
func generateRectPath(data json.RawMessage) []PathCommand {
	var rectData struct {
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
	}
	if err := json.Unmarshal(data, &rectData); err != nil {
		return nil
	}

	w, h := rectData.Width, rectData.Height
	return []PathCommand{
		{"M", 0.0, 0.0},
		{"L", w, 0.0},
		{"L", w, h},
		{"L", 0.0, h},
		{"Z"},
	}
}

// generateEllipsePath generates path commands for an ellipse using bezier curves.
func generateEllipsePath(data json.RawMessage) []PathCommand {
	var ellipseData struct {
		RX float64 `json:"rx"`
		RY float64 `json:"ry"`
	}
	if err := json.Unmarshal(data, &ellipseData); err != nil {
		return nil
	}

	rx, ry := ellipseData.RX, ellipseData.RY

	// Magic number for bezier approximation of a circle/ellipse
	// k = 4 * (sqrt(2) - 1) / 3 ≈ 0.5522847498
	k := 0.5522847498
	kx, ky := rx*k, ry*k

	// Four bezier curves to approximate an ellipse
	return []PathCommand{
		{"M", rx, 0.0},
		{"C", rx, ky, kx, ry, 0.0, ry},
		{"C", -kx, ry, -rx, ky, -rx, 0.0},
		{"C", -rx, -ky, -kx, -ry, 0.0, -ry},
		{"C", kx, -ry, rx, -ky, rx, 0.0},
		{"Z"},
	}
}

// extractVectorPath extracts path commands from a VectorPath's data.
func extractVectorPath(data json.RawMessage) []PathCommand {
	var pathData struct {
		Commands [][]interface{} `json:"commands"`
	}
	if err := json.Unmarshal(data, &pathData); err != nil {
		return nil
	}

	result := make([]PathCommand, len(pathData.Commands))
	for i, cmd := range pathData.Commands {
		result[i] = PathCommand(cmd)
	}
	return result
}

// computePathBounds computes the axis-aligned bounding box of a path in world space.
func computePathBounds(path []PathCommand, worldTransform Matrix2D) Rect {
	if len(path) == 0 {
		return Rect{}
	}

	var minX, minY, maxX, maxY float64
	first := true

	var curX, curY float64

	for _, cmd := range path {
		if len(cmd) == 0 {
			continue
		}

		op, ok := cmd[0].(string)
		if !ok {
			continue
		}

		switch op {
		case "M", "L":
			if len(cmd) >= 3 {
				x := toFloat64(cmd[1])
				y := toFloat64(cmd[2])
				curX, curY = x, y
				wx, wy := worldTransform.TransformPoint(x, y)
				if first {
					minX, maxX = wx, wx
					minY, maxY = wy, wy
					first = false
				} else {
					minX = math.Min(minX, wx)
					maxX = math.Max(maxX, wx)
					minY = math.Min(minY, wy)
					maxY = math.Max(maxY, wy)
				}
			}

		case "C":
			// Cubic bezier: include all control points and endpoint
			if len(cmd) >= 7 {
				points := []struct{ x, y float64 }{
					{toFloat64(cmd[1]), toFloat64(cmd[2])},
					{toFloat64(cmd[3]), toFloat64(cmd[4])},
					{toFloat64(cmd[5]), toFloat64(cmd[6])},
				}
				for _, p := range points {
					wx, wy := worldTransform.TransformPoint(p.x, p.y)
					if first {
						minX, maxX = wx, wx
						minY, maxY = wy, wy
						first = false
					} else {
						minX = math.Min(minX, wx)
						maxX = math.Max(maxX, wx)
						minY = math.Min(minY, wy)
						maxY = math.Max(maxY, wy)
					}
				}
				curX, curY = points[2].x, points[2].y
			}

		case "Q":
			// Quadratic bezier
			if len(cmd) >= 5 {
				points := []struct{ x, y float64 }{
					{toFloat64(cmd[1]), toFloat64(cmd[2])},
					{toFloat64(cmd[3]), toFloat64(cmd[4])},
				}
				for _, p := range points {
					wx, wy := worldTransform.TransformPoint(p.x, p.y)
					if first {
						minX, maxX = wx, wx
						minY, maxY = wy, wy
						first = false
					} else {
						minX = math.Min(minX, wx)
						maxX = math.Max(maxX, wx)
						minY = math.Min(minY, wy)
						maxY = math.Max(maxY, wy)
					}
				}
				curX, curY = points[1].x, points[1].y
			}

		case "Z":
			// Close path - no new points
		}
	}

	// Suppress unused variable warning
	_ = curX
	_ = curY

	if first {
		return Rect{}
	}

	return Rect{
		X:      minX,
		Y:      minY,
		Width:  maxX - minX,
		Height: maxY - minY,
	}
}

// toFloat64 converts an interface{} to float64.
func toFloat64(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	default:
		return 0
	}
}
