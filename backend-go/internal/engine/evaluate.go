package engine

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/inamate/inamate/backend-go/internal/document"
)

// PropertyOverrides holds interpolated property values from keyframe evaluation.
// Keys are property paths like "transform.x", "transform.r", "style.opacity".
type PropertyOverrides map[string]float64

// EvaluateTimeline evaluates all tracks in a timeline at the given frame.
// Returns a map of objectId -> PropertyOverrides.
func EvaluateTimeline(doc *document.InDocument, timelineID string, frame int) map[string]PropertyOverrides {
	result := make(map[string]PropertyOverrides)

	timeline, ok := doc.Timelines[timelineID]
	if !ok {
		return result
	}

	for _, trackID := range timeline.Tracks {
		track, ok := doc.Tracks[trackID]
		if !ok {
			continue
		}

		value := interpolateTrack(doc, &track, frame)
		if value == nil {
			continue
		}

		if result[track.ObjectID] == nil {
			result[track.ObjectID] = make(PropertyOverrides)
		}
		result[track.ObjectID][track.Property] = *value
	}

	return result
}

// interpolateTrack evaluates a single track at the given frame.
func interpolateTrack(doc *document.InDocument, track *document.Track, frame int) *float64 {
	if len(track.Keys) == 0 {
		return nil
	}

	// Collect and sort keyframes by frame number
	keyframes := make([]document.Keyframe, 0, len(track.Keys))
	for _, kfID := range track.Keys {
		if kf, ok := doc.Keyframes[kfID]; ok {
			keyframes = append(keyframes, kf)
		}
	}

	if len(keyframes) == 0 {
		return nil
	}

	sort.Slice(keyframes, func(i, j int) bool {
		return keyframes[i].Frame < keyframes[j].Frame
	})

	// Find surrounding keyframes
	var prev, next *document.Keyframe
	for i := range keyframes {
		if keyframes[i].Frame <= frame {
			prev = &keyframes[i]
		}
		if keyframes[i].Frame >= frame && next == nil {
			next = &keyframes[i]
		}
	}

	// Before first keyframe - use first value
	if prev == nil && next != nil {
		return parseKeyframeValue(next.Value)
	}

	// After last keyframe - use last value (hold)
	if next == nil && prev != nil {
		return parseKeyframeValue(prev.Value)
	}

	// Exact keyframe or same keyframe
	if prev == next || prev.Frame == next.Frame {
		return parseKeyframeValue(prev.Value)
	}

	// Interpolate between prev and next
	prevVal := parseKeyframeValue(prev.Value)
	nextVal := parseKeyframeValue(next.Value)
	if prevVal == nil || nextVal == nil {
		return prevVal
	}

	// Calculate interpolation factor
	t := float64(frame-prev.Frame) / float64(next.Frame-prev.Frame)
	t = applyEasing(t, prev.Easing)

	// Linear interpolation
	result := *prevVal + (*nextVal-*prevVal)*t
	return &result
}

// parseKeyframeValue extracts a float64 from a keyframe's JSON value.
func parseKeyframeValue(raw json.RawMessage) *float64 {
	var v float64
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	return &v
}

// applyEasing applies an easing function to interpolation factor t (0-1).
func applyEasing(t float64, easing document.EasingType) float64 {
	switch easing {
	case document.EasingEaseIn:
		// Quadratic ease-in: t^2
		return t * t

	case document.EasingEaseOut:
		// Quadratic ease-out: 1 - (1-t)^2 = t(2-t)
		return t * (2 - t)

	case document.EasingEaseInOut:
		// Quadratic ease-in-out
		if t < 0.5 {
			return 2 * t * t
		}
		return -1 + (4-2*t)*t

	default: // linear
		return t
	}
}

// ApplyOverridesToTransform applies property overrides to a base transform.
func ApplyOverridesToTransform(base document.Transform, overrides PropertyOverrides) document.Transform {
	result := base

	if v, ok := overrides["transform.x"]; ok {
		result.X = v
	}
	if v, ok := overrides["transform.y"]; ok {
		result.Y = v
	}
	if v, ok := overrides["transform.sx"]; ok {
		result.SX = v
	}
	if v, ok := overrides["transform.sy"]; ok {
		result.SY = v
	}
	if v, ok := overrides["transform.r"]; ok {
		result.R = v
	}
	if v, ok := overrides["transform.ax"]; ok {
		result.AX = v
	}
	if v, ok := overrides["transform.ay"]; ok {
		result.AY = v
	}

	return result
}

// ApplyOverridesToStyle applies property overrides to a base style.
func ApplyOverridesToStyle(base document.Style, overrides PropertyOverrides) document.Style {
	result := base

	if v, ok := overrides["style.opacity"]; ok {
		result.Opacity = v
	}
	if v, ok := overrides["style.strokeWidth"]; ok {
		result.StrokeWidth = v
	}

	return result
}

// GetSymbolTimelineID extracts the timeline ID from a Symbol's data.
func GetSymbolTimelineID(data json.RawMessage) string {
	var symbolData struct {
		TimelineID string `json:"timelineId"`
	}
	if err := json.Unmarshal(data, &symbolData); err != nil {
		return ""
	}
	return symbolData.TimelineID
}

// IsTransformProperty checks if a property path is a transform property.
func IsTransformProperty(property string) bool {
	return strings.HasPrefix(property, "transform.")
}

// IsStyleProperty checks if a property path is a style property.
func IsStyleProperty(property string) bool {
	return strings.HasPrefix(property, "style.")
}
