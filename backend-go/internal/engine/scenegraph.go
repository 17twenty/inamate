package engine

// SceneGraph is the evaluated, render-ready state of the document at a point in time.
// This is the retained scene graph - it persists between frames and is incrementally updated.
type SceneGraph struct {
	Root      *SceneNode
	NodesById map[string]*SceneNode
	Dirty     bool // needs re-evaluation
}

// SceneNode is a resolved node ready for rendering.
// All transforms are computed, all properties are resolved (including inherited ones).
type SceneNode struct {
	ID   string
	Type string // "group", "shape", "symbol", "mask"

	// Transform state
	WorldTransform Matrix2D // computed world transform (parent * local)
	LocalTransform Matrix2D // local transform from document + overrides

	// Inherited/resolved properties
	Opacity float64 // inherited * local
	Visible bool

	// Hierarchy
	Parent   *SceneNode
	Children []*SceneNode

	// Clipping/masking
	ClipPath *SceneNode // mask reference if any

	// Render data (resolved from document)
	Path        []PathCommand // for shapes
	Fill        string
	Stroke      string
	StrokeWidth float64

	// Image data (for RasterImage nodes)
	ImageAssetID string
	ImageWidth   float64
	ImageHeight  float64

	// Hit testing
	Bounds Rect // axis-aligned bounding box in world space
}

// PathCommand represents a single path segment for rendering.
// Format matches Canvas2D: ["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y], etc.
type PathCommand []interface{}

// Rect represents an axis-aligned bounding box.
type Rect struct {
	X      float64
	Y      float64
	Width  float64
	Height float64
}

// NewSceneGraph creates an empty scene graph.
func NewSceneGraph() *SceneGraph {
	return &SceneGraph{
		NodesById: make(map[string]*SceneNode),
		Dirty:     true,
	}
}

// Contains checks if a point is inside the rect.
func (r Rect) Contains(x, y float64) bool {
	return x >= r.X && x <= r.X+r.Width && y >= r.Y && y <= r.Y+r.Height
}

// IsEmpty checks if the rect has zero or negative area.
func (r Rect) IsEmpty() bool {
	return r.Width <= 0 || r.Height <= 0
}

// Union returns the smallest rect containing both rects.
func (r Rect) Union(other Rect) Rect {
	if r.IsEmpty() {
		return other
	}
	if other.IsEmpty() {
		return r
	}

	minX := min(r.X, other.X)
	minY := min(r.Y, other.Y)
	maxX := max(r.X+r.Width, other.X+other.Width)
	maxY := max(r.Y+r.Height, other.Y+other.Height)

	return Rect{
		X:      minX,
		Y:      minY,
		Width:  maxX - minX,
		Height: maxY - minY,
	}
}

// Center returns the center point of the rect.
func (r Rect) Center() (float64, float64) {
	return r.X + r.Width/2, r.Y + r.Height/2
}
