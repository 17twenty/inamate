## PRD: Inamate (Open Source) — Collaborative 2D Vector Animation for the Web

Version: 0.9 (Initial)
Owner: Product / Engineering
Audience: Engineering, Design, QA, Community Contributors
Status: Ready for technical design & sprint planning

---

# 0. Executive Summary

**Inamate** is an open-source, web-based 2D vector animation authoring tool with **Figma-style collaboration**. It enables creators to design vector graphics, animate them with a timeline and keyframes, collaborate in real time with multi-cursor presence and object-level locking, and publish outputs to **HTML5 (interactive)** and **video** (rendered via export jobs).

The product’s core differentiator is **real-time collaborative animation editing** with an engine-driven, deterministic document model, designed to later support **Electron** as a native desktop app.

---

# 1. Goals, Non-Goals, and Success Metrics

## 1.1 Goals

### Product Goals

1. Provide a modern, browser-based animation editor focused on **2D vector animation**.
2. Support **real-time collaboration**: presence, multi-cursor, selection visibility, object locks, and last-write-wins conflict handling.
3. Establish a durable foundation: document model + engine evaluation + render/export pipeline.
4. Enable publishing:

   * Interactive playback in the browser (HTML5 runtime)
   * Offline render to video via background jobs (leveraging imagemagick if needed or ffmpeg)

### Engineering Goals

1. Engine-owned document/evaluation model (WASM) to ensure determinism, performance, and portability.
2. Web-first architecture compatible with Electron (no browser-only dependencies as “source of truth”).
3. Clear modular boundaries to enable open-source contributions (plugins later, but architecture now).
4. Secure scripting alternative (no arbitrary JS execution in v1).

## 1.2 Non-Goals (MVP / v1)

1. Full raster editing suite (Photoshop equivalent) — only raster placement/transform in v1.
2. 3D animation features.
3. Complex compositing/bake effects (AE-level) in v1.
4. CRDT-based deep concurrent edits for the same object — we use object locking.
5. Marketplace, plugin ecosystem, or monetization/billing enforcement (can be mocked).

## 1.3 Success Metrics

### MVP (first public beta)

* Users can create a project, draw/edit vectors, animate via keyframes, and export HTML.
* Two users can collaborate live with:

  * Presence
  * Multi-cursor
  * Object acquire/release lock
  * Stable undo/redo per user
* 95th percentile interaction latency (cursor/selection) < 150ms on typical broadband.
* Document opens and remains interactive with:

  * 1 scene
  * 200 objects
  * 2 collaborators
  * 60 seconds timeline

### v1

* Video export job success rate > 99% on reference infrastructure.
* Projects with 2,000 objects remain editable on a mid-tier laptop.

---

# 2. Target Users and Use Cases

## 2.1 Personas

1. **Indie Animator**

   * Creates short vector animations for social, YouTube, or indie series.
   * Needs timeline + symbols + export video.
2. **Motion Designer in a Team**

   * Collaborates with others: feedback loops, shared assets.
   * Needs live collaboration, commenting (later), versioning.
3. **Developer / Interactive Designer**

   * Wants interactive HTML exports for web experiences.
   * Needs deterministic runtime playback and basic scripting/expressions.

## 2.2 Primary Use Cases

1. Create a new project → draw shapes → animate position/scale/rotation → preview → export HTML.
2. Invite collaborator by link → collaborator logs in → both see cursors → lock/edit objects → save.
3. Import SVG assets → animate layers → export video.

---

# 3. Product Principles

1. **Engine-owned truth**: The engine defines behavior; UI reflects it.
2. **Determinism**: Same document + same time = same output everywhere.
3. **Collaboration by design**: Presence and locking are first-class, not bolt-on.
4. **Minimal sharp edges**: No arbitrary scripting; safe expressive power only.
5. **Performance matters**: Always target interactive editing at 60fps for typical workloads.
6. **Open-source friendly**: Modular, documented APIs, and predictable contribution areas.

---

# 4. Scope and Roadmap

## 4.1 MVP (Public Beta)

### Create/Edit

* Project creation
* Scene canvas
* Basic vector drawing:

  * Rectangle, ellipse, line, pen tool (Bezier)
  * Select/move/scale/rotate
  * Group/ungroup
* Layers panel (ordering, visibility, lock)
* Properties inspector:

  * Fill/stroke
  * Opacity
  * Transform
* Timeline:

  * Playhead
  * Keyframes for transform + opacity
  * Linear interpolation
* Preview playback

