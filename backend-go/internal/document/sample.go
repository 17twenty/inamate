package document

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/inamate/inamate/backend-go/internal/typeid"
)

func NewSampleDocument(projectID string) *InDocument {
	now := time.Now().UTC().Format(time.RFC3339)

	sceneID := typeid.NewSceneID()
	rootID := typeid.NewObjectID()
	rectID := typeid.NewObjectID()
	ellipseID := typeid.NewObjectID()
	triangleID := typeid.NewObjectID()
	timelineID := typeid.NewTimelineID()

	// Spinner symbol
	spinnerID := typeid.NewObjectID()
	spinnerRectID := typeid.NewObjectID()
	spinnerEllipseID := typeid.NewObjectID()
	spinnerTimelineID := typeid.NewTimelineID()
	spinnerTrackID := typeid.New("track")
	kf0ID := typeid.New("kf")
	kf1ID := typeid.New("kf")

	rootIDPtr := &rootID
	spinnerIDPtr := &spinnerID

	return &InDocument{
		Project: Project{
			ID:           projectID,
			Name:         "Untitled",
			Version:      1,
			FPS:          24,
			CreatedAt:    now,
			UpdatedAt:    now,
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
				Children: []string{rectID, ellipseID, triangleID, spinnerID},
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
			rectID: {
				ID:       rectID,
				Type:     ObjectTypeShapeRect,
				Parent:   rootIDPtr,
				Children: []string{},
				Transform: Transform{
					X: 200, Y: 200, SX: 1, SY: 1, R: 0, AX: 0, AY: 0,
				},
				Style: Style{
					Fill: "#e94560", Stroke: "#000000", StrokeWidth: 2, Opacity: 1,
				},
				Visible: true,
				Locked:  false,
				Data:    json.RawMessage(`{"width": 200, "height": 150}`),
			},
			ellipseID: {
				ID:       ellipseID,
				Type:     ObjectTypeShapeEllipse,
				Parent:   rootIDPtr,
				Children: []string{},
				Transform: Transform{
					X: 640, Y: 360, SX: 1, SY: 1, R: 0, AX: 0, AY: 0,
				},
				Style: Style{
					Fill: "#0f3460", Stroke: "#16213e", StrokeWidth: 2, Opacity: 1,
				},
				Visible: true,
				Locked:  false,
				Data:    json.RawMessage(`{"rx": 120, "ry": 80}`),
			},
			triangleID: {
				ID:       triangleID,
				Type:     ObjectTypeVectorPath,
				Parent:   rootIDPtr,
				Children: []string{},
				Transform: Transform{
					X: 900, Y: 200, SX: 1, SY: 1, R: 0, AX: 0, AY: 0,
				},
				Style: Style{
					Fill: "#53d769", Stroke: "#2d6a4f", StrokeWidth: 2, Opacity: 1,
				},
				Visible: true,
				Locked:  false,
				Data:    json.RawMessage(`{"commands": [["M", 0, 150], ["L", 100, 0], ["L", 200, 150], ["Z"]]}`),
			},
			spinnerID: {
				ID:       spinnerID,
				Type:     ObjectTypeSymbol,
				Parent:   rootIDPtr,
				Children: []string{spinnerRectID, spinnerEllipseID},
				Transform: Transform{
					X: 500, Y: 450, SX: 1, SY: 1, R: 0, AX: 0, AY: 0,
				},
				Style: Style{
					Fill: "", Stroke: "", StrokeWidth: 0, Opacity: 1,
				},
				Visible: true,
				Locked:  false,
				Data:    json.RawMessage(fmt.Sprintf(`{"timelineId": "%s"}`, spinnerTimelineID)),
			},
			spinnerRectID: {
				ID:       spinnerRectID,
				Type:     ObjectTypeShapeRect,
				Parent:   spinnerIDPtr,
				Children: []string{},
				Transform: Transform{
					X: -30, Y: -50, SX: 1, SY: 1, R: 0, AX: 0, AY: 0,
				},
				Style: Style{
					Fill: "#f5a623", Stroke: "#c78400", StrokeWidth: 2, Opacity: 1,
				},
				Visible: true,
				Locked:  false,
				Data:    json.RawMessage(`{"width": 60, "height": 100}`),
			},
			spinnerEllipseID: {
				ID:       spinnerEllipseID,
				Type:     ObjectTypeShapeEllipse,
				Parent:   spinnerIDPtr,
				Children: []string{},
				Transform: Transform{
					X: 0, Y: -70, SX: 1, SY: 1, R: 0, AX: 0, AY: 0,
				},
				Style: Style{
					Fill: "#bd10e0", Stroke: "#8b0ba8", StrokeWidth: 2, Opacity: 1,
				},
				Visible: true,
				Locked:  false,
				Data:    json.RawMessage(`{"rx": 20, "ry": 20}`),
			},
		},
		Timelines: map[string]Timeline{
			timelineID: {
				ID:     timelineID,
				Length: 48,
				Tracks: []string{},
			},
			spinnerTimelineID: {
				ID:     spinnerTimelineID,
				Length: 24,
				Tracks: []string{spinnerTrackID},
			},
		},
		Tracks: map[string]Track{
			spinnerTrackID: {
				ID:       spinnerTrackID,
				ObjectID: spinnerID,
				Property: "transform.r",
				Keys:     []string{kf0ID, kf1ID},
			},
		},
		Keyframes: map[string]Keyframe{
			kf0ID: {
				ID:     kf0ID,
				Frame:  0,
				Value:  json.RawMessage(`0`),
				Easing: EasingLinear,
			},
			kf1ID: {
				ID:     kf1ID,
				Frame:  23,
				Value:  json.RawMessage(`360`),
				Easing: EasingLinear,
			},
		},
		Assets: map[string]Asset{},
	}
}
