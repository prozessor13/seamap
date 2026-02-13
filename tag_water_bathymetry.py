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
    """Process water polygons, return OSM IDs with bathymetry."""
    chunk_data, tid_path, threshold, min_area = args

    tid = rasterio.open(tid_path)
    bounds = tid.bounds

    ids_with_bathy = []

    for row in chunk_data.itertuples():
        geom = row.geometry
        if geom is None or geom.is_empty or geom.area < min_area:
            continue

        if not geom.is_valid:
            geom = make_valid(geom)
            if geom.is_empty:
                continue

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
            osm_id = row.osm_id if hasattr(row, 'osm_id') else row.Index
            try:
                ids_with_bathy.append(int(osm_id))
            except (ValueError, TypeError):
                pass  # Skip NaN or invalid IDs

    tid.close()
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

    args = parser.parse_args()

    if not Path(args.water).exists() or not Path(args.tid).exists():
        print("Error: Input files not found")
        return

    water = gpd.read_file(args.water)

    if 'osm_id' not in water.columns:
        water['osm_id'] = water.index

    if args.bbox:
        minx, miny, maxx, maxy = args.bbox
        water = water.cx[minx:maxx, miny:maxy]

    # Split into chunks
    chunk_size = max(1, len(water) // args.workers)
    chunks = [water.iloc[i:i+chunk_size] for i in range(0, len(water), chunk_size)]
    chunk_args = [(chunk, args.tid, args.threshold, args.min_area)
                  for chunk in chunks if len(chunk) > 0]

    # Process
    all_ids = []
    with Pool(args.workers) as pool:
        for result in pool.imap_unordered(process_chunk, chunk_args):
            all_ids.extend(result)

    # Write output
    with open(args.output, 'w') as f:
        for osm_id in sorted(set(all_ids)):
            f.write(f"{osm_id}\n")

    print(f"Wrote {len(all_ids)} IDs to {args.output}")


if __name__ == '__main__':
    main()
