# Product Requirements Document  
## Export Container Load Calculator & 3D Load Planner

### 1. Product Overview

Build a web-based container load calculator for exporters.

The application helps exporters determine how many cartons, products, or pallets can fit inside a shipping container while considering:

- Cargo dimensions
- Cargo weight
- Container dimensions
- Container payload limit
- Cargo orientation
- Volume utilization
- Weight utilization
- Loading arrangement

The system should also provide an interactive 3D visualization of the calculated loading plan.

The initial version focuses on simple, reliable calculations for a single cargo type.

More advanced optimization such as mixed-SKU loading, palletization, and manual load planning can be added later.

---

# 2. Product Goal

The primary goal is to answer:

> How many units of this product can I load into this container?

The system should also answer:

- Which container should I use?
- How many cartons fit?
- How many total units fit?
- What is the total cargo weight?
- How much CBM is used?
- Which carton orientation gives the best result?
- Is the shipment limited by space or weight?
- What does the loading arrangement look like?

---

# 3. Target Users

Primary users:

- Exporters
- Freight forwarders
- Export sales teams
- Export costing teams
- Manufacturers
- Logistics staff

Typical workflow:

1. Exporter receives buyer inquiry.
2. Buyer requests pricing for one container.
3. Exporter enters product packaging information.
4. System calculates maximum container capacity.
5. Exporter reviews the 3D loading plan.
6. Result is later used for export costing and quotation.

---

# 4. Example User Scenario

A coconut exporter has the following packaging:

Carton size:

- Length: 60 cm
- Width: 40 cm
- Height: 30 cm
- Gross weight: 20 kg
- Units per carton: 12

The exporter selects:

40FT High Cube

The system calculates:

- Maximum cartons
- Total units
- Total cargo weight
- Cargo CBM
- Space utilization
- Payload utilization
- Best orientation
- Carton arrangement

Example output:

- 792 cartons
- 9,504 units
- 15,840 kg cargo weight
- 57.02 CBM
- 84% volume utilization
- 60% payload utilization
- Limiting factor: space

The user can then inspect the arrangement in 3D.

---

# 5. Product Scope

## MVP Scope

The MVP should support:

### Cargo input

User can enter:

- Product name
- Carton length
- Carton width
- Carton height
- Gross weight per carton
- Units per carton

Supported dimension units:

- cm
- mm
- inch

Supported weight units:

- kg
- lb

Internally all dimensions should be normalized to millimeters and weight to kilograms.

---

# 6. Container Types

Provide built-in presets.

Initial presets:

- 20FT General Purpose
- 40FT General Purpose
- 40FT High Cube

Each container must define:

- Internal length
- Internal width
- Internal height
- Maximum payload
- Container tare weight
- Maximum gross weight

Container specifications must live in configuration or database records instead of being hardcoded throughout the application.

Example:

```ts
interface ContainerSpecification {
  id: string;
  name: string;

  internalLengthMm: number;
  internalWidthMm: number;
  internalHeightMm: number;

  maxPayloadKg: number;
  tareWeightKg?: number;
  maxGrossWeightKg?: number;
}
```

The architecture must allow additional container types later.

Examples:

- 10FT
- 45FT HC
- Reefer
- Open Top
- Flat Rack
- Custom container

---

# 7. Loading Modes

MVP supports:

### Floor Loading

Cartons are loaded directly inside the container.

Future modes:

- Palletized
- Mixed SKU
- Manual loading

---

# 8. Calculation Engine

The calculation engine is the core system.

It must exist independently from the UI and 3D renderer.

Recommended implementation:

Pure TypeScript library.

Example:

```text
/packages
    /packing-engine
```

The engine must not depend on:

- React
- Three.js
- Database
- Browser APIs

This allows the engine to be tested independently.

---

# 9. Carton Orientation Algorithm

A rectangular carton has six possible axis orientations.

Given dimensions:

```text
L × W × H
```

Generate:

```text
L × W × H
L × H × W
W × L × H
W × H × L
H × L × W
H × W × L
```

