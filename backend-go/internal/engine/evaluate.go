package engine

import (
	"encoding/json"
	"math"
	"sort"
	"strings"

	"github.com/inamate/inamate/backend-go/internal/document"
)

// PropertyOverrides holds interpolated numeric property values from keyframe evaluation.
// Keys are property paths like "transform.x", "transform.r", "style.opacity".
type PropertyOverrides map[string]float64

// StringPropertyOverrides holds step-interpolated string property values (e.g. colors).
type StringPropertyOverrides map[string]string

// EvalResult contains both numeric and string property overrides per object.
type EvalResult struct {
	Numeric map[string]PropertyOverrides
	Strings map[string]StringPropertyOverrides
}

// EvaluateTimeline evaluates all tracks in a timeline at the given frame.
// Returns numeric overrides (linearly interpolated) and string overrides (step/hold).
func EvaluateTimeline(doc *document.InDocument, timelineID string, frame int) EvalResult {
	result := EvalResult{
		Numeric: make(map[string]PropertyOverrides),
		Strings: make(map[string]StringPropertyOverrides),
	}

	timeline, ok := doc.Timelines[timelineID]
	if !ok {
		return result
	}

	for _, trackID := range timeline.Tracks {
		track, ok := doc.Tracks[trackID]
		if !ok {
			continue
		}

		// Try numeric interpolation first
		value := interpolateTrack(doc, &track, frame)
		if value != nil {
			if result.Numeric[track.ObjectID] == nil {
				result.Numeric[track.ObjectID] = make(PropertyOverrides)
			}
			result.Numeric[track.ObjectID][track.Property] = *value
			continue
		}

		// Fall back to string step interpolation (for colors etc.)
		strValue := interpolateStringTrack(doc, &track, frame)
		if strValue != nil {
			if result.Strings[track.ObjectID] == nil {
				result.Strings[track.ObjectID] = make(StringPropertyOverrides)
			}
			result.Strings[track.ObjectID][track.Property] = *strValue
		}
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

// interpolateStringTrack evaluates a string track at the given frame using step/hold interpolation.
// Returns the string value of the keyframe at or before the current frame.
func interpolateStringTrack(doc *document.InDocument, track *document.Track, frame int) *string {
	if len(track.Keys) == 0 {
		return nil
	}

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

	// Find the keyframe at or before the current frame (step/hold)
	var prev *document.Keyframe
	for i := range keyframes {
		if keyframes[i].Frame <= frame {
			prev = &keyframes[i]
		}
	}

	// Before first keyframe — use first value
	if prev == nil {
		return parseStringKeyframeValue(keyframes[0].Value)
	}

	return parseStringKeyframeValue(prev.Value)
}

// parseStringKeyframeValue extracts a string from a keyframe's JSON value.
func parseStringKeyframeValue(raw json.RawMessage) *string {
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	return &v
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
		return t * t

	case document.EasingEaseOut:
		return t * (2 - t)

	case document.EasingEaseInOut:
		if t < 0.5 {
			return 2 * t * t
		}
		return -1 + (4-2*t)*t

	case document.EasingCubicIn:
		return t * t * t

	case document.EasingCubicOut:
		t2 := 1 - t
		return 1 - t2*t2*t2

	case document.EasingCubicInOut:
		if t < 0.5 {
			return 4 * t * t * t
		}
		t2 := -2*t + 2
		return 1 - t2*t2*t2/2

	case document.EasingBackIn:
		c1 := 1.70158
		c3 := c1 + 1
		return c3*t*t*t - c1*t*t

	case document.EasingBackOut:
		c1 := 1.70158
		c3 := c1 + 1
		t2 := t - 1
		return 1 + c3*t2*t2*t2 + c1*t2*t2

	case document.EasingBackInOut:
		c1 := 1.70158
		c2 := c1 * 1.525
		if t < 0.5 {
			return (math.Pow(2*t, 2) * ((c2+1)*2*t - c2)) / 2
		}
		return (math.Pow(2*t-2, 2)*((c2+1)*(t*2-2)+c2) + 2) / 2

	case document.EasingElasticOut:
		if t == 0 || t == 1 {
			return t
		}
		c4 := (2 * math.Pi) / 3
		return math.Pow(2, -10*t)*math.Sin((t*10-0.75)*c4) + 1

	case document.EasingBounceOut:
		return bounceOut(t)

	default: // linear
		return t
	}
}

// bounceOut implements the standard 4-segment parabolic bounce curve.
func bounceOut(t float64) float64 {
	n1 := 7.5625
	d1 := 2.75
	if t < 1/d1 {
		return n1 * t * t
	} else if t < 2/d1 {
		t -= 1.5 / d1
		return n1*t*t + 0.75
	} else if t < 2.5/d1 {
		t -= 2.25 / d1
		return n1*t*t + 0.9375
	} else {
		t -= 2.625 / d1
		return n1*t*t + 0.984375
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
	if v, ok := overrides["transform.skewX"]; ok {
		result.SkewX = v
	}
	if v, ok := overrides["transform.skewY"]; ok {
		result.SkewY = v
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

// ApplyStringOverridesToStyle applies string property overrides (fill, stroke) to a base style.
func ApplyStringOverridesToStyle(base document.Style, overrides StringPropertyOverrides) document.Style {
	result := base

	if v, ok := overrides["style.fill"]; ok {
		result.Fill = v
	}
	if v, ok := overrides["style.stroke"]; ok {
		result.Stroke = v
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
