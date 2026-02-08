# Inamate - Animation Editor

## Project Structure

- `frontend/` — React + TypeScript + Vite (Canvas2D rendering)
- `backend-go/` — Go server + WASM engine
- `backend-go/cmd/wasm/` — WASM entry point (compiles to `frontend/public/engine.wasm`)
- `backend-go/cmd/server/` — HTTP/WebSocket server

## Critical Build Commands

### WASM Engine (MUST use correct output path)

```bash
cd backend-go && GOOS=js GOARCH=wasm go build -o ../frontend/public/engine.wasm ./cmd/wasm/
```

The frontend loads `/engine.wasm` (NOT `main.wasm`). Always build to `engine.wasm`.

Or use: `task wasm:build`

### Frontend

```bash
cd frontend && npm run dev      # dev server
cd frontend && npm run build    # production build
npx tsc --noEmit                # type check only
```

### Backend

```bash
cd backend-go && go run ./cmd/server
cd backend-go && go build ./...  # verify compilation
```

### Full build

```bash
task build   # wasm + backend + frontend
```

## Architecture

- **Document model**: `frontend/src/types/document.ts` (TS) + `backend-go/internal/document/model.go` (Go)
- **WASM bridge**: `frontend/src/engine/wasmBridge.ts` — JS/Go interop, passes JSON
- **Engine pipeline**: Document JSON → Go WASM → scene graph → draw commands JSON → Canvas2D
- **Command dispatcher**: `frontend/src/engine/commandDispatcher.ts` — undo/redo, local-first ops
- **Collab operations**: `backend-go/internal/collab/operations.go` — server-side op application
- **Stage**: `frontend/src/engine/Stage.ts` — render loop, hit testing, WASM wrapper
- **Canvas interaction**: `frontend/src/components/canvas/CanvasViewport.tsx` — mouse/keyboard
- **Editor state**: `frontend/src/pages/EditorPage.tsx` — central editor logic, all callbacks

## Key Conventions

- Transform `r` (rotation) is stored in **degrees** in the document
- Transform `skewX`/`skewY` are stored in **degrees**
- Properties panel displays rotation in degrees (converts from doc value)
- Drag overlay system: per-object transform overlay in WASM, no document mutation during drag
- `updateWithKeyframes` / `updateTransformWithKeyframes`: check for keyframe tracks at current frame, update keyframes if tracks exist
- Tool type union: `frontend/src/components/editor/Toolbar.tsx`
- Operation types: `frontend/src/types/operations.ts`

## Testing

```bash
cd backend-go && go test ./...
cd frontend && npx tsc --noEmit
cd frontend && npx vite build
```

## Task Runner

This project uses [Task](https://taskfile.dev/). See `Taskfile.yml` for all commands.