Duplicate orientations should be removed.

For example, a cube only has one unique orientation.

---

# 10. Spatial Capacity Calculation

For every orientation:

```text
xCount = floor(containerLength / cartonLength)

yCount = floor(containerWidth / cartonWidth)

zCount = floor(containerHeight / cartonHeight)
```

Then:

```text
spatialCapacity =
xCount × yCount × zCount
```

The engine evaluates every valid orientation.

The arrangement producing the highest usable capacity becomes the default loading arrangement.

---

# 11. Weight Capacity Calculation

Calculate:

```text
weightCapacity =
floor(containerMaxPayload / cartonGrossWeight)
```

Final carton capacity:

```text
finalCapacity =
min(spatialCapacity, weightCapacity)
```

The result must identify the limiting factor.

Possible values:

```text
SPACE
WEIGHT
EQUAL
```

---

# 12. CBM Calculation

Carton CBM:

```text
(lengthMeters × widthMeters × heightMeters)
```

Cargo CBM:

```text
cartonCBM × loadedCartons
```

Container volume:

```text
containerLength ×
containerWidth ×
containerHeight
```

Volume utilization:

```text
cargoCBM /
containerInternalVolume × 100
```

---

# 13. Weight Utilization

Calculate:

```text
totalCargoWeight =
cartonWeight × loadedCartons
```

Payload utilization:

```text
totalCargoWeight /
containerMaxPayload × 100
```

---

# 14. Unit Calculation

If:

```text
unitsPerCarton = 12
```

and:

```text
loadedCartons = 800
```

then:

```text
totalUnits = 9600
```

---

# 15. Packing Result Model

The calculation engine should return a structured result.

Example:

```ts
interface PackingResult {
  containerId: string;

  cartonsLoaded: number;

  totalUnits: number;

  totalCargoWeightKg: number;

  cargoVolumeM3: number;

  containerVolumeM3: number;

  volumeUtilizationPercent: number;

  payloadUtilizationPercent: number;

  limitingFactor:
    | "SPACE"
    | "WEIGHT"
    | "EQUAL";

  orientation: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
  };

  grid: {
    x: number;
    y: number;
    z: number;
  };

  unusedSpace: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
  };
}
```

---

# 16. Position Generation

The engine should also generate box positions.

Each box receives:

```ts
interface CargoPosition {
  id: string;

  x: number;
  y: number;
  z: number;

  rotationX: number;
  rotationY: number;
  rotationZ: number;
}
```

These positions will be consumed by the 3D renderer.

Important:

The visualization must never determine loading capacity itself.

The flow must remain:

```text
USER INPUT

     ↓

PACKING ENGINE

     ↓

PACKING RESULT

     ↓

3D VISUALIZATION
```

---

# 17. 3D Visualization

Recommended technology:

- Three.js
- React Three Fiber
- @react-three/drei

The viewer should display:

- Container
- Cargo cartons
- Remaining container space

---

# 18. 3D Viewer Controls

User must be able to:

- Rotate camera
- Zoom
- Pan
- Reset camera

Provide camera presets:

- Perspective
- Front
- Back
- Left
- Right
- Top

---

# 19. Container Rendering

Container should visually resemble a shipping container.

However, photorealism is not required.

The container should support:

### Transparent mode

Container walls become partially transparent.

### Wireframe mode

Only container boundaries are visible.

### Solid mode

Container surfaces are shown.

Default:

Transparent.

---

# 20. Cargo Rendering

Each carton should appear as a rectangular box.

Optional visual details:

- Product name
- Carton number
- Dimensions

The renderer should avoid displaying thousands of individual React components if this creates performance issues.

For large cargo counts, use:

Three.js `InstancedMesh`.

This is important because one container may contain:

500–5,000+ cartons.

---

# 21. Layer Inspection

Allow users to inspect loading layers.

Example:

```text
Layer

[1] [2] [3] [4] [5] [6] [7]
```

Selecting layer 4 displays only cartons belonging to layer 4.

