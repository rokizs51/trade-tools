# Load Calculator MVP Milestones

This file tracks the iterative plan for building the Export Container Load Calculator from `docs/PRD_LOAD.md`.

Product principle:

> Complex engine, simple interface.

Core engineering principle:

> The packing engine is the source of truth.

The current app is a small TypeScript web tool with separated costing domain logic under `src/domain/costing`. The load calculator should follow the same shape first: domain engine, focused tests, then browser UI. A future Next.js/package split can happen later if the product outgrows the current app structure.

## MVP Definition

The MVP is complete when an exporter can:

- Enter carton dimensions.
- Enter carton gross weight.
- Enter units per carton.
- Select a built-in container.
- Calculate maximum load capacity.
- See cartons loaded, total units, total cargo weight, cargo CBM, volume utilization, payload utilization, limiting factor, best orientation, and loading grid.
- Inspect the calculated arrangement in interactive 3D.

The same input must produce the same calculation result whether the 3D viewer is enabled or disabled.

## Milestone 0: Product Shape And Navigation

Status:

Completed.

Goal:

Introduce the load calculator as a sibling tool to the existing costing calculator without changing costing behavior.

Tasks:

- Add a top-level tool switch between:
  - Costing calculator.
  - Load calculator.
- Keep the load calculator screen separate from saved costing history.
- Decide route/view naming in the current single-page app structure.
- Add empty-state copy that explains only the user workflow, not technical packing details.

Definition of Done:

- Users can open the load calculator screen.
- Existing costing calculator behavior is unchanged.
- Build and existing tests pass.

Implementation note:

- Added a top-level tool switch for Costing calculator and Load calculator.
- Added a separate placeholder load calculator screen.
- Costing history, archived costings, editor, and result panel remain scoped to the costing tool.

## Milestone 1: Load Domain Types And Presets

Status:

Completed.

Goal:

Create the calculation foundation without UI.

Tasks:

- Create `src/domain/load` module.
- Add cargo input types:
  - Product name.
  - Carton length, width, height.
  - Dimension unit: `MM`, `CM`, `IN`.
  - Gross weight per carton.
  - Weight unit: `KG`, `LB`.
  - Units per carton.
- Add container specification types.
- Add built-in container presets:
  - 20FT General Purpose.
  - 40FT General Purpose.
  - 40FT High Cube.
- Add unit conversion utilities:
  - Dimensions normalized to millimeters.
  - Weights normalized to kilograms.
- Add validation errors for invalid dimensions, weight, units per carton, and missing container.

Definition of Done:

- Load types and presets are independent from UI.
- Unit conversion is deterministic and unit tested.
- No load code depends on DOM, browser APIs, rendering, or costing UI.

Implementation note:

- Added pure load-domain types under `src/domain/load`.
- Added built-in presets for 20FT GP, 40FT GP, and 40FT High Cube containers.
- Added dimension conversion to millimeters for `MM`, `CM`, and `IN`.
- Added weight conversion to kilograms for `KG` and `LB`.
- Added cargo normalization and container validation helpers.
- Added unit tests for presets, conversions, cargo normalization, and validation failures.

## Milestone 2: Packing Engine V1

Status:

Completed.

Goal:

Answer the core product question: "How many units fit in this container?"

Tasks:

- Generate all unique carton orientations.
- Calculate spatial capacity for each orientation.
- Calculate weight capacity from container payload.
- Select the best usable orientation.
- Calculate:
  - Cartons loaded.
  - Total units.
  - Total cargo weight.
  - Cargo CBM.
  - Container CBM.
  - Volume utilization.
  - Payload utilization.
  - Limiting factor: `SPACE`, `WEIGHT`, or `EQUAL`.
  - Grid counts: lengthwise, across, layers.
  - Unused internal space.
- Return structured zero-capacity results for cargo that cannot fit.
- Never return `NaN`, `Infinity`, or `undefined`.

Definition of Done:

- Engine is pure TypeScript.
- Engine result is deterministic.
- Tests cover:
  - Perfect fit.
  - Best orientation selection.
  - Duplicate orientation removal.
  - Space-limited load.
  - Weight-limited load.
  - Cargo too large.
  - Invalid inputs.
- Build and all tests pass.

Implementation note:

- Added unique carton orientation generation.
- Added spatial grid and capacity calculation for each orientation.
- Added payload-based weight capacity calculation.
- Added final packing result selection using highest usable capacity, then highest spatial capacity as a deterministic tie-breaker.
- Added total units, cargo weight, cargo CBM, container CBM, volume utilization, payload utilization, limiting factor, best orientation, grid, unused space, and alternative orientation results.
- Added structured zero-capacity reasons for cargo dimensions exceeding the container and carton weight exceeding payload.
- Added packing-engine unit tests for orientation generation, duplicate removal, spatial grid, weight capacity, perfect fit, best orientation, space-limited, weight-limited, cargo too large, cargo too heavy, invalid inputs, and broken numeric output.

## Milestone 3: Calculator UI Without 3D

Status:

Completed.

Goal:

Let users complete a useful load calculation before building visualization.

Tasks:

- Add load form:
  - Product name.
  - Carton dimensions.
  - Dimension unit selector.
  - Gross weight.
  - Weight unit selector.
  - Units per carton.
  - Container selector.
  - Floor loading mode shown as the only enabled option.
- Add result summary:
  - Selected container.
  - Cartons loaded.
  - Total units.
  - Cargo weight.
  - Cargo CBM.
  - Volume utilization.
  - Payload utilization.
  - Limiting factor.
  - Best carton orientation.
  - Loading grid.
- Show validation messages near the fields.
- Show a clear cargo-too-large result.
- Keep future modes visible only as disabled "Coming later" options if useful.

Definition of Done:

- User can complete the core workflow in the browser.
- UI does not expose internal engine fields.
- Existing costing workflow still works.
- Build and tests pass.

Implementation note:

- Replaced the load placeholder with a working cargo and container form.
- Added product, carton dimensions, dimension unit, gross weight, weight unit, units per carton, container selector, and floor-loaded mode.
- Populated container options from `src/domain/load` presets.
- Wired the form to the pure packing engine.
- Added result summary for cartons, total units, cargo weight, cargo CBM, volume utilization, payload utilization, limiting factor, best orientation, and loading grid.
- Added field-level validation states for invalid dimensions, weight, units per carton, and container selection.
- Added clear cargo-too-large and cargo-too-heavy messages.

## Milestone 4: Position Generation

Status:

Completed.

Goal:

Generate renderer-ready carton coordinates from the engine result.

Tasks:

- Add carton position generation to the load domain module.
- Generate positions from the selected orientation and grid.
- Include carton id, x/y/z position, dimensions, and rotation metadata.
- Support partial final layer when weight limits reduce the loaded carton count.
- Add helper metadata for layer filtering.
- Keep position generation independent from Three.js.

Definition of Done:

- Every generated carton stays within container bounds.
- Generated count equals `cartonsLoaded`.
- No generated boxes overlap in the simple grid model.
- Tests cover full grid and partial final layer.

Implementation note:

- Added renderer-ready cargo position generation under `src/domain/load`.
- Positions use millimeter coordinates from the container's front-left-bottom corner.
- Each position includes carton id, x/y/z coordinate, oriented dimensions, zero rotation metadata, and 1-based layer number.
- Added layer metadata and layer filtering helpers for the future 3D viewer.
- Added tests for full-grid position count, first/last coordinates, container bounds, non-overlap, weight-limited partial final layers, layer filtering, and zero-capacity results.

## Milestone 5: 3D Viewer V1

Status:

Completed.

Goal:

Render the calculated loading plan in an inspectable 3D view.

Tasks:

- Add a lightweight Three.js viewer.
- Render:
  - Container bounds.
  - Transparent container walls.
  - Loaded cartons.
- Add camera controls:
  - Rotate.
  - Zoom.
  - Pan.
  - Reset.
- Keep viewer input limited to the engine's structured result and generated positions.

Definition of Done:

- Visual grid matches the calculated result.
- Viewer does not calculate capacity.
- Cartons remain inside container bounds.
- Desktop and mobile layouts are usable.
- Manual browser smoke test passes.

Implementation note:

- Added a Three.js load viewer that renders transparent container walls, container bounds, a floor grid, and loaded cartons.
- Added orbit camera controls for rotate, zoom, and pan.
- Added a Reset camera action.
- The viewer consumes packing results and generated positions from `src/domain/load`; it does not calculate load capacity.
- Added native browser import mapping for Three.js modules.
- Verified desktop and mobile rendering with browser screenshots and sampled pixel checks.

## Milestone 6: 3D Performance And Inspection

Status:

Completed.

Goal:

Make the viewer usable for real container-scale carton counts.

Tasks:

- Use instanced rendering for cartons.
- Add layer inspection:
  - Show all layers.
  - Show one selected layer.
- Add container display modes:
  - Transparent.
  - Wireframe.
  - Solid.
- Add camera presets:
  - Perspective.
  - Front.
  - Back.
  - Left.
  - Right.
  - Top.

Definition of Done:

- Viewer remains interactive with 2,000 cartons on a modern desktop.
- Layer filtering does not change calculation results.
- Camera reset and presets work.
- Container display modes work.

Implementation note:

- Replaced per-carton mesh rendering with a single instanced carton mesh for the visible layer set.
- Added layer inspection, container display mode controls, and camera preset controls to the load viewer panel.
- Kept layer inspection on generated carton positions so filtering changes only the viewer, not packing results.

## Milestone 7: Container Comparison

Status:

Completed.

Goal:

Help exporters choose the best container, not only inspect one selected container.

Tasks:

- Calculate the same cargo against all built-in containers.
- Show a compact comparison table:
  - Container.
  - Cartons.
  - Units.
  - Cargo weight.
  - CBM.
  - Volume utilization.
  - Payload utilization.
  - Limiting factor.
- Allow selecting a comparison result to load it into the main result and viewer.

Definition of Done:

- User can compare 20FT, 40FT, and 40FT High Cube from the same input.
- Selecting a container updates the primary result and viewer.
- Comparison uses the same packing engine as the single-container result.

Implementation note:

- Added a pure container comparison helper that runs the existing packing engine for each built-in container.
- Added a compact comparison table for cartons, units, cargo weight, CBM, utilization, and limiting factor.
- Selecting a comparison row promotes that result into the primary summary, container selector, layer controls, and 3D viewer.

## Milestone 8: MVP Hardening

Status:

Completed.

Goal:

Make the load calculator trustworthy enough for internal use.

Tasks:

- Add regression tests for the example scenarios in `docs/PRD_LOAD.md`.
- Confirm extreme input handling:
  - Very small cartons.
  - Very large cartons.
  - Very heavy cartons.
  - Zero, negative, and missing values.
- Confirm no broken UI output appears.
- Confirm browser layout on desktop and mobile.
- Confirm build passes.
- Confirm tests pass.
- Confirm lint passes if a lint script exists.

Definition of Done:

- A normal load calculation can be completed quickly by a non-technical user.
- Calculation tests cover the business rules.
- Build passes.
- Tests pass.
- Remaining limitations are documented.

Implementation note:

- Added hardening regression coverage for the PRD-style coconut exporter scenario, all built-in comparison outputs, tiny cartons, oversized cartons, overweight cartons, invalid values, and comparison calculation speed.
- Added a layer summary helper that avoids generating every carton position when only layer counts are needed.
- Added a 3D viewer cap message for loads above 5,000 cartons so extreme valid calculations stay responsive.

Remaining limitations:

- MVP supports one cargo type and floor loading only.
- Load plans are not saved yet.
- The 3D viewer intentionally skips carton rendering above 5,000 cartons while still showing complete numeric results.

## Post-MVP: Save And Reuse Load Plans

Status:

Completed.

Goal:

Persist load calculations only after the calculator itself is useful.

Possible tasks:

- Save load plans.
- Reopen previous load plans.
- Duplicate load plans.
- Store result snapshots.
- Store container and cargo inputs used at calculation time.

Do not block MVP on persistence unless users need to compare or reuse load plans during early testing.

Implementation note:

- Added saved load plans with plan name, cargo input, selected container, loading mode, primary result snapshot, and comparison snapshots.
- Added local API and SQLite storage under `/api/load-plans`.
- Added load-plan actions for save/update, reopen, duplicate, archive, and delete.
- Active and archived load plans are separated in the UI so reusable plans stay focused while older calculations remain available.

## Post-MVP: Costing Integration

Status:

Completed.

Goal:

Connect load results to export costing when both tools are stable.

Possible flow:

```text
Product packaging
  -> Load calculator
  -> Cartons / container
  -> Quantity and container requirement
  -> Freight and export costing
  -> Quotation
```

Possible tasks:

- Send total loaded units or cargo weight into a new costing draft.
- Use selected container type as an optional costing field.
- Use cartons-per-container for cost-per-carton and cost-per-unit views.
- Keep costing formulas separate from load formulas.

Implementation note:

- Added a load-to-costing action that starts a new costing draft from the selected load result.
- The costing draft receives product name and total cargo weight as shipment quantity.
- The costing name and status message carry the selected container, carton count, and unit count as context.
- Costing formulas remain unchanged; freight, costs, FX, and pricing stay in the costing workflow.

Remaining limitations:

- Container type is carried as draft context in the costing name/status message, not yet as a first-class costing field.
- Cost-per-carton and cost-per-unit costing views are still future work.

## UX Enhancement: Tool-Scoped Navigation

Status:

Completed.

Goal:

Make the app feel like two focused exporter tools instead of one calculator with scattered history links.

Implementation note:

- Reduced the primary navigation to the tools currently available: Costing calculator and Load calculator.
- Added a shared subnavigation row for Calculator, Saved Plans, and Archived.
- Scoped Saved Plans and Archived views to the currently selected tool.
- Kept the intended calculator below the subnavigation when Calculator is selected.
- Added active and archived load-plan views to match the costing calculator lifecycle.

## Explicit MVP Non-Goals

Do not include these in the first MVP:

- Mixed-SKU loading.
- Pallet loading.
- Manual drag-and-drop load planning.
- AI packing optimization.
- Advanced 3D bin-packing heuristics.
- Product master.
- Shipment master.
- Load report export.
- PDF, Excel, or PNG export.
- Reefer airflow rules.
- Dangerous goods segregation.
- Weight distribution optimization.
- Truck or axle loading.

## Recommended Build Order

1. Milestone 0: Product shape and navigation.
2. Milestone 1: Load domain types and presets.
3. Milestone 2: Packing engine V1.
4. Milestone 3: Calculator UI without 3D.
5. Milestone 4: Position generation.
6. Milestone 5: 3D viewer V1.
7. Milestone 6: 3D performance and inspection.
8. Milestone 7: Container comparison.
9. Milestone 8: MVP hardening.

The first useful internal demo should happen after Milestone 3. The full MVP should finish after Milestone 8.