### Collaboration (MVP)

* Account login
* Invite link (mock “paid access”; enforce via simple project ACL)
* Presence:

  * User list
  * Colored cursors
  * Selection outlines
* Object locking:

  * acquire/release
  * locked object indicates editor
  * last-write-wins for unlocked conflicts
* Real-time sync via WebSockets

### Export

* Export HTML package:

  * JSON doc + runtime player
  * Canvas2D playback (or WebGL/WebGPU later)
* Basic project save/version snapshot (server)

---

## 4.2 v1 (Post Beta)

* Symbols / Components (reusable objects)
* Nested timelines (movie clips concept)
* Text tool (rich text basics)
* Import:

  * SVG (subset)
  * PNG/JPG raster placement
* Audio placement on timeline (basic)
* Video export:

  * MP4/WebM via background jobs
* Better easing:

  * ease-in/out
  * cubic-bezier editor
* Robust undo/redo across keyframe edits
* Project version history (snapshots)
* Comments (optional)

---

## 4.3 v2 (Future)

* Node/blocks scripting (Scratch-like) OR expression language
* Masks, blend modes, filters
* Plugin API
* Collaboration: shared timeline scrubbing, follow mode
* Offline-first mode (Electron focus)
* Team workspaces and billing real integration

---

# 5. User Experience Requirements

## 5.1 UI Layout (based on mock)

* Central canvas
* Left toolbar (tools)
* Bottom timeline panel
* Right inspector/properties + library
* Top bar: file/project actions, share, preview, export

## 5.2 Core Interactions

### Canvas

* Pan: space + drag
* Zoom: ctrl/cmd + scroll
* Select: click / drag marquee
* Multi-select: shift-click
* Direct manipulation handles for scale/rotate
* Snapping (v1): optional; MVP can omit

### Timeline

* Scrub playhead
* Add keyframe:

  * auto-key toggle OR “add keyframe” button
* Drag keyframes along frames
* Play/stop controls
* FPS settings (default 24)

### Collaboration indicators

* Cursor presence and names
* Locked object indicator (badge + outline)
* Tooltip: “Editing by <user>”
* Optional “request control” (v1/v2)

---

# 6. Functional Requirements (Detailed)

## 6.1 Accounts & Projects

* Users must authenticate to edit.
* Project owner creates project.
* Owner can invite users via link.
* Access model:

  * Owner + invited users can edit
  * Others read-only or no access (configurable)
* “Paid access” can be mocked:

  * Store `seat_grants` but don’t charge in MVP.

## 6.2 Document Model

The document is stored as **JSON** (authoritative persistence) plus **operation log (JSONL)** for collaboration and replay.

### Document Concepts

* Project
* Scenes
* Objects (nodes)
* Assets (SVG/raster/audio)
* Timelines
* Tracks
* Keyframes
* Components (v1)

### Object Types (MVP)

* VectorPath
* ShapeRect
* ShapeEllipse
* Group
* RasterImage (placement only)
* Text (v1)

### Properties (MVP)

* Transform: position (x,y), rotation, scale (x,y), anchor
* Style: fill, stroke, strokeWidth, opacity
* Visibility, locked flag (local edit lock vs collaboration lock)

## 6.3 Engine Evaluation

Engine runs deterministically:

* At time `t`, evaluate timeline tracks → compute property values → produce render list.
* Hit testing uses engine geometry for selection.
* Undo/redo uses engine operation history (per client) + server reconciliation rules.

## 6.4 Animation System

### Timeline model

* Timeline uses frames (integer), derived from FPS.
* Each animated property has a track.
* Track contains keyframes:

  * `{frame, value, easing}`
* Interpolation types:

  * Linear (MVP)
  * Easing curves (v1)

### Nested timelines

* Not required in MVP; v1 introduces “symbols” with internal timelines.

## 6.5 Collaboration System

### Overview

* Real-time via WebSockets.
* Server authoritative for:

  * Locks
  * Ordering
  * Persistence
  * Access control
* Clients maintain local state + apply ops.

### Presence

* Cursor position on canvas
* Current selection object IDs
* Viewport bounds (optional MVP, recommended v1)

### Locking

* Acquire lock for object IDs (or group IDs).
* Lock expires on disconnect / timeout.
* Release lock on commit or manual.
* Only lock holder may commit ops to that object’s mutable properties.
* If client submits change without lock:

  * server rejects OR accepts with last-write-wins depending on mode
  * MVP: reject edits to locked objects, accept edits to unlocked objects

