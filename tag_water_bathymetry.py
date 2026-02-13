#!/usr/bin/env python3
"""
Minimal script to extract OSM water IDs with real bathymetry coverage from GEBCO TID.

Usage:
  python tag_water_bathymetry.py --water osm_water.gpkg --tid gebco_tid.tif --output water_ids.txt
"""

import argparse
from pathlib import Path
from multiprocessing import Pool, cpu_count

import geopandas as gpd
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import Window, from_bounds
from shapely.validation import make_valid


def process_chunk(args):
    """Process water polygons from a chunk range, return OSM IDs with bathymetry."""
    water_path, start_idx, chunk_size, tid_path, threshold, min_area, bbox = args

    tid = rasterio.open(tid_path)
    bounds = tid.bounds

    ids_with_bathy = []

    # Read only the chunk we need using row slicing
    gdf = gpd.read_file(water_path, rows=slice(start_idx, start_idx + chunk_size))

    # Apply bbox filter if specified
    if bbox:
        minx, miny, maxx, maxy = bbox
        gdf = gdf.cx[minx:maxx, miny:maxy]

    processed = 0
    for idx, row in gdf.iterrows():
        geom = row.geometry

        if geom is None or geom.is_empty or geom.area < min_area:
            continue

        if not geom.is_valid:
            geom = make_valid(geom)
            if geom.is_empty:
                continue

        processed += 1
        if processed % 1000 == 0:
            print(f"Worker processing feature {processed} (offset {start_idx})", flush=True)

        b = geom.bounds

        # Skip if outside raster
        if b[0] > bounds.right or b[2] < bounds.left or b[1] > bounds.top or b[3] < bounds.bottom:
            continue

        # Clamp to raster bounds
        cb = (max(b[0], bounds.left), max(b[1], bounds.bottom),
              min(b[2], bounds.right), min(b[3], bounds.top))

        window = from_bounds(*cb, transform=tid.transform)
        col_off = max(int(window.col_off), 0)
        row_off = max(int(window.row_off), 0)
        width = min(int(round(window.width)), tid.width - col_off)
        height = min(int(round(window.height)), tid.height - row_off)

        if width <= 0 or height <= 0:
            continue

        win = Window(col_off, row_off, width, height)
        win_transform = tid.window_transform(win)

        mask = geometry_mask([geom], out_shape=(height, width),
                            transform=win_transform, invert=True)

        data = tid.read(1, window=win)
        pixels = data[mask]

        if len(pixels) == 0:
            continue

        # Count non-zero TID values (real bathymetry data)
        real_data = pixels[pixels != 0]
        ratio = len(real_data) / len(pixels)

        if ratio >= threshold:
            # Extract OSM ID
            osm_id = row.get('osm_id')
            if osm_id is not None:
                try:
                    ids_with_bathy.append(int(osm_id))
                except (ValueError, TypeError):
                    pass  # Skip NaN or invalid IDs

    tid.close()
    print(f"Worker finished: {len(ids_with_bathy)} IDs with bathymetry from {processed} features", flush=True)
    return ids_with_bathy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--water', required=True, help='OSM water polygons (GPKG)')
    parser.add_argument('--tid', required=True, help='GEBCO TID GeoTIFF')
    parser.add_argument('--output', default='water_with_bathymetry.txt')
    parser.add_argument('--threshold', type=float, default=0.2)
    parser.add_argument('--min-area', type=float, default=0.00005)
    parser.add_argument('--workers', type=int, default=cpu_count())
    parser.add_argument('--bbox', type=float, nargs=4, default=None)
    parser.add_argument('--chunk-size', type=int, default=10000,
                       help='Number of features per chunk (default: 10000)')

    args = parser.parse_args()

    if not Path(args.water).exists() or not Path(args.tid).exists():
        print("Error: Input files not found")
        return

    # Count total features using geopandas
    print("Counting features...")
    # Read without geometry for faster counting
    gdf_count = gpd.read_file(args.water, ignore_geometry=True)
    total_features = len(gdf_count)
    del gdf_count  # Free memory

    print(f"Total features in GPKG: {total_features}")
    print(f"Chunk size: {args.chunk_size}")
    print(f"Workers: {args.workers}")

    # Create chunk ranges (start_idx, chunk_size)
    chunk_args = []
    for start_idx in range(0, total_features, args.chunk_size):
        actual_chunk_size = min(args.chunk_size, total_features - start_idx)
        chunk_args.append((
            args.water,
            start_idx,
            actual_chunk_size,
            args.tid,
            args.threshold,
            args.min_area,
            args.bbox
        ))

    print(f"Created {len(chunk_args)} chunks")

    # Process chunks in parallel
    all_ids = []
    with Pool(args.workers) as pool:
        for i, result in enumerate(pool.imap_unordered(process_chunk, chunk_args)):
            all_ids.extend(result)
            print(f"Completed chunk {i+1}/{len(chunk_args)}, total IDs so far: {len(all_ids)}", flush=True)

    # Write output
    unique_ids = sorted(set(all_ids))
    with open(args.output, 'w') as f:
        for osm_id in unique_ids:
            f.write(f"{osm_id}\n")

    print(f"Wrote {len(unique_ids)} unique IDs to {args.output}")


if __name__ == '__main__':
    main()
