
# Goal Project PRD

**Project Name:** Inamate
**Product goals:** Timeline-centric, vector-first 2D animation platform
**Core Thesis:**

> *The fastest way to animate expressive 2D characters and motion using a timeline + vector stage — without fighting the tool.*

---

## 1. Product Goals (Why this exists)

### Primary goals

1. **Speed to first animation** (minutes, not hours)
2. **Clarity at scale** (small scenes feel simple, large scenes stay navigable)
3. **Rigging without fear** (powerful, but never mandatory)
4. **Animation-first UX** (timing, posing, iteration > technical setup)

### Non-goals (early)

* Full studio pipeline replacement (no shot management in MVP)
* Node-graph compositing in MVP
* Physics-heavy simulation systems

---

## 2. Core Mental Model

Before features, the *model* matters:

* **Timeline = time & intent**
* **Stage = space & drawing**
* **Layers = ownership**
* **Controls = animation handles, not math**
* **Everything animatable is keyframeable**

This should feel closer to **“Animate + Moho simplicity”** early, with **Harmony-grade depth** emerging later — *without exposing users to that depth until they need it.*

---

## 3. Feature Roadmap by Phase

---

# PHASE 0 — Foundations (Pre-MVP)

> *Nothing ships without this. Ever.*

### 0.1 Vector Drawing Engine (Foundational Dependency)

**Why first:** Everything else sits on this.

**Must-haves**

* Bezier curves optimized for animation (low point counts, stable tangents)
* Variable stroke width (pressure-aware)
* Fill + stroke separation
* Shape editing that does not explode topology over time

**Nice later**

* Textured brushes
* Stroke profiles library

**Dependencies**

* None (root system)

---

### 0.2 Timeline Core

**Why:** The product *is* the timeline.

**Must-haves**

* Layers (visibility, lock, reorder)
* Keyframes + holds
* Frame scrubbing at 60fps
* Onion skin
* Layer folders/groups

**Design constraints**

* Timeline must stay fast at 1,000+ layers
* No “magic” behavior — timing must always be visible

**Dependencies**

* Vector engine
* Scene graph

---

# PHASE 1 — MVP (User can finish a real animation)

> *Goal: A solo animator can complete and export a short animation.*

---

## 1.1 Core Animation Tools

**Importance:** 🔥🔥🔥

* Transform tools (move/scale/rotate/pivot)
* Motion tweens (position, rotation, scale, opacity)
* Editable easing curves
* Copy/paste keyframes
* Multi-select + batch edits

**Dependencies**

* Timeline core
* Transform system

---

## 1.2 Layer Types (Minimal Set)

**Importance:** 🔥🔥🔥

* Vector layer (drawn content)
* Group layer (hierarchy & organization)
* Mask layer (simple matte workflow)

**Explicitly NOT in MVP**

* Deformers
* Switch layers
* Effects stacks

---

## 1.3 Export & Playback

**Importance:** 🔥🔥🔥

* Real-time preview (cached if needed)
* Export to:

  * PNG sequence
  * MP4 (H.264)
* Alpha channel support

**Dependencies**

* Stable render graph
* Deterministic playback

---

# PHASE 2 — v1 (Character Animation Becomes a Strength)

> *This is where you start stealing users from Moho and Animate.*

---

## 2.1 Rigging v1 (Approachable, Optional)

**Importance:** 🔥🔥🔥🔥

**Key principle:**

> Rigging should feel like *posing*, not *engineering.*

**Features**

* Bones (FK + basic IK)
* Auto-weighting for vector shapes
* Pin constraints
* Parent/child constraints
* Visual controls on stage (no numeric UI required)

**Dependencies**

* Stable transform hierarchy
* Timeline channels per property

---

## 2.2 Switch / Pose Layers

**Importance:** 🔥🔥🔥🔥

* Pose switching per frame
* Ideal for:

  * Mouths
  * Hands
  * Eyes
* Timeline exposure control per switch

**Dependencies**

* Layer system
* Timeline keyframes

---

## 2.3 Graph Editor & Advanced Timing

**Importance:** 🔥🔥🔥

* Per-channel curves
* Ease presets
* Motion smoothing
* Overshoot / anticipation helpers

**This is where pros start trusting the tool.**

---

# PHASE 3 — Power & Scale (Harmony territory, but friendlier)

> *Advanced users unlock power without beginners drowning.*

---

## 3.1 Deformation System

**Importance:** 🔥🔥🔥🔥🔥

* Envelope deformers
* Curve deformers
* Mesh deform (vector + bitmap)
* Deformers animate on the timeline like any other property

**Critical rule**

* Deformers are **opt-in** and visually scoped
  (no global “why is my arm broken?” moments)

**Dependencies**

* Rigging v1
* Stable geometry evaluation

---

## 3.2 Driver System (Smart-Bone-Like)

**Importance:** 🔥🔥🔥🔥🔥

This is a **huge differentiator**.

* Any property can drive any other property
* Visual “driver editor” (no scripting required)
* Use cases:

  * Head turn → face shape change
  * Arm rotation → muscle bulge
  * Slider → pose blend

**Dependencies**

* Rigging
* Deformation
* Graph editor

---

## 3.3 Non-Destructive Effects Stack

**Importance:** 🔥🔥🔥

* Layer-based effects (blur, glow, color, shadow)
* Maskable and animatable
* GPU accelerated

**Still no node graph yet — keep it readable.**

---

# PHASE 4 — “Beautiful Final Form”

> *This is where it becomes a classic.*

---

## 4.1 Node Graph (Advanced Mode)

**Importance:** 🔥🔥🔥🔥

* Optional view
* Auto-generated from timeline structure
* Editable only when user opts in

**Why**

* Complex rigs
* Advanced compositing
* Studio pipelines

---

## 4.2 Asset & Library System

**Importance:** 🔥🔥🔥

* Reusable rigs
* Versioned assets
* Linked updates across scenes
* Tagging & search

---

## 4.3 Modern Publishing & Interchange

**Importance:** 🔥🔥🔥

* Engine-friendly export (constraints + animation data)
* Layered exports
* Open interchange format (long-term trust play)

---

## 5. MVP → Final Dependency Map (High-Level)

```
Vector Engine
   ↓
Timeline Core
   ↓
Transforms & Tweens
   ↓
Export / Playback
   ↓
Rigging v1
   ↓
Switch Layers
   ↓
Deformers
   ↓
Driver System
   ↓
Node Graph (Optional)
```

---

## 6. What This PRD Does Well

* **Delays complexity until it’s earned**
* Keeps the **timeline sacred**
* Treats rigging as *animation enhancement*, not a gate
* Leaves room to outgrow Animate *and* challenge Harmony