### Conflict handling

* Same object unlocked edited concurrently:

  * last-write-wins by server op ordering.
* Same object locked:

  * only lock holder edits; others blocked.

### Operational protocol (JSONL ops)

Examples:

* `presence.update`
* `lock.acquire`
* `lock.release`
* `doc.patch` (RFC6902-like JSON patch)
* `doc.commit` (batched)
* `doc.snapshot` (server generated)

## 6.6 Export

### HTML export (MVP)

Outputs:

* `project.json`
* `runtime.js` (player)
* `index.html`

Runtime:

* Loads JSON
* Evaluates animation timeline
* Renders to Canvas2D (MVP)
* Plays audio (v1)

### Video export (v1)

* Background job renders frames headlessly
* Encodes to MP4/WebM via ffmpeg
* Stores artifact, downloadable link

---

# 7. Non-Functional Requirements

## 7.1 Performance

* Target 60fps interactive editing for typical projects.
* Render pipeline must avoid React rendering per frame.
* Engine evaluation + rendering must be incremental where possible.

## 7.2 Reliability

* Collaboration should tolerate transient disconnect:

  * reconnect within 30s restores presence and locks if still valid
* Server persists snapshots periodically.

## 7.3 Security

* No arbitrary JS scripting in MVP/v1.
* Strict access control on project read/write.
* WebSocket auth via session token/JWT.
* Sanitize imported SVG content.

## 7.4 Portability (Electron)

* No reliance on browser storage as source of truth.
* Abstract filesystem for export/import.
* Rendering engine and runtime should behave identically in Chromium.

---

# 8. Technical Architecture

## 8.1 High-Level

* **Frontend**: React for UI chrome + canvas surface; editor runtime in WASM.
* **Engine**: WASM module (Go or Rust) provides:

  * document parsing
  * evaluation
  * geometry ops
  * hit testing
* **Backend**: Go service:

  * Auth, projects, access
  * Collaboration gateway (WebSockets)
  * Persistence (Postgres)
  * Export jobs (River)
* **Storage**:

  * Postgres for metadata + snapshots + op logs
  * Object storage (S3-compatible) for assets + exports

## 8.2 Why remove Three.js

* We are 2D-vector-first.
* A bespoke renderer is required for selection/hit testing/path ops anyway.
* Three.js adds complexity and mismatched abstractions.

## 8.3 WASM Engine API (Proposed)

Functions exposed to JS:

* `loadDocument(json: string) -> docHandle`
* `applyOps(docHandle, opsJsonl: string) -> newDocVersion`
* `evaluate(docHandle, time: float) -> renderList`
* `hitTest(docHandle, x, y, time) -> objectId`
* `getObjectProps(docHandle, objectId) -> json`
* `setObjectProps(docHandle, objectId, patchJson) -> ops`
* `serialize(docHandle) -> json`

RenderList:

* flattened draw commands (paths, fills, strokes, images, text later)

## 8.4 Rendering Strategy

### MVP renderer: Canvas2D

* Quickest path to correctness.
* Good enough for typical vector scenes.
* Upgrade path to WebGPU later.

### Later: WebGPU

* For large scenes, complex strokes, effects.

## 8.5 Backend Components

* API server (REST/JSON)
* Collaboration server (WebSocket)
* Job worker (River) for exports
* DB migrations

---

# 9. Data Model (Backend)

## 9.1 Tables (Proposed)

* users
* projects
* project_members
* project_snapshots
* project_ops (append-only)
* assets
* exports
* locks (ephemeral; could be Redis or Postgres with TTL)

### Notes

* Locks should ideally be in Redis for TTL + speed.
* If avoiding Redis, store locks in Postgres with `expires_at` and cleanup.

---

# 10. Collaboration Protocol (Detailed)

## 10.1 WebSocket Channels

* `/ws/project/{projectId}`

Messages:

* Client → Server: ops, lock requests, presence updates
* Server → Client: broadcast ops, lock state, presence, errors

## 10.2 Message Envelope

```json
{
  "type": "doc.patch",
  "projectId": "p1",
  "clientId": "c1",
  "userId": "u1",
  "seq": 100,
  "payload": { ... }
}
```

## 10.3 Lock Messages

Acquire:

```json
{ "type": "lock.acquire", "payload": { "objectIds": ["o1"], "ttlMs": 30000 } }
```

Release:

```json
{ "type": "lock.release", "payload": { "objectIds": ["o1"] } }
```

## 10.4 Presence