Provide:

```text
Show all layers
```

---

# 22. Calculation Result Screen

The result screen should emphasize the most useful information.

Example:

```text
40FT HIGH CUBE

792 CARTONS

9,504 units

Cargo Weight
15,840 kg

Cargo Volume
57.02 CBM

SPACE UTILIZATION

████████████████░░░

84.2%

PAYLOAD UTILIZATION

███████████░░░░░░░

59.8%

LIMITING FACTOR

SPACE
```

---

# 23. Orientation Result

Show the recommended orientation.

Example:

```text
BEST CARTON ORIENTATION

60 × 40 × 30 cm

Arrangement

20 cartons lengthwise
5 cartons across
8 layers

20 × 5 × 8
```

---

# 24. Alternative Orientations

The calculator should optionally show other orientation results.

Example:

| Orientation | Cartons |
|---|---:|
| 60 × 40 × 30 | 800 |
| 40 × 60 × 30 | 760 |
| 30 × 40 × 60 | 720 |

The best orientation should be highlighted.

---

# 25. Container Comparison

User should be able to calculate multiple containers.

Example:

| Container | Cartons | Units | CBM | Cargo Weight |
|---|---:|---:|---:|---:|
| 20FT | 320 | 3,840 | 23.0 | 6,400 kg |
| 40FT | 680 | 8,160 | 48.9 | 13,600 kg |
| 40HC | 800 | 9,600 | 57.6 | 16,000 kg |

This allows exporters to quickly decide which container is most economical.

---

# 26. User Interface

Recommended layout:

```text
------------------------------------------------

LOAD CALCULATOR

PRODUCT

Product Name
[ Coconut Briquette ]

Carton Size

Length     Width      Height

[ 60 ]     [ 40 ]     [ 30 ]

Unit
[ cm ]

Gross Weight

[ 20 ] kg

Units / Carton

[ 12 ]

--------------------------------------------

CONTAINER

[ 20FT ]

[ 40FT ]

[ 40HC ]

--------------------------------------------

Loading Mode

● Floor Loaded

○ Palletized
  Coming later

--------------------------------------------

[ CALCULATE LOAD ]

------------------------------------------------
```

---

# 27. Result Layout

Desktop:

```text
-------------------------------------------------

Results

40HC

792 Cartons
9,504 Units

┌───────────────────┐
│                   │
│                   │
│    3D VIEWER      │
│                   │
│                   │
└───────────────────┘

Volume          84%

Weight          60%

Cargo Weight    15,840 kg

Cargo CBM       57.02

Limiting Factor SPACE

-------------------------------------------------
```

Mobile:

3D visualization appears underneath the summary.

---

# 28. Validation Rules

Inputs must be validated.

Dimensions:

```text
> 0
```

Weight:

```text
> 0
```

Units per carton:

```text
>= 1
```

The system must handle:

- Cargo larger than container
- Cargo heavier than payload
- Zero values
- Negative values
- Missing values
- Extremely small packages
- Extremely large package counts

Never return:

```text
NaN
Infinity
undefined
```

---

# 29. Cargo Too Large

Example:

Carton:

```text
300 × 300 × 300 cm
```

Container:

```text
235 cm internal width
```

Return:

```text
This cargo cannot fit inside the selected container.
```

The engine should return:

```ts
{
  cartonsLoaded: 0,
  reason: "CARGO_DIMENSIONS_EXCEED_CONTAINER"
}
```

---

# 30. Performance Requirements

Calculation target:

```text
<100ms
```

for single-SKU loading.

3D visualization target:

Smooth interaction with:

```text
2,000 cartons
```

Prefer:

```text
60 FPS
```

on a modern desktop.

Use instanced rendering where appropriate.

---

# 31. Architecture

Recommended architecture:

```text
Next.js

apps/
   web/

packages/

   packing-engine/

   container-data/

   types/

   ui/
```

Example:

```text
apps/web

packages/packing-engine
    orientation.ts
    calculateCapacity.ts
    calculateWeight.ts
    calculateVolume.ts
    generatePositions.ts

packages/container-data
    containers.ts

packages/types
    cargo.ts
    container.ts
    packing.ts
```

---

# 32. Suggested Frontend Stack

Recommended:

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
React Hook Form
Zod
React Three Fiber
Three.js
@react-three/drei
Vitest
Playwright
```

Optional:

```text
Zustand
```

for calculator/viewer state.

---

# 33. Testing Requirements

The packing engine must have strong unit test coverage.

Example:

Given:

```text
Container

1200 × 240 × 260 cm

Carton

60 × 40 × 30 cm
```

Expected:

```text
20 × 6 × 8

960 cartons
```

Tests should cover every orientation.

---

# 34. Edge-Case Tests

Codex must implement tests for:

### Perfect fit

Container:

```text
600 × 400 × 300
```

Cargo:

```text
60 × 40 × 30
```

Expected:

```text
1000 cartons
```

### Weight limited

Space capacity:

```text
1000 cartons
```

Weight capacity:

```text
500 cartons
```

Expected:

```text
500 cartons
```

Limiting factor:

```text
WEIGHT
```

### Space limited

Space:

```text
500 cartons
```

Weight:

```text
1000 cartons
```

Expected:

```text
500
```

Limiting factor:

```text
SPACE
```

---

# 35. 3D Testing

Verify:

- Correct number of boxes rendered
- Correct dimensions
- Correct orientation
- Boxes remain inside container boundaries
- No boxes overlap
- Layer filtering works
- Camera reset works
- Container transparency works

---

# 36. MVP Non-Goals

The first version should NOT attempt:

- Mixed SKU optimization
- Irregularly shaped cargo
- Rotation of individual cartons independently
- AI-based packing
- Physical simulation
- Truck load optimization
- Axle load calculations
- Dangerous goods segregation
- Reefer airflow optimization
- Weight distribution optimization
- Pallet optimization

These should be future phases.

---

# 37. Phase 2 — Pallet Loading

Add:

```text
Carton
   ↓
Pallet
   ↓
Container
```

User enters:

- Pallet dimensions
- Pallet weight
- Maximum pallet height
- Maximum pallet weight

System calculates:

```text
cartons / pallet

pallets / container

cartons / container
```

---

# 38. Phase 3 — Mixed SKU

Support multiple products.

Example:

```text
Product A

60 × 40 × 30
100 cartons

Product B

50 × 30 × 25
200 cartons

Product C

30 × 20 × 20
300 cartons
```

The system attempts to maximize container utilization.

This requires a proper 3D bin packing algorithm.

---

# 39. Phase 4 — Advanced Packing Optimizer

Introduce packing heuristics.

Possible algorithms:

- First Fit Decreasing
- Best Fit
- Extreme Point algorithms
- Guillotine partitioning
- Maximal Spaces
- Genetic algorithms

Do not introduce this complexity during MVP.

---

# 40. Phase 5 — Manual Load Planner

Allow users to manually:

- Move cartons
- Rotate cartons
- Remove cartons
- Add cartons
- Lock positions

The optimized result becomes the starting layout.

---

# 41. Phase 6 — Loading Sequence

Generate suggested loading sequence.

Example:

```text
LOAD

Layer 1
Cartons 1–100

Layer 2
Cartons 101–200

...

UNLOAD

Layer 8
Layer 7
...
```

Useful for warehouse operations.

---

# 42. Phase 7 — Export Report

Allow exporting the result.

Possible formats:

- PDF
- Excel
- PNG
- Shareable link

Report contains:

- Product information
- Container
- Cartons
- Units
- Cargo weight
- CBM
- Utilization
- Loading arrangement
- 3D screenshot

---

# 43. Phase 8 — Export Costing Integration

Connect the calculator with an export costing module.

Flow:

```text
PRODUCT

↓

PACKAGING

↓

LOAD CALCULATOR

↓

CONTAINER REQUIREMENT

↓

FREIGHT COST

