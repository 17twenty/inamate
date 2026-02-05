package typeid

import (
	"fmt"

	"go.jetify.com/typeid/v2"
)

const (
	PrefixUser     = "user"
	PrefixProject  = "proj"
	PrefixSnapshot = "snap"
	PrefixOp       = "op"
	PrefixScene    = "scene"
	PrefixObject   = "obj"
	PrefixTimeline = "tl"
	PrefixTrack    = "track"
	PrefixKeyframe = "kf"
	PrefixAsset    = "asset"
	PrefixExport   = "exp"
)

func New(prefix string) string {
	id := typeid.MustGenerate(prefix)
	return id.String()
}

func NewUserID() string     { return New(PrefixUser) }
func NewProjectID() string  { return New(PrefixProject) }
func NewSnapshotID() string { return New(PrefixSnapshot) }
func NewOpID() string       { return New(PrefixOp) }
func NewSceneID() string    { return New(PrefixScene) }
func NewObjectID() string   { return New(PrefixObject) }
func NewTimelineID() string { return New(PrefixTimeline) }
func NewTrackID() string    { return New(PrefixTrack) }
func NewKeyframeID() string { return New(PrefixKeyframe) }
func NewAssetID() string    { return New(PrefixAsset) }
func NewExportID() string   { return New(PrefixExport) }

func Validate(id, expectedPrefix string) error {
	parsed, err := typeid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid typeid %q: %w", id, err)
	}
	if parsed.Prefix() != expectedPrefix {
		return fmt.Errorf("expected prefix %q but got %q in id %q", expectedPrefix, parsed.Prefix(), id)
	}
	return nil
}
