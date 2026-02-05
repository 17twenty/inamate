package document

import "encoding/json"

type InDocument struct {
	Project   Project               `json:"project"`
	Scenes    map[string]Scene      `json:"scenes"`
	Objects   map[string]ObjectNode `json:"objects"`
	Timelines map[string]Timeline   `json:"timelines"`
	Tracks    map[string]Track      `json:"tracks"`
	Keyframes map[string]Keyframe   `json:"keyframes"`
	Assets    map[string]Asset      `json:"assets"`
}

type Project struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Version      int      `json:"version"`
	FPS          int      `json:"fps"`
	CreatedAt    string   `json:"createdAt"`
	UpdatedAt    string   `json:"updatedAt"`
	Scenes       []string `json:"scenes"`
	Assets       []string `json:"assets"`
	RootTimeline string   `json:"rootTimeline"`
}

type Scene struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Background string `json:"background"`
	Root       string `json:"root"`
}

type ObjectType string

const (
	ObjectTypeGroup        ObjectType = "Group"
	ObjectTypeShapeRect    ObjectType = "ShapeRect"
	ObjectTypeShapeEllipse ObjectType = "ShapeEllipse"
	ObjectTypeVectorPath   ObjectType = "VectorPath"
	ObjectTypeRasterImage  ObjectType = "RasterImage"
	ObjectTypeSymbol       ObjectType = "Symbol"
)

type Transform struct {
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	SX float64 `json:"sx"`
	SY float64 `json:"sy"`
	R  float64 `json:"r"`
	AX float64 `json:"ax"`
	AY float64 `json:"ay"`
}

type Style struct {
	Fill        string  `json:"fill"`
	Stroke      string  `json:"stroke"`
	StrokeWidth float64 `json:"strokeWidth"`
	Opacity     float64 `json:"opacity"`
}

type ObjectNode struct {
	ID        string          `json:"id"`
	Type      ObjectType      `json:"type"`
	Parent    *string         `json:"parent"`
	Children  []string        `json:"children"`
	Transform Transform       `json:"transform"`
	Style     Style           `json:"style"`
	Visible   bool            `json:"visible"`
	Locked    bool            `json:"locked"`
	Data      json.RawMessage `json:"data"`
}

type Timeline struct {
	ID     string   `json:"id"`
	Length int      `json:"length"`
	Tracks []string `json:"tracks"`
}

type Track struct {
	ID       string   `json:"id"`
	ObjectID string   `json:"objectId"`
	Property string   `json:"property"`
	Keys     []string `json:"keys"`
}

type EasingType string

const (
	EasingLinear    EasingType = "linear"
	EasingEaseIn    EasingType = "easeIn"
	EasingEaseOut   EasingType = "easeOut"
	EasingEaseInOut EasingType = "easeInOut"
)

type Keyframe struct {
	ID     string          `json:"id"`
	Frame  int             `json:"frame"`
	Value  json.RawMessage `json:"value"`
	Easing EasingType      `json:"easing"`
}

type Asset struct {
	ID   string          `json:"id"`
	Type string          `json:"type"`
	Name string          `json:"name"`
	URL  string          `json:"url"`
	Meta json.RawMessage `json:"meta"`
}

// NewEmptyDocument creates an empty document for a new project
func NewEmptyDocument(projectID, projectName, sceneID, rootID, timelineID string) *InDocument {
	return &InDocument{
		Project: Project{
			ID:           projectID,
			Name:         projectName,
			Version:      1,
			FPS:          24,
			CreatedAt:    "", // Will be set by caller
			UpdatedAt:    "",
			Scenes:       []string{sceneID},
			Assets:       []string{},
			RootTimeline: timelineID,
		},
		Scenes: map[string]Scene{
			sceneID: {
				ID:         sceneID,
				Name:       "Scene 1",
				Width:      1280,
				Height:     720,
				Background: "#1a1a2e",
				Root:       rootID,
			},
		},
		Objects: map[string]ObjectNode{
			rootID: {
				ID:       rootID,
				Type:     ObjectTypeGroup,
				Parent:   nil,
				Children: []string{},
				Transform: Transform{
					X: 0, Y: 0, SX: 1, SY: 1, R: 0, AX: 0, AY: 0,
				},
				Style: Style{
					Fill: "", Stroke: "", StrokeWidth: 0, Opacity: 1,
				},
				Visible: true,
				Locked:  false,
				Data:    json.RawMessage(`{}`),
			},
		},
		Timelines: map[string]Timeline{
			timelineID: {
				ID:     timelineID,
				Length: 48,
				Tracks: []string{},
			},
		},
		Tracks:    map[string]Track{},
		Keyframes: map[string]Keyframe{},
		Assets:    map[string]Asset{},
	}
}
