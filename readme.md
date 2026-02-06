# Inamate

> The fastest way to animate expressive 2D characters and motion using a timeline + vector stage, without fighting the tool.

Inamate is an open-source, collaborative, timeline-centric 2D animation platform built for the web. Our goal is to combine the simplicity of classic animation tools with modern, powerful features, focusing on speed and an animation-first user experience.

This project is built with a Go backend, a Go-based WebAssembly (WASM) core engine, and a TypeScript/React frontend.

## Core Principles

-   **Fast:** Get from a blank canvas to a moving character in minutes, not hours.
-   **Clear:** Simple scenes feel simple. Complex scenes stay navigable and performant.
-   **Approachable Power:** Features like rigging are designed as optional tools for posing, not mandatory engineering exercises.
-   **Animation First:** The user experience prioritizes timing, posing, and iteration over complex technical setup.

---

## The Plan (High-Level Roadmap)

This project is developed in phases, with each phase building on the last to add significant capabilities.

### Phase 1: MVP (The Foundation)

*Goal: A solo animator can create and export a complete short animation.*

-   Core vector drawing engine
-   Robust timeline with layers, keyframes, and onion skinning
-   Essential animation tools: transforms, tweens, and editable easing curves
-   Basic layer types: Vector, Group, and Mask
-   Export to PNG sequence and MP4 video

### Phase 2: Character Animation

*Goal: Make Inamate a compelling choice for character animators.*

-   Approachable Rigging: Bones (FK/IK), auto-weighting, and visual controls.
-   Switch/Pose Layers: For managing mouths, hands, and expressions.
-   Graph Editor: Fine-grained control over animation curves and timing.

### Phase 3: Power & Scale

*Goal: Unlock advanced workflows without overwhelming new users.*

-   Deformation System: Envelope, curve, and mesh deformers.
-   Driver System: Allow any property to drive any other property for smart rigs.
-   Non-destructive Effects Stack: Layer-based blurs, glows, and color adjustments.

### Phase 4: The "Beautiful Final Form"

*Goal: Solidify Inamate as a professional-grade, extensible tool.*

-   Optional Node Graph: For complex rigging and compositing.
-   Asset & Library System: Reusable, versioned assets.
-   Modern Publishing: Engine-friendly exports and open interchange formats.

---

## Getting Started (Development)

Follow these steps to get a local development environment running.

### Prerequisites

-   [Go](https://go.dev/doc/install) (latest version recommended)
-   [Node.js](https://nodejs.org/en) (LTS version recommended)
-   [Docker](https://www.docker.com/get-started/)
-   [Task](https://taskfile.dev/installation/)

### 1. First-Time Setup

Clone the repository and run the setup command. This will install all dependencies, start the required services (Postgres, MinIO), and run initial database migrations.

```sh
git clone https://github.com/your-username/inamate.git
cd inamate
task setup
```

### 2. Run the Development Servers

This command starts the backend Go server and the frontend Vite dev server in parallel.

```sh
task dev
```

-   Frontend will be available at `http://localhost:5173`
-   Backend API will be running on `http://localhost:8080`

### Common Commands

Here are other useful commands defined in the `Taskfile.yml`:

-   `task test`: Run all backend and frontend tests.
-   `task build`: Build all artifacts (WASM engine, backend binary, frontend).
-   `task migrate:up`: Apply new database migrations.
-   `task infra:stop`: Stop the Docker containers for Postgres and MinIO.

## Technology Stack

-   **Backend:** Go
-   **Frontend:** TypeScript, React, Vite
-   **Core Engine:** Go compiled to WebAssembly (WASM)
-   **Database:** PostgreSQL
-   **Dev Infrastructure:** Docker, Task

## Contributing

We welcome contributions! Please check the issues tab to find areas where you can help. For new features or significant changes, please open a discussion first to outline your idea.
