//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/inamate/inamate/backend-go/internal/document"
	"github.com/inamate/inamate/backend-go/internal/engine"
)

var eng *engine.Engine

func main() {
	eng = engine.NewEngine()

	// Create the engine API object
	inamateEngine := js.Global().Get("Object").New()

	// --- Commands (frontend → backend) ---
	inamateEngine.Set("loadDocument", js.FuncOf(loadDocument))
	inamateEngine.Set("updateDocument", js.FuncOf(updateDocument))
	inamateEngine.Set("loadSampleDocument", js.FuncOf(loadSampleDocument))
	inamateEngine.Set("setPlayhead", js.FuncOf(setPlayhead))
	inamateEngine.Set("play", js.FuncOf(play))
	inamateEngine.Set("pause", js.FuncOf(pause))
	inamateEngine.Set("togglePlay", js.FuncOf(togglePlay))
	inamateEngine.Set("setScene", js.FuncOf(setScene))
	inamateEngine.Set("setSelection", js.FuncOf(setSelection))
	inamateEngine.Set("setDragOverlay", js.FuncOf(setDragOverlay))
	inamateEngine.Set("updateDragOverlay", js.FuncOf(updateDragOverlay))
	inamateEngine.Set("clearDragOverlay", js.FuncOf(clearDragOverlay))
	inamateEngine.Set("tick", js.FuncOf(tick))

	// --- Queries (frontend ← backend) ---
	inamateEngine.Set("render", js.FuncOf(render))
	inamateEngine.Set("hitTest", js.FuncOf(hitTest))
	inamateEngine.Set("getSelectionBounds", js.FuncOf(getSelectionBounds))
	inamateEngine.Set("getScene", js.FuncOf(getScene))
	inamateEngine.Set("getPlaybackState", js.FuncOf(getPlaybackState))
	inamateEngine.Set("getAnimatedTransform", js.FuncOf(getAnimatedTransform))
	inamateEngine.Set("getDocument", js.FuncOf(getDocument))
	inamateEngine.Set("getSelection", js.FuncOf(getSelection))
	inamateEngine.Set("getFrame", js.FuncOf(getFrame))
	inamateEngine.Set("isPlaying", js.FuncOf(isPlaying))
	inamateEngine.Set("getFPS", js.FuncOf(getFPS))
	inamateEngine.Set("getTotalFrames", js.FuncOf(getTotalFrames))

	// Register on global scope
	js.Global().Set("inamateEngine", inamateEngine)

	// Signal that WASM is ready
	js.Global().Set("inamateWasmReady", js.ValueOf(true))

	// Keep Go runtime alive
	select {}
}

// --- Command Handlers ---

func loadDocument(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return js.ValueOf(map[string]interface{}{"error": "missing document JSON"})
	}

	jsonData := args[0].String()
	if err := eng.LoadDocument(jsonData); err != nil {
		return js.ValueOf(map[string]interface{}{"error": err.Error()})
	}

	return js.ValueOf(map[string]interface{}{"ok": true})
}

func updateDocument(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return js.ValueOf(map[string]interface{}{"error": "missing document JSON"})
	}

	jsonData := args[0].String()
	if err := eng.UpdateDocument(jsonData); err != nil {
		return js.ValueOf(map[string]interface{}{"error": err.Error()})
	}

	return js.ValueOf(map[string]interface{}{"ok": true})
}

func loadSampleDocument(this js.Value, args []js.Value) interface{} {
	projectID := "proj_sample"
	if len(args) > 0 && args[0].Type() == js.TypeString {
		projectID = args[0].String()
	}

	eng.LoadSampleDocument(projectID)
	return js.ValueOf(map[string]interface{}{"ok": true})
}

func setPlayhead(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return nil
	}
	frame := args[0].Int()
	eng.SetPlayhead(frame)
	return nil
}

func play(this js.Value, args []js.Value) interface{} {
	eng.Play()
	return nil
}

func pause(this js.Value, args []js.Value) interface{} {
	eng.Pause()
	return nil
}

func togglePlay(this js.Value, args []js.Value) interface{} {
	eng.TogglePlay()
	return nil
}

func setScene(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return nil
	}
	eng.SetScene(args[0].String())
	return nil
}

func setSelection(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		eng.SetSelection(nil)
		return nil
	}

	arr := args[0]
	if arr.Type() != js.TypeObject {
		eng.SetSelection(nil)
		return nil
	}

	length := arr.Length()
	ids := make([]string, length)
	for i := 0; i < length; i++ {
		ids[i] = arr.Index(i).String()
	}
	eng.SetSelection(ids)
	return nil
}

func setDragOverlay(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return nil
	}
	var transforms map[string]document.Transform
	if err := json.Unmarshal([]byte(args[0].String()), &transforms); err != nil {
		return nil
	}
	eng.SetDragOverlay(transforms)
	return nil
}

func updateDragOverlay(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return nil
	}
	var transforms map[string]document.Transform
	if err := json.Unmarshal([]byte(args[0].String()), &transforms); err != nil {
		return nil
	}
	eng.UpdateDragOverlay(transforms)
	return nil
}

func clearDragOverlay(this js.Value, args []js.Value) interface{} {
	eng.ClearDragOverlay()
	return nil
}

func tick(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.Tick())
}

// --- Query Handlers ---

func render(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.Render())
}

func hitTest(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return js.ValueOf("")
	}
	x := args[0].Float()
	y := args[1].Float()
	return js.ValueOf(eng.HitTest(x, y))
}

func getSelectionBounds(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.GetSelectionBounds())
}

func getScene(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.GetScene())
}

func getPlaybackState(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.GetPlaybackState())
}

func getAnimatedTransform(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return js.ValueOf("{}")
	}
	return js.ValueOf(eng.GetAnimatedTransform(args[0].String()))
}

func getDocument(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.GetDocument())
}

func getSelection(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.GetSelection())
}

func getFrame(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.GetFrame())
}

func isPlaying(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.IsPlaying())
}

func getFPS(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.GetFPS())
}

func getTotalFrames(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(eng.GetTotalFrames())
}