↓

EXPORT COST

↓

FOB / CFR / CIF

↓

QUOTATION
```

Example:

```text
40HC

1,850 cartons

Product Cost
$15,000

Inland Transport
$700

Origin Charges
$450

Ocean Freight
$1,900

Documentation
$150

TOTAL

$18,200

Cost / Carton

$9.84
```

---

# 44. Future Product Entity

Eventually a product should have reusable packaging information.

```ts
interface Product {
  id: string;

  name: string;

  sku?: string;

  packaging: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;

    grossWeightKg: number;

    unitsPerCarton: number;
  };
}
```

The user can then select:

```text
Select Product

[ Coconut Briquette 10KG ▼ ]
```

instead of entering packaging every time.

---

# 45. Future Shipment Entity

```ts
interface Shipment {
  id: string;

  containerId: string;

  products: ShipmentProduct[];

  packingResult: PackingResult;

  createdAt: string;
}
```

This allows users to save loading plans.

---

# 46. Recommended Implementation Order for Codex

Codex should NOT build everything simultaneously.

### Milestone 1

Create:

- Type definitions
- Container specifications
- Unit conversion utilities

No UI.

Acceptance criteria:

All unit tests pass.

---

### Milestone 2

Implement:

- Orientation generator
- Spatial capacity calculator
- Weight capacity calculator
- Final load calculation

Acceptance criteria:

Packing result is deterministic and fully unit tested.

---

### Milestone 3

Build simple calculator UI.

Implement:

- Product form
- Container selector
- Calculate button
- Result summary

No 3D yet.

Acceptance criteria:

User can perform complete load calculation from browser.

---

### Milestone 4

Generate carton coordinates.

Example:

```text
carton #1

x = 0
y = 0
z = 0

carton #2

x = cartonWidth
y = 0
z = 0
```

Acceptance criteria:

Every generated carton stays within container bounds.

---

### Milestone 5

Implement Three.js viewer.

Render:

- Container
- Cartons
- Camera controls

Acceptance criteria:

Packing result visually matches calculated grid.

---

### Milestone 6

Optimize rendering.

Introduce:

```text
InstancedMesh
```

Acceptance criteria:

2,000 cartons remain interactively usable.

---

### Milestone 7

Add:

- Layer filtering
- Container transparency
- Camera presets
- Orientation display

---

### Milestone 8

Add container comparison.

---

# 47. Definition of Done for MVP

MVP is complete when a user can:

1. Enter carton dimensions.
2. Enter carton weight.
3. Enter units per carton.
4. Select a container.
5. Calculate maximum loading capacity.
6. See total cartons.
7. See total units.
8. See total cargo weight.
9. See cargo CBM.
10. See volume utilization.
11. See payload utilization.
12. See limiting factor.
13. See best carton orientation.
14. See loading grid.
15. Inspect the calculated arrangement in interactive 3D.

The same calculation must produce the same result regardless of whether the 3D viewer is enabled.

---

# 48. Core Engineering Principle

The most important architectural rule for the project:

```text
THE PACKING ENGINE IS THE SOURCE OF TRUTH.
```

The frontend collects inputs.

The packing engine calculates.

The 3D viewer renders.

The database stores.

These responsibilities must remain separate.

Architecture:

```text
                   ┌──────────────┐
                   │    USER      │
                   └──────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │ Calculator UI │
                  └───────┬───────┘
                          │
                          ▼
               ┌────────────────────┐
               │   PACKING ENGINE   │
               │                    │
               │ Orientation        │
               │ Capacity           │
               │ Weight             │
               │ CBM                │
               │ Coordinates        │
               └─────────┬──────────┘
                         │
                 PackingResult
                         │
             ┌───────────┴───────────┐
             │                       │
             ▼                       ▼

      ┌──────────────┐        ┌──────────────┐
      │ Results UI   │        │  3D Viewer   │
      └──────────────┘        └──────────────┘
```

This architecture prepares the project for much more advanced optimization later without requiring a rewrite of the entire application.