```json
{
  "type": "presence.update",
  "payload": {
    "cursor": {"x": 100, "y": 200},
    "selection": ["o1", "o2"],
    "viewport": {"x": 0, "y": 0, "w": 800, "h": 600}
  }
}
```

---

# 11. Undo/Redo Requirements

## 11.1 MVP approach

* Undo/redo is **per-user local stack** of ops they generated.
* When undo occurs:

  * client emits inverse ops (generated via engine)
  * server applies like normal ops
* If object was modified by others since:

  * inverse may be rejected or become last-write-wins depending on lock state
* Rule: undo requires lock on impacted objects.

## 11.2 v1 improvement

* Operation transforms or snapshot-based undo segments.
* “Revert to snapshot” option.

---

# 12. Import Requirements

## 12.1 SVG import (v1 recommended, optional MVP)

* Supported subset:

  * paths, rect, circle/ellipse, groups
  * fills/strokes
  * transforms
* Unsupported:

  * filters, masks, complex text shaping (initially)
* Import should sanitize:

  * scripts removed
  * external refs blocked

## 12.2 Raster import (v1)

* PNG/JPG placement, transform only.
* No pixel editing.

---

# 13. Export Requirements (Detailed)

## 13.1 HTML Export

Must include:

* Deterministic player
* Frame stepping or requestAnimationFrame loop
* Basic playback controls (optional)

## 13.2 Video Export (v1)

Pipeline:

1. Job enqueued with project snapshot ID.
2. Worker loads snapshot.
3. Renders frames at FPS to images.
4. ffmpeg encodes to MP4/WebM.
5. Store output, update exports table.

---

# 14. QA and Testing Strategy

## 14.1 Unit Tests

* Engine:

  * keyframe interpolation correctness
  * hit testing geometry
  * serialization round-trip
* Backend:

  * ACL enforcement
  * lock rules
  * op ordering

## 14.2 Integration Tests

* Two clients editing same project:

  * cursor presence sync
  * lock acquire/release
  * rejection of edits when locked
  * last-write-wins on unlocked conflict

## 14.3 Performance Tests

* Synthetic documents:

  * 200 objects, 2 users
  * 2000 objects, 1 user
* Measure:

  * frame render time
  * input-to-render latency

---

# 15. Open Source and Governance

* License: (recommend) Apache-2.0 or MIT (choose explicitly)
* Core repo contains:

  * /engine (WASM)
  * /frontend
  * /backend
  * /runtime (export player)
* Contribution guidelines:

  * coding standards
  * PR template
  * issue labels (“good first issue”)
* Security policy: reporting process

---

# 16. Risks and Mitigations

## 16.1 Biggest risks

1. Engine complexity underestimated (vector ops, text).
2. Collaboration edge cases (locks and undo/redo).
3. Performance degradation with large scenes.
4. Export determinism mismatch (editor vs runtime).

## 16.2 Mitigations

* Start with minimal vector model (paths + transforms).
* Lock-first collab model (avoid CRDT).
* Canvas2D first (correctness), WebGPU later (perf).
* Shared engine/runtime evaluation model.

---

# 17. Implementation Plan (Suggested Milestones)

## Milestone 1: Foundations (2–4 weeks)

* Repo layout
* Basic backend auth + projects
* WebSocket connection + presence
* Document JSON schema defined
* WASM engine loads doc and returns render list
* Canvas draws static scene

## Milestone 2: Editing (4–8 weeks)

* Selection + hit testing
* Transform handles
* Pen tool basics
* Save/load snapshots

## Milestone 3: Timeline + Animation (4–8 weeks)

* Keyframes for transform
* Playback
* Basic easing (linear)

## Milestone 4: Collaboration v1 (4–6 weeks)

* Lock acquire/release
* Multi-cursor + selection display
* Conflict handling

## Milestone 5: Export HTML (2–4 weeks)

* Runtime player
* Export package

## Milestone 6: v1 upgrades

* Symbols
We should refer to https://openlab.bmcc.cuny.edu/mmp260-1301-f2019/adobe-animate-symbols/ and https://helpx.adobe.com/animate/using/symbols.html to understand how symbols should work in Inamate.

* Text tool
* Video export jobs
* SVG import

---

# 18. Appendix: Reference JSON Schema (Initial Draft)

### Project

```json
{
  "id": "p1",
  "name": "Demo",
  "fps": 24,
  "scenes": ["s1"],
  "assets": [],
  "rootTimeline": "t1"
}
```

### Scene

