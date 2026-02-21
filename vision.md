# Endless Pipe Connect (Prototype v0) – Vision

## Vision
Endless, solvable pipe-connection puzzle. Player places one pipe at a time from a bottom slot to connect two border endpoints. When connected, a color-flow animation plays through the connected path, then the used pipes burst and clear, and two new border endpoints spawn. The game continuously computes three solution routes (easy, medium, hard) and generates upcoming pipes that always allow completion.

---

## Core Gameplay Loop
1. **Initialize**
   - Grid size is adjustable (developer setting in prototype).
   - Spawn **2 endpoints** on **border cells**.
   - Set **Hardness** parameter (1–100).

2. **Solve and Preview**
   - Compute **3 valid routes** between endpoints (easy, medium, hard), refreshed:
     - On new endpoints spawn
     - After every pipe placement
   - Display each route as a **dotted line** overlay.

3. **Piece Offer**
   - Show **3 upcoming pipes** in bottom UI.
   - Each pipe corresponds to the next-needed piece from one of the 3 routes (one per route).
   - Player interacts with one pipe at a time (drag from bottom onto grid).

4. **Place or Discard**
   - Place anywhere on grid, snap to cell.
   - Cannot overwrite existing tile.
   - Costs **1 energy** to place.
   - Discard costs **1 energy**.
   - Rotation is restricted: only possible using a **Rotation Booster**.
     - Booster is consumed only if the placed rotation differs from the pipe’s original orientation.
     - If no booster, pipe must be placed as-is.

5. **Validate and Continue**
   - After placement: recompute 3 routes ensuring at least one solvable route exists.
   - If endpoints are connected by a valid continuous pipe network:
     - Play color flow animation (white to color).
     - Burst and clear the connected path tiles.
     - Spawn 2 new border endpoints and repeat.

---

## Fail Conditions (Prototype Logic Included)
- Energy hits **0** (prototype can set energy to unlimited or high value, e.g. 999).
- **No legal placements** (no empty cells remaining where a pipe could be placed).
- **Board full** (no empty tiles).

Future recovery systems (not implemented now): boosters, rewarded video to clear board or restore energy.

---

## Grid and Endpoints
- Adjustable grid size (e.g., 6x6 to 12x12; prototype should support quick change).
- Endpoints spawn randomly on border cells.
- Endpoints and pipes are **white by default**, filled with color only after a valid connection is formed.

---

## Pipe Set (Prototype v0)
Each pipe is a single tile with orientation (0/90/180/270) and a connection mask (N/E/S/W).

- Straight
- Elbow
- T-junction
- Cross
- Double elbow (special)
  - Base topology allows flow:
    - Top → Left
    - Left → Bottom
  - Rotations apply to this topology.

---

## Hardness System (1–100)
Hardness steers:
- Endpoint distance and relative placement on borders.
- Route length (detours).
- Turn count.
- Frequency of complex tiles (T, Cross, Double Elbow).

Routes generated each refresh:
- **Easy**: most direct/shortest, fewer turns.
- **Medium**: moderate detour, more turns.
- **Hard**: longer, more turns, more complex pieces.

---

## Route Preview and Solvability Guarantee
- Always maintain **3 computed routes** from start to end.
- Recompute after every placement using current board occupancy.
- If fewer than 1 route exists, handle by regenerating endpoints (prototype-safe behavior).
- UI shows dotted route overlays to tune difficulty.

---

## Visuals and Input (Prototype)
- Touch-first input:
  - Drag pipe from bottom slot to grid cell.
  - Snap to tile on release.
- Rendering:
  - Grid lines subtle.
  - Pipes and endpoints white.
  - Dotted route overlays white dashed.
- Animation:
  - When connected: color flows cell-by-cell along the valid path, then pipes burst and clear.

---

# Prompting Guide for Codex (3 Parts)

## Prompt 1: Wireframe and Architecture (Local Web Preview Only)
Goal: playable scaffolding with rendering + drag placement.

Include:
- Vite + React + TypeScript local app.
- Single canvas-based renderer (grid + tiles + endpoints).
- Adjustable grid size constant and re-render on change.
- 3 bottom pipe cards (placeholders).
- Drag from bottom to grid with snap and placement.
- No route solver yet (stub only), no energy logic yet.
- Clean modular files:
  - `GameState.ts` (pure state)
  - `Pipe.ts` (types, masks, rotations)
  - `Renderer.ts` (draw grid/pipes/endpoints)
  - `Input.ts` (touch drag logic)
  - `RouteSolver.ts` (stub)
  - `App.tsx` (wires everything)
- Must run with `npm install` and `npm run dev`.

## Prompt 2: Mechanics (Solvability, Routes, Pipe Offers, Energy)
Goal: the puzzle rules become real.

Include:
- Pipe connectivity using bitmasks N/E/S/W.
- Placement rules: anywhere, no overwrite.
- Energy system: start high/unlimited, place costs 1, discard costs 1.
- Rotation booster logic:
  - Pipes have an “original orientation.”
  - Allow rotate only if boosters > 0.
  - Consume booster only if placed orientation != original.
- Connection detection:
  - BFS/flood fill from start endpoint through connected edges.
- Route solver:
  - Compute 3 routes (easy/medium/hard) on the current grid.
  - Each route is an ordered list of cells and required pipe orientations.
  - Hardness (1–100) biases route selection (length, turns, complexity).
  - Refresh routes after every placement.
  - Guarantee at least 1 route; if 0, regenerate endpoints.
- Pipe generation:
  - Show 3 offered pipes derived from the next required pieces of the 3 routes.
  - Ensure offered pipes always enable at least one completion path.

## Prompt 3: UI and Animation (Dotted Routes, Color Flow, Burst)
Goal: tune difficulty visually and feel the reward.

Include:
- Dotted route overlays for 3 routes (distinct dash patterns or opacity).
- Connected path animation:
  - Start/end points trigger color flow along actual connected path.
  - Pipes fill from white to color progressively.
- Burst animation:
  - After flow completes, connected path tiles fade/scale out and are removed.
  - Spawn new endpoints and recompute routes.
- Keep animation state separate from game state and driven by `requestAnimationFrame`.
- Touch polish: responsive drag, highlight hovered cell, invalid placement feedback.

---

## Early Constraint (Affects Solver)
Codex should assume one of these; default recommendation for prototype is #1.

1) Routes may use **only empty cells**; placed pipes are treated as obstacles.  
2) Routes may also incorporate already placed pipes if compatible.

