# Seamap.java - Planetiler Profile for Nautical Charts

## Overview
This Java file implements a Planetiler profile that converts OpenStreetMap data directly into PMTiles vector tiles for nautical charts. It replaces the previous imposm3 + PostgreSQL workflow.

## Features

### 1. Seamark Base Objects (`seamark:*` tags)
- Processes all seamark types: buoys, beacons, lights, landmarks, harbours, etc.
- Extracts comprehensive attributes:
  - `osm_id`, `type`, `name`, `reference`, `function`, `category`, `shape`
  - `color`, `color_pattern` (with semicolon → underscore conversion)
  - `light` (abbreviated format), `light_color`, `light_sequence`
  - `topmark_color`, `topmark_shape` (sanitized)
- Creates separate layers:
  - `seamark_point` - Point features
  - `seamark_linestring` - Line features
  - `seamark_polygon` - Polygon features with additional label points (PointOnSurface)

### 2. Derived Seamark Features
Maps standard OSM tags to seamark types:

| OSM Tags | Seamark Type | Category | Geometries |
|----------|--------------|----------|------------|
| `route=ferry` | `ferry_route` | - | linestring |
| `waterway:sign=anchor` | `anchorage` | - | point/line/polygon |
| `power=cable` + `location=underwater` | `cable_submarine` | `power` | linestring |
| `man_made=pipeline` + `location=underwater` | `pipeline_submarine` | substance | linestring |
| `man_made=pier` | `mooring` | `pier` | point/line/polygon |
| `leisure=marina` | `harbour` | `marina` | line/polygon |
| `leisure=swimming_area\|nature_reserve` | `restricted_area` | leisure value | line/polygon |
| `man_made=tower\|windmill\|gasometer` | `landmark` | `man_made` | point |
| `man_made=lighthouse` | `lighthouse` | - | point (with full light attributes) |

### 3. Places Layer
- Extracts `natural=bay` features
- Creates point geometry:
  - Points: direct geometry
  - Lines: centroid point
  - Polygons: point on surface
- Attributes: `osm_id`, `type`, `subtype`, `name`, `reference`

### 4. Default Values for IALA Maritime Buoyage System
Implements automatic defaults for standardized seamark types:

#### Cardinal Marks
- **North**: black_yellow horizontal, 2 cones up, black topmark
- **East**: black_yellow_black horizontal, 2 cones base together, black topmark
- **South**: yellow_black horizontal, 2 cones down, black topmark
- **West**: yellow_black_yellow horizontal, 2 cones point together, black topmark

#### Isolated Danger
- Color: red_black_red horizontal
- Topmark: 2 spheres, black

#### Safe Water
- Color: red_white vertical
- Topmark: sphere, red

#### Special Purpose
- Color: yellow

#### Generic Defaults
- All beacons: shape = buoyant (transformed from pile)
- All buoys: shape = pillar
- Colors with underscore: color_pattern = horizontal

### 5. Light Abbreviation
Replicates SQL `seamark_light_abbr()` function:
- Format: `<character>(<group>).<COLORS>.<period>s<height>m<range>M`
- Supports single and multi-light configurations
- Extracts max range per color
- Example: `Fl(3).WRG.10s15m12M`

### 6. Numeric Value Parsing
Replicates SQL `to_numeric()` function:
- Handles European decimal format (comma as decimal separator)
- Removes thousand separators
- Strips leading zeros

## Usage

### Compile
```bash
javac -cp planetiler.jar Seamap.java
```

### Run
```bash
java -Xmx4g -cp planetiler.jar:. Seamarks \
  --download \
  --area=austria \
  --output=seamarks.pmtiles \
  --force
```

Or for a local OSM file:
```bash
java -Xmx4g -cp planetiler.jar:. Seamarks \
  --osm-path=data/austria.osm.pbf \
  --output=seamarks.pmtiles \
  --force
```

## Output Layers

### seamark_point
Point features for all seamark objects

**Attributes:**
- `osm_id` (integer)
- `type` (string) - seamark type
- `name` (string)
- `reference` (string)
- `function` (string)
- `category` (string)
- `shape` (string)
- `color` (string)
- `color_pattern` (string)
- `light` (string) - abbreviated light characteristics
- `light_color` (string)
- `light_sequence` (string)
- `topmark_color` (string)
- `topmark_shape` (string)

### seamark_linestring
Line features for seamark objects (cables, pipelines, fairways, etc.)

**Attributes:** Same as seamark_point

### seamark_polygon
Polygon features for areas (harbours, restricted areas, etc.)

**Attributes:** Same as seamark_point

**Note:** Polygon features also generate a corresponding point feature in `seamark_point` layer for labeling (using point on surface).

### places
Named places relevant for nautical charts (bays, harbours, etc.)

**Attributes:**
- `osm_id` (integer)
- `type` (string) - mapping key (e.g., "natural")
- `subtype` (string) - mapping value (e.g., "bay")
- `name` (string)
- `reference` (string)

## Differences from SQL Implementation

1. **No PostgreSQL dependency**: Direct OSM → PMTiles conversion
2. **Single-pass processing**: No intermediate tables or UPDATE statements
3. **Default values**: Applied during feature creation instead of post-processing
4. **Label points**: Generated automatically for polygons using Planetiler's built-in methods

## TODOs / Future Enhancements

1. Add support for additional place types (harbours, anchorages as places)
2. Implement zoom-level specific filtering
3. Add minzoom attributes for feature visibility optimization
4. Consider adding depth contours, soundings, land polygons as separate layers

## Validation

The implementation has been verified against:
- `sql/seamarks.sql` - SQL logic for seamark processing
- `sql/places.sql` - Places extraction logic
- `imposm3/seamarks.yaml` - Input table definitions

All transformations, default values, and attribute mappings match the original SQL implementation.