```json
{
  "id": "s1",
  "name": "Scene 1",
  "root": "o_root",
  "width": 1280,
  "height": 720,
  "background": "#202020"
}
```

### Object Node

```json
{
  "id": "o1",
  "type": "ShapeRect",
  "parent": "o_root",
  "children": [],
  "transform": { "x": 0, "y": 0, "sx": 1, "sy": 1, "r": 0, "ax": 0, "ay": 0 },
  "style": { "fill": "#ff0000", "stroke": "#000000", "strokeWidth": 2, "opacity": 1 },
  "visible": true
}
```

### Timeline Track

```json
{
  "id": "track_o1_x",
  "objectId": "o1",
  "property": "transform.x",
  "keys": [
    { "frame": 0, "value": 0, "easing": "linear" },
    { "frame": 24, "value": 300, "easing": "linear" }
  ]
}
```

---

# 19. Formal JSON Schema (Document Model)

This schema defines the **authoritative persisted format** of Inamate projects. All clients and exports must be able to round-trip this format.

This is conceptual JSON Schema (not strict draft-07 syntax, but implementable).

---

## 19.1 Root Document

```json
{
  "project": {
    "id": "string",
    "name": "string",
    "version": "int",
    "fps": "int",
    "createdAt": "timestamp",
    "updatedAt": "timestamp",
    "scenes": ["scene_id"],
    "assets": ["asset_id"],
    "rootTimeline": "timeline_id"
  }
}
```

---

## 19.2 Scene

```json
{
  "id": "scene_id",
  "name": "string",
  "width": "int",
  "height": "int",
  "background": "color",
  "root": "object_id"
}
```

---

## 19.3 Object Node

All drawable or structural entities are nodes in a tree.

```json
{
  "id": "object_id",
  "type": "enum",
  "parent": "object_id | null",
  "children": ["object_id"],
  "transform": {
    "x": "float",
    "y": "float",
    "sx": "float",
    "sy": "float",
    "r": "float",
    "ax": "float",
    "ay": "float"
  },
  "style": {
    "fill": "color",
    "stroke": "color",
    "strokeWidth": "float",
    "opacity": "float"
  },
  "visible": "bool",
  "locked": "bool",
  "data": {}
}
```

### type enum

* `Group`
* `ShapeRect`
* `ShapeEllipse`
* `VectorPath`
* `RasterImage`
* `Text` (v1)

### data field examples

VectorPath:

```json
{
  "commands": [
    ["M", 0, 0],
    ["L", 100, 0],
    ["L", 100, 100],
    ["Z"]
  ]
}
```

RasterImage:

```json
{
  "assetId": "asset_id",
  "width": 512,
  "height": 512
}
```

---

## 19.4 Timeline

```json
{
  "id": "timeline_id",
  "length": "int_frames",
  "tracks": ["track_id"]
}
```

---

## 19.5 Track

```json
{
  "id": "track_id",
  "objectId": "object_id",
  "property": "string",
  "keys": ["keyframe_id"]
}
```

---

## 19.6 Keyframe

```json
{
  "id": "keyframe_id",
  "frame": "int",
  "value": "any",
  "easing": "enum"
}
```

### easing enum

* `linear`
* `easeIn`
* `easeOut`
* `easeInOut`
* `cubicBezier` (v1)

---

## 19.7 Asset

```json
{
  "id": "asset_id",
  "type": "enum",
  "name": "string",
  "url": "string",
  "meta": {}
}
```

Asset types:

* `svg`
* `png`
* `jpg`
* `audio`
* `video`

---

# 20. Collaboration Operational Log (JSONL)

All collaborative state is replicated using append-only operation logs.

Each op is atomic and replayable.

```json
{
  "opId": "uuid",
  "projectId": "p1",
  "userId": "u1",
  "timestamp": 1700000000,
  "type": "doc.patch",
  "payload": {}
}
```

---

## 20.1 Operation Types

### doc.patch

RFC6902-like patch.

```json
{
  "type": "doc.patch",
  "payload": {
    "patch": [
      { "op": "replace", "path": "/objects/o1/transform/x", "value": 200 }
    ]
  }
}
```

### doc.add

```json
{
  "type": "doc.add",
  "payload": {
    "parent": "o_root",
    "object": { ...full node... }
  }
}
```

### doc.delete

```json
{
  "type": "doc.delete",
  "payload": { "objectId": "o1" }
}
```

### lock.acquire

```json
{
  "type": "lock.acquire",
  "payload": {
    "objectIds": ["o1"],
    "ttl": 30000
  }
}
```

