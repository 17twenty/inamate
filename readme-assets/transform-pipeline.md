# Transform & Coordinate Space Pipeline

Inamate's rendering pipeline means the WASM engine composes all transforms (parent hierarchy, rotation, scale, skew, anchor offsets) into a single world-space affine matrix per object. The frontend receives these as `DrawCommand.transform` — a 6-element array `[a, b, c, d, e, f]` representing:

```
| a  c  e |
| b  d  f |
| 0  0  1 |
```

This creates two distinct coordinate spaces that the frontend must navigate:

| Space | Description | Source |
|-------|-------------|--------|
| **World (canvas)** | Post-transform, what appears on screen. Bounds, hit testing, and alignment references live here. | `DrawCommand.transform`, `getObjectWorldBounds()`, `getObjectWorldMatrix()` |
| **Parent-local** | The object's own position/scale/rotation relative to its parent. Document mutations happen here. | `getAnimatedTransform()`, `object.transform`, `updateTransformWithKeyframes()` |

## The Conversion Pipeline

To convert spatial operations (alignment, snapping, distribution) between spaces, the frontend uses a set of affine matrix utilities in `frontend/src/engine/commands.ts`:

```
World Space                              Parent-Local Space
     │                                        ▲
     │  invertMatrix(parentWorldMatrix)        │
     │  transformVector(dx, dy, parentInv)     │  updateTransformWithKeyframes()
     │                                         │
     ▼                                         │
  World delta  ──────────────────────►  Local delta
```

### Functions

| Function | Purpose |
|----------|---------|
| `transformPoint(x, y, matrix)` | Transform a point through an affine matrix (local to world, or world to local) |
| `transformVector(dx, dy, matrix)` | Transform a direction/delta vector (no translation). Used for converting movement deltas between spaces |
| `invertMatrix(matrix)` | Invert a 2D affine matrix. Converts a local-to-world matrix into a world-to-local matrix |
| `multiplyMatrices(a, b)` | Compose two affine matrices (a x b) |

### Example: Aligning Objects

When aligning the left edges of multiple objects:

1. Get world bounds for each object (`getObjectWorldBounds`) — these are axis-aligned bounding boxes in canvas space
2. Find the reference edge: `ref = min(bounds.minX)` across all objects
3. For each object, compute the world-space delta: `dxWorld = ref - bounds.minX`
4. Get the parent's world matrix and invert it: `parentInv = invertMatrix(parentWorldMatrix)`
5. Convert to parent-local delta: `localDelta = transformVector(dxWorld, 0, parentInv)`
6. Apply: `newLocalX = currentLocalX + localDelta.x`

This correctly handles objects with rotation, non-uniform scale, skew, and arbitrary group nesting.

## Renderer Swapability

The matrix utilities (`invertMatrix`, `multiplyMatrices`, `transformVector`, `transformPoint`) are pure math with no dependency on the rendering backend. They operate on the standard `[a, b, c, d, e, f]` affine matrix format used by Canvas2D, SVG, WebGL, and virtually every 2D graphics system.

If the renderer changes (e.g., Canvas2D to WebGL, or to a custom WASM rasterizer), the coordinate space pipeline remains identical — only the source of the world matrices changes. The `DrawCommand.transform` is already renderer-agnostic; it's the engine's output, not the renderer's input format.

The key access points that would need updating for a new renderer:

| Access Point | Current Implementation | What Changes |
|-------------|----------------------|--------------|
| `Stage.getObjectWorldMatrix(id)` | Reads from `DrawCommand.transform` | Would read from new renderer's transform cache |
| `Stage.getObjectWorldBounds(id)` | Transforms local bounds through world matrix | Same math, different bounds source |
| `commands.ts` matrix utilities | Pure affine math | Nothing — these are renderer-independent |