### lock.release

```json
{
  "type": "lock.release",
  "payload": {
    "objectIds": ["o1"]
  }
}
```

### presence.update

As previously defined.

---

# 21. REST API (Backend)

## 21.1 Auth

POST /auth/login
POST /auth/logout
POST /auth/register

JWT/session based.

---

## 21.2 Projects

GET /projects
POST /projects
GET /projects/{id}
DELETE /projects/{id}

---

## 21.3 Project Members

POST /projects/{id}/invite
GET /projects/{id}/members
DELETE /projects/{id}/members/{userId}

---

## 21.4 Snapshots

GET /projects/{id}/snapshots
POST /projects/{id}/snapshots
GET /projects/{id}/snapshots/{snapshotId}

---

## 21.5 Assets

POST /projects/{id}/assets
GET /projects/{id}/assets/{assetId}

---

## 21.6 Exports

POST /projects/{id}/exports
GET /projects/{id}/exports
GET /exports/{exportId}/download

---

# 22. Engine Render Command Spec

The WASM engine produces a flattened render list.

This is **the only interface between engine and renderer**.

---

## 22.1 Render Command Format

```json
{
  "frame": 120,
  "commands": [
    {
      "type": "path",
      "transform": [1,0,0,1,100,200],
      "path": [
        ["M",0,0],
        ["L",100,0],
        ["L",100,100],
        ["Z"]
      ],
      "fill": "#ff0000",
      "stroke": "#000000",
      "strokeWidth": 2,
      "opacity": 1
    },
    {
      "type": "image",
      "assetId": "img1",
      "transform": [1,0,0,1,300,200],
      "opacity": 0.8
    }
  ]
}
```

---

## 22.2 Renderer Rules

Renderer must:

* Apply transforms in order.
* Respect global alpha.
* Draw in list order (painter’s algorithm).
* Never mutate document state.

---

# 23. Electron Packaging Requirements

## 23.1 Desktop Mode

* Same frontend bundle.
* Backend embedded or remote.
* Local filesystem access:

  * Open/save JSON project files.
  * Export directly to disk.

## 23.2 Required Abstractions

* File API wrapper:

  * `openProject()`
  * `saveProject()`
  * `exportToDisk()`
* Asset loading must work from:

  * HTTP URLs
  * local file paths.

---

# 24. Deployment & Infrastructure (Reference)

## 24.1 MVP Infra

* Single Go API server
* Postgres
* Redis (optional for locks)
* Object storage (S3 compatible)
* Nginx reverse proxy

## 24.2 Production

* Horizontal scaling of API
* Sticky sessions for WebSockets or shared Redis pub/sub
* Background workers for export
* CDN for asset/export delivery

---

# 25. Security Model

## 25.1 Access Control

* Project-level ACL
* Roles:

  * Owner
  * Editor
  * Viewer

## 25.2 Scripting Security

* No user JS execution.
* Future DSL runs in WASM sandbox.
* All expressions pure, side-effect free.

## 25.3 Data Validation

* All incoming ops validated:

  * schema
  * lock ownership
  * permission

---

# 26. Determinism Guarantees

The following must be deterministic:

1. Timeline evaluation
2. Keyframe interpolation
3. Expression evaluation (future)
4. Export render results

Guarantees:

* No random without seeded RNG.
* No time-based effects other than timeline time.
* No floating-point nondeterminism across platforms:

  * prefer f32 or f64 consistently.
  * avoid browser-specific math.

---

# 27. Observability

## Metrics

* Active collaborators per project
* Ops per second
* Render frame time
* Export job duration

## Logging

* WebSocket connect/disconnect
* Lock conflicts
* Export failures

---

# 28. Community & Contribution Model

## Repos (suggested)

/engine
/frontend
/backend-go
/runtime

---

# 29. Final Strategic Summary (for the Team)

Inamate is not “just an animation tool”.

It is:

> A **real-time collaborative creative engine** for vector animation.

The success of this project depends on:

1. Getting the **engine and document model right**.
2. Enforcing **deterministic behavior everywhere**.
3. Treating **collaboration as a core primitive**, not an add-on.
4. Keeping scripting **safe, constrained, and expressive**.
5. Shipping **small, correct, extensible systems** over large brittle ones.

If these principles are followed, Inamate becomes:

* Web-first
* Desktop-capable
* Extensible
* And uniquely positioned in the creative tooling ecosystem.

---

This completes the full PRD.
