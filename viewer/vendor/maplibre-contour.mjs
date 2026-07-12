/* eslint-disable */

var shared, worker, mlcontour;
// define gets called three times: one for each chunk. we rely on the order
// they're imported to know which is which
function define(_, chunk) {
  if (!shared) {
    shared = chunk;
  } else if (!worker) {
    worker = chunk;
  } else {
    var workerBundleString =
      "var sharedChunk = {}; (" +
      shared +
      ")(sharedChunk); (" +
      worker +
      ")(sharedChunk);";

    var sharedChunk = {};
    shared(sharedChunk);
    mlcontour = chunk(sharedChunk);
    if (typeof window !== "undefined") {
      mlcontour.workerUrl = window.URL.createObjectURL(
        new Blob([workerBundleString], { type: "text/javascript" })
      );
    }
  }
}


define(['exports'], (function (exports) { 'use strict';

/*
Adapted from d3-contour https://github.com/d3/d3-contour

Copyright 2012-2023 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
*/
class Fragment {
    constructor(start, end) {
        this.start = start;
        this.end = end;
        this.points = [];
        this.append = this.append.bind(this);
        this.prepend = this.prepend.bind(this);
    }
    append(x, y) {
        this.points.push(Math.round(x), Math.round(y));
    }
    prepend(x, y) {
        this.points.splice(0, 0, Math.round(x), Math.round(y));
    }
    lineString() {
        return this.toArray();
    }
    isEmpty() {
        return this.points.length < 2;
    }
    appendFragment(other) {
        this.points.push(...other.points);
        this.end = other.end;
    }
    toArray() {
        return this.points;
    }
}
const CASES = [
    [],
    [
        [
            [1, 2],
            [0, 1],
        ],
    ],
    [
        [
            [2, 1],
            [1, 2],
        ],
    ],
    [
        [
            [2, 1],
            [0, 1],
        ],
    ],
    [
        [
            [1, 0],
            [2, 1],
        ],
    ],
    [
        [
            [1, 2],
            [0, 1],
        ],
        [
            [1, 0],
            [2, 1],
        ],
    ],
    [
        [
            [1, 0],
            [1, 2],
        ],
    ],
    [
        [
            [1, 0],
            [0, 1],
        ],
    ],
    [
        [
            [0, 1],
            [1, 0],
        ],
    ],
    [
        [
            [1, 2],
            [1, 0],
        ],
    ],
    [
        [
            [0, 1],
            [1, 0],
        ],
        [
            [2, 1],
            [1, 2],
        ],
    ],
    [
        [
            [2, 1],
            [1, 0],
        ],
    ],
    [
        [
            [0, 1],
            [2, 1],
        ],
    ],
    [
        [
            [1, 2],
            [2, 1],
        ],
    ],
    [
        [
            [0, 1],
            [1, 2],
        ],
    ],
    [],
];
function index(width, x, y, point) {
    x = x * 2 + point[0];
    y = y * 2 + point[1];
    return x + y * (width + 1) * 2;
}
function ratio(a, b, c) {
    return (b - a) / (c - a);
}
/**
 * Generates contour lines from a HeightTile using the custom d3-contour algorithm.
 *
 * This implementation is used for THRESHOLD-based (interval) contour generation.
 * For fixed LEVEL-based contours, use isolines-ms.ts instead (marching-squares library).
 *
 * @param intervalOrLevels Vertical distance between contours (number) or array of specific levels
 * @param tile The input height tile, where values represent the height at the top-left of each pixel
 * @param extent Vector tile extent (default 4096)
 * @param buffer How many pixels into each neighboring tile to include in a tile
 * @returns an object where keys are the elevation, and values are a list of `[x1, y1, x2, y2, ...]`
 * contour lines in tile coordinates
 */
function generateIsolines(intervalOrLevels, tile, extent = 4096, buffer = 1) {
    if (!intervalOrLevels ||
        (Array.isArray(intervalOrLevels) && intervalOrLevels.length === 0)) {
        return {};
    }
    // Check if using interval or specific levels
    const isInterval = typeof intervalOrLevels === "number";
    const levels = isInterval
        ? null
        : [...intervalOrLevels].sort((a, b) => a - b);
    const multiplier = extent / (tile.width - 1);
    let tld, trd, bld, brd;
    let r, c;
    const segments = {};
    const fragmentByStartByLevel = new Map();
    const fragmentByEndByLevel = new Map();
    function interpolate(point, threshold, accept) {
        if (point[0] === 0) {
            // left
            accept(multiplier * (c - 1), multiplier * (r - ratio(bld, threshold, tld)));
        }
        else if (point[0] === 2) {
            // right
            accept(multiplier * c, multiplier * (r - ratio(brd, threshold, trd)));
        }
        else if (point[1] === 0) {
            // top
            accept(multiplier * (c - ratio(trd, threshold, tld)), multiplier * (r - 1));
        }
        else {
            // bottom
            accept(multiplier * (c - ratio(brd, threshold, bld)), multiplier * r);
        }
    }
    // Most marching-squares implementations (d3-contour, gdal-contour) make one pass through the matrix per threshold.
    // This implementation makes a single pass through the matrix, building up all of the contour lines at the
    // same time to improve performance.
    for (r = 1 - buffer; r < tile.height + buffer; r++) {
        trd = tile.get(0, r - 1);
        brd = tile.get(0, r);
        let minR = Math.min(trd, brd);
        let maxR = Math.max(trd, brd);
        for (c = 1 - buffer; c < tile.width + buffer; c++) {
            tld = trd;
            bld = brd;
            trd = tile.get(c, r - 1);
            brd = tile.get(c, r);
            const minL = minR;
            const maxL = maxR;
            minR = Math.min(trd, brd);
            maxR = Math.max(trd, brd);
            if (isNaN(tld) || isNaN(trd) || isNaN(brd) || isNaN(bld)) {
                continue;
            }
            const min = Math.min(minL, minR);
            const max = Math.max(maxL, maxR);
            // Determine which thresholds to process for this cell
            let thresholds;
            if (isInterval) {
                const interval = intervalOrLevels;
                const start = Math.ceil(min / interval) * interval;
                const end = Math.floor(max / interval) * interval;
                thresholds = [];
                for (let threshold = start; threshold <= end; threshold += interval) {
                    thresholds.push(threshold);
                }
            }
            else {
                // Filter levels that fall within this cell's range
                thresholds = levels.filter((level) => level >= min && level <= max);
            }
            for (const threshold of thresholds) {
                const tl = tld > threshold;
                const tr = trd > threshold;
                const bl = bld > threshold;
                const br = brd > threshold;
                for (const segment of CASES[(tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)]) {
                    let fragmentByStart = fragmentByStartByLevel.get(threshold);
                    if (!fragmentByStart)
                        fragmentByStartByLevel.set(threshold, (fragmentByStart = new Map()));
                    let fragmentByEnd = fragmentByEndByLevel.get(threshold);
                    if (!fragmentByEnd)
                        fragmentByEndByLevel.set(threshold, (fragmentByEnd = new Map()));
                    const start = segment[0];
                    const end = segment[1];
                    const startIndex = index(tile.width, c, r, start);
                    const endIndex = index(tile.width, c, r, end);
                    let f, g;
                    if ((f = fragmentByEnd.get(startIndex))) {
                        fragmentByEnd.delete(startIndex);
                        if ((g = fragmentByStart.get(endIndex))) {
                            fragmentByStart.delete(endIndex);
                            if (f === g) {
                                // closing a ring
                                interpolate(end, threshold, f.append);
                                if (!f.isEmpty()) {
                                    let list = segments[threshold];
                                    if (!list) {
                                        segments[threshold] = list = [];
                                    }
                                    list.push(f.lineString());
                                }
                            }
                            else {
                                // connecting 2 segments
                                f.appendFragment(g);
                                fragmentByEnd.set((f.end = g.end), f);
                            }
                        }
                        else {
                            // adding to the end of f
                            interpolate(end, threshold, f.append);
                            fragmentByEnd.set((f.end = endIndex), f);
                        }
                    }
                    else if ((f = fragmentByStart.get(endIndex))) {
                        fragmentByStart.delete(endIndex);
                        // extending the start of f
                        interpolate(start, threshold, f.prepend);
                        fragmentByStart.set((f.start = startIndex), f);
                    }
                    else {
                        // starting a new fragment
                        const newFrag = new Fragment(startIndex, endIndex);
                        interpolate(start, threshold, newFrag.append);
                        interpolate(end, threshold, newFrag.append);
                        fragmentByStart.set(startIndex, newFrag);
                        fragmentByEnd.set(endIndex, newFrag);
                    }
                }
            }
        }
    }
    for (const [level, fragmentByStart] of fragmentByStartByLevel.entries()) {
        let list = null;
        for (const value of fragmentByStart.values()) {
            if (!value.isEmpty()) {
                if (list == null) {
                    list = segments[level] || (segments[level] = []);
                }
                list.push(value.lineString());
            }
        }
    }
    return segments;
}

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/interpolation.ts
function linear(a, b, v) {
  if (a < b) return (v - a) / (b - a);
  return (a - v) / (a - b);
}
__name(linear, "linear");
function linear_ab(a, b, v0, v1) {
  if (v0 > v1) {
    [v0, v1] = [v1, v0];
  }
  if (a < b) {
    if (a < v0) return (v0 - a) / (b - a);
    else return (v1 - a) / (b - a);
  } else if (a > v1) {
    return (a - v1) / (a - b);
  }
  return (a - v0) / (a - b);
}
__name(linear_ab, "linear_ab");
function linear_a(a, b, minV, maxV) {
  if (a < b) return (minV - a) / (b - a);
  return (a - maxV) / (a - b);
}
__name(linear_a, "linear_a");
function linear_b(a, b, minV, maxV) {
  if (a < b) return (maxV - a) / (b - a);
  return (a - minV) / (a - b);
}
__name(linear_b, "linear_b");

// src/options.ts
var InternalOptions = class {
  static {
    __name(this, "InternalOptions");
  }
  /* Settings common to all implemented algorithms */
  successCallback;
  verbose = false;
  polygons = false;
  polygons_full = false;
  linearRing = true;
  noQuadTree = false;
  noFrame = false;
  threshold;
};
var IsoLineOptions = class extends InternalOptions {
  static {
    __name(this, "IsoLineOptions");
  }
  /* add interpolation functions (not yet user customizable) */
  interpolate = linear;
};
var IsoBandOptions = class extends InternalOptions {
  static {
    __name(this, "IsoBandOptions");
  }
  /* add interpolation functions (not yet user customizable) */
  interpolate = linear_ab;
  interpolate_a = linear_a;
  interpolate_b = linear_b;
  minV;
  maxV;
};
function isoBandOptions(userSettings) {
  const bandOptions = new IsoBandOptions();
  for (const key of Object.keys(bandOptions)) {
    const val = userSettings[key];
    if (typeof val !== "undefined" && val !== null) {
      bandOptions[key] = val;
    }
  }
  bandOptions.polygons_full = !bandOptions.polygons;
  bandOptions.interpolate = linear_ab;
  bandOptions.interpolate_a = linear_a;
  bandOptions.interpolate_b = linear_b;
  return bandOptions;
}
__name(isoBandOptions, "isoBandOptions");
function isoLineOptions(userSettings) {
  const lineOptions = new IsoLineOptions();
  for (const key of Object.keys(lineOptions)) {
    const val = userSettings[key];
    if (typeof val !== "undefined" && val !== null) {
      lineOptions[key] = val;
    }
  }
  lineOptions.polygons_full = !lineOptions.polygons;
  lineOptions.interpolate = linear;
  return lineOptions;
}
__name(isoLineOptions, "isoLineOptions");

// src/polygons.ts
function cell2Polygons(cell, x, y, settings) {
  const polygons = [];
  cell.polygons.forEach(function(p) {
    p.forEach(function(pp) {
      pp[0] += x;
      pp[1] += y;
    });
    if (settings.linearRing) p.push(p[0]);
    polygons.push(p);
  });
  return polygons;
}
__name(cell2Polygons, "cell2Polygons");
function entry_coordinate(x, y, mode, path) {
  if (mode === 0) {
    x += 1;
    y += path[0][1];
  } else if (mode === 1) {
    x += path[0][0];
  } else if (mode === 2) {
    y += path[0][1];
  } else if (mode === 3) {
    x += path[0][0];
    y += 1;
  }
  return [x, y];
}
__name(entry_coordinate, "entry_coordinate");
function skip_coordinate(x, y, mode) {
  if (mode === 0) {
    x++;
  } else if (mode === 1) ; else if (mode === 2) {
    y++;
  } else if (mode === 3) {
    x++;
    y++;
  }
  return [x, y];
}
__name(skip_coordinate, "skip_coordinate");
function requireFrame(data, lowerBound, upperBound) {
  let frameRequired = true;
  const cols = data[0].length;
  const rows = data.length;
  for (let j = 0; j < rows; j++) {
    if (data[j][0] < lowerBound || data[j][0] > upperBound || data[j][cols - 1] < lowerBound || data[j][cols - 1] > upperBound) {
      frameRequired = false;
      break;
    }
  }
  if (frameRequired && (data[rows - 1][0] < lowerBound || data[rows - 1][0] > upperBound || data[rows - 1][cols - 1] < lowerBound || data[rows - 1][cols - 1] > upperBound)) {
    frameRequired = false;
  }
  if (frameRequired)
    for (let i = 0; i < cols - 1; i++) {
      if (data[0][i] < lowerBound || data[0][i] > upperBound || data[rows - 1][i] < lowerBound || data[rows - 1][i] > upperBound) {
        frameRequired = false;
        break;
      }
    }
  return frameRequired;
}
__name(requireFrame, "requireFrame");
function requireLineFrame(data, threshold) {
  let frameRequired = true;
  const cols = data[0].length;
  const rows = data.length;
  for (let j = 0; j < rows; j++) {
    if (data[j][0] >= threshold || data[j][cols - 1] >= threshold) {
      frameRequired = false;
      break;
    }
  }
  if (frameRequired && (data[rows - 1][0] >= threshold || data[rows - 1][cols - 1] >= threshold)) {
    frameRequired = false;
  }
  if (frameRequired)
    for (let i = 0; i < cols - 1; i++) {
      if (data[0][i] >= threshold || data[rows - 1][i] > threshold) {
        frameRequired = false;
        break;
      }
    }
  return frameRequired;
}
__name(requireLineFrame, "requireLineFrame");
function traceBandPaths(data, cellGrid, settings) {
  const polygons = [];
  const rows = data.length - 1;
  const cols = data[0].length - 1;
  const valid_entries = [
    ["rt", "rb"],
    ["br", "bl"],
    ["lb", "lt"],
    ["tl", "tr"]
  ];
  const add_x = [0, -1, 0, 1];
  const add_y = [-1, 0, 1, 0];
  const available_starts = [
    "bl",
    "lb",
    "lt",
    "tl",
    "tr",
    "rt",
    "rb",
    "br"
  ];
  const entry_dir = {
    bl: 1,
    br: 1,
    lb: 2,
    lt: 2,
    tl: 3,
    tr: 3,
    rt: 0,
    rb: 0
  };
  if (requireFrame(data, settings.minV, settings.maxV)) {
    if (settings.linearRing)
      polygons.push([
        [0, 0],
        [0, rows],
        [cols, rows],
        [cols, 0],
        [0, 0]
      ]);
    else
      polygons.push([
        [0, 0],
        [0, rows],
        [cols, rows],
        [cols, 0]
      ]);
  }
  cellGrid.forEach(function(a, i) {
    a.forEach(function(cell, j) {
      for (let e = 0; e < 8; e++) {
        const nextedge = available_starts[e];
        if (typeof cell?.edges[nextedge] !== "object") continue;
        let ee = cell.edges[nextedge], enter = nextedge, x = i, y = j, finalized = false;
        const path = [], origin = [i + ee.path[0][0], j + ee.path[0][1]];
        path.push(origin);
        while (!finalized) {
          let cc = cellGrid[x][y];
          if (typeof cc?.edges[enter] !== "object") break;
          ee = cc.edges[enter];
          delete cc.edges[enter];
          const point = ee.path[1];
          point[0] += x;
          point[1] += y;
          path.push(point);
          enter = ee.move.enter;
          x = x + ee.move.x;
          y = y + ee.move.y;
          if (typeof cellGrid[x] === "undefined" || typeof cellGrid[x][y] === "undefined") {
            let dir = 0, count = 0;
            if (x === cols) {
              x--;
              dir = 0;
            } else if (x < 0) {
              x++;
              dir = 2;
            } else if (y === rows) {
              y--;
              dir = 3;
            } else if (y < 0) {
              y++;
              dir = 1;
            } else {
              throw new Error("Left the grid somewhere in the interior!");
            }
            if (x === i && y === j && dir === entry_dir[nextedge]) {
              finalized = true;
              enter = nextedge;
              break;
            }
            while (true) {
              let found_entry = false;
              if (count > 4)
                throw new Error(
                  "Direction change counter overflow! This should never happen!"
                );
              if (!(typeof cellGrid[x] === "undefined" || typeof cellGrid[x][y] === "undefined")) {
                cc = cellGrid[x][y];
                for (let s = 0; s < valid_entries[dir].length; s++) {
                  const ve = valid_entries[dir][s];
                  if (typeof cc?.edges[ve] === "object") {
                    ee = cc.edges[ve];
                    path.push(entry_coordinate(x, y, dir, ee.path));
                    enter = ve;
                    found_entry = true;
                    break;
                  }
                }
              }
              if (found_entry) {
                break;
              } else {
                path.push(skip_coordinate(x, y, dir));
                x += add_x[dir];
                y += add_y[dir];
                if (typeof cellGrid[x] === "undefined" || typeof cellGrid[x][y] === "undefined") {
                  if (dir === 0 && y < 0 || dir === 1 && x < 0 || dir === 2 && y === rows || dir === 3 && x === cols) {
                    x -= add_x[dir];
                    y -= add_y[dir];
                    dir = (dir + 1) % 4;
                    count++;
                  }
                }
                if (x === i && y === j && dir === entry_dir[nextedge]) {
                  finalized = true;
                  enter = nextedge;
                  break;
                }
              }
            }
          }
        }
        if (settings.linearRing && (path[path.length - 1][0] !== origin[0] || path[path.length - 1][1] !== origin[1]))
          path.push(origin);
        polygons.push(path);
      }
    });
  });
  return polygons;
}
__name(traceBandPaths, "traceBandPaths");
function traceLinePaths(data, cellGrid, settings) {
  const polygons = [];
  const rows = data.length - 1;
  const cols = data[0].length - 1;
  const valid_entries = [
    "right",
    "bottom",
    "left",
    "top"
  ];
  const add_x = [0, -1, 0, 1];
  const add_y = [-1, 0, 1, 0];
  const entry_dir = {
    bottom: 1,
    left: 2,
    top: 3,
    right: 0
  };
  if (!settings.noFrame) {
    if (requireLineFrame(data, settings.threshold)) {
      if (settings.linearRing) {
        polygons.push([
          [0, 0],
          [0, rows],
          [cols, rows],
          [cols, 0],
          [0, 0]
        ]);
      } else {
        polygons.push([
          [0, 0],
          [0, rows],
          [cols, rows],
          [cols, 0]
        ]);
      }
    }
  }
  cellGrid.forEach(function(a, i) {
    a.forEach(function(cell, j) {
      for (let e = 0; e < 4; e++) {
        const nextedge = valid_entries[e];
        if (typeof cell?.edges[nextedge] !== "object") continue;
        let ee = cell.edges[nextedge], enter = nextedge, x = i, y = j, finalized = false;
        const path = [], origin = [i + ee.path[0][0], j + ee.path[0][1]];
        path.push(origin);
        while (!finalized) {
          let cc = cellGrid[x][y];
          if (typeof cc?.edges[enter] !== "object") break;
          ee = cc.edges[enter];
          delete cc.edges[enter];
          const point = ee.path[1];
          point[0] += x;
          point[1] += y;
          path.push(point);
          enter = ee.move.enter;
          x = x + ee.move.x;
          y = y + ee.move.y;
          if (typeof cellGrid[x] === "undefined" || typeof cellGrid[x][y] === "undefined") {
            if (!settings.linearRing) break;
            let dir = 0, count = 0;
            if (x === cols) {
              x--;
              dir = 0;
            } else if (x < 0) {
              x++;
              dir = 2;
            } else if (y === rows) {
              y--;
              dir = 3;
            } else if (y < 0) {
              y++;
              dir = 1;
            }
            if (x === i && y === j && dir === entry_dir[nextedge]) {
              finalized = true;
              enter = nextedge;
              break;
            }
            while (true) {
              let found_entry = false;
              if (count > 4)
                throw new Error(
                  "Direction change counter overflow! This should never happen!"
                );
              if (!(typeof cellGrid[x] === "undefined" || typeof cellGrid[x][y] === "undefined")) {
                cc = cellGrid[x][y];
                const ve = valid_entries[dir];
                if (typeof cc?.edges[ve] === "object") {
                  ee = cc.edges[ve];
                  path.push(entry_coordinate(x, y, dir, ee.path));
                  enter = ve;
                  found_entry = true;
                  break;
                }
              }
              if (found_entry) {
                break;
              } else {
                path.push(skip_coordinate(x, y, dir));
                x += add_x[dir];
                y += add_y[dir];
                if (typeof cellGrid[x] === "undefined" || typeof cellGrid[x][y] === "undefined") {
                  if (dir === 0 && y < 0 || dir === 1 && x < 0 || dir === 2 && y === rows || dir === 3 && x === cols) {
                    x -= add_x[dir];
                    y -= add_y[dir];
                    dir = (dir + 1) % 4;
                    count++;
                  }
                }
                if (x === i && y === j && dir === entry_dir[nextedge]) {
                  finalized = true;
                  enter = nextedge;
                  break;
                }
              }
            }
          }
        }
        if (settings.linearRing && (path[path.length - 1][0] !== origin[0] || path[path.length - 1][1] !== origin[1]))
          path.push(origin);
        polygons.push(path);
      }
    });
  });
  return polygons;
}
__name(traceLinePaths, "traceLinePaths");

// src/quadtree.ts
var TreeNode = class _TreeNode {
  static {
    __name(this, "TreeNode");
  }
  lowerBound;
  upperBound;
  x;
  y;
  childA;
  childB;
  childC;
  childD;
  constructor(data, x, y, dx, dy) {
    let dx_tmp = dx, dy_tmp = dy, msb_x = 0, msb_y = 0;
    this.x = x;
    this.y = y;
    this.childA = null;
    this.childB = null;
    this.childC = null;
    this.childD = null;
    if (dx === 1 && dy === 1) {
      this.lowerBound = Math.min(
        data[y][x],
        data[y][x + 1],
        data[y + 1][x + 1],
        data[y + 1][x]
      );
      this.upperBound = Math.max(
        data[y][x],
        data[y][x + 1],
        data[y + 1][x + 1],
        data[y + 1][x]
      );
    } else {
      if (dx > 1) {
        while (dx_tmp !== 0) {
          dx_tmp = dx_tmp >> 1;
          msb_x++;
        }
        if (dx === 1 << msb_x - 1) msb_x--;
        dx_tmp = 1 << msb_x - 1;
      }
      if (dy > 1) {
        while (dy_tmp !== 0) {
          dy_tmp = dy_tmp >> 1;
          msb_y++;
        }
        if (dy === 1 << msb_y - 1) msb_y--;
        dy_tmp = 1 << msb_y - 1;
      }
      this.childA = new _TreeNode(data, x, y, dx_tmp, dy_tmp);
      this.lowerBound = this.childA.lowerBound;
      this.upperBound = this.childA.upperBound;
      if (dx - dx_tmp > 0) {
        this.childB = new _TreeNode(data, x + dx_tmp, y, dx - dx_tmp, dy_tmp);
        this.lowerBound = Math.min(this.lowerBound, this.childB.lowerBound);
        this.upperBound = Math.max(this.upperBound, this.childB.upperBound);
        if (dy - dy_tmp > 0) {
          this.childC = new _TreeNode(
            data,
            x + dx_tmp,
            y + dy_tmp,
            dx - dx_tmp,
            dy - dy_tmp
          );
          this.lowerBound = Math.min(this.lowerBound, this.childC.lowerBound);
          this.upperBound = Math.max(this.upperBound, this.childC.upperBound);
        }
      }
      if (dy - dy_tmp > 0) {
        this.childD = new _TreeNode(data, x, y + dy_tmp, dx_tmp, dy - dy_tmp);
        this.lowerBound = Math.min(this.lowerBound, this.childD.lowerBound);
        this.upperBound = Math.max(this.upperBound, this.childD.upperBound);
      }
    }
  }
  /**
   *  Retrieve a list of cells within a particular range of values by
   *  recursivly traversing the quad tree to it's leaves.
   *
   *  @param  subsumed  If 'true' include all cells that are completely
   *                    subsumed within the specified range. Otherwise,
   *                    return only cells where at least one corner is
   *                    outside the specified range.
   *
   *  @return   An array of objects 'o' where each object has exactly two
   *            properties: 'o.x' and 'o.y' denoting the left-bottom corner
   *            of the corresponding cell.
   */
  cellsInBand(lowerBound, upperBound, subsumed) {
    let cells = [];
    subsumed = typeof subsumed === "undefined" ? true : subsumed;
    if (this.lowerBound > upperBound || this.upperBound < lowerBound)
      return cells;
    if (!(this.childA || this.childB || this.childC || this.childD)) {
      if (subsumed || this.lowerBound <= lowerBound || this.upperBound >= upperBound) {
        cells.push({
          x: this.x,
          y: this.y
        });
      }
    } else {
      if (this.childA)
        cells = cells.concat(
          this.childA.cellsInBand(lowerBound, upperBound, subsumed)
        );
      if (this.childB)
        cells = cells.concat(
          this.childB.cellsInBand(lowerBound, upperBound, subsumed)
        );
      if (this.childD)
        cells = cells.concat(
          this.childD.cellsInBand(lowerBound, upperBound, subsumed)
        );
      if (this.childC)
        cells = cells.concat(
          this.childC.cellsInBand(lowerBound, upperBound, subsumed)
        );
    }
    return cells;
  }
  cellsBelowThreshold(threshold, subsumed) {
    let cells = [];
    subsumed = typeof subsumed === "undefined" ? true : subsumed;
    if (this.lowerBound > threshold) return cells;
    if (!(this.childA || this.childB || this.childC || this.childD)) {
      if (subsumed || this.upperBound >= threshold) {
        cells.push({
          x: this.x,
          y: this.y
        });
      }
    } else {
      if (this.childA)
        cells = cells.concat(
          this.childA.cellsBelowThreshold(threshold, subsumed)
        );
      if (this.childB)
        cells = cells.concat(
          this.childB.cellsBelowThreshold(threshold, subsumed)
        );
      if (this.childD)
        cells = cells.concat(
          this.childD.cellsBelowThreshold(threshold, subsumed)
        );
      if (this.childC)
        cells = cells.concat(
          this.childC.cellsBelowThreshold(threshold, subsumed)
        );
    }
    return cells;
  }
};
var QuadTree = class {
  static {
    __name(this, "QuadTree");
  }
  data;
  root;
  constructor(data) {
    if (!data) throw new Error("data is required");
    if (!Array.isArray(data) || !Array.isArray(data[0]))
      throw new Error("data must be scalar field, i.e. array of arrays");
    if (data.length < 2) throw new Error("data must contain at least two rows");
    const cols = data[0].length;
    if (cols < 2) throw new Error("data must contain at least two columns");
    for (let i = 1; i < data.length; i++) {
      if (!Array.isArray(data[i]))
        throw new Error("Row " + i + " is not an array");
      if (data[i].length != cols)
        throw new Error(
          "unequal row lengths detected, please provide a regular grid"
        );
    }
    this.data = data;
    this.root = new TreeNode(data, 0, 0, data[0].length - 1, data.length - 1);
  }
};

// src/isolines.ts
function isoLines(input, thresholds, options) {
  let settings, i, j, useQuadTree = false, tree = null, root = null, data, cellGrid = [], linePolygons, ret = [];
  options = options ?? {};
  if (!!options && typeof options !== "object")
    throw new Error("options must be an object");
  settings = isoLineOptions(options);
  if (!input) throw new Error("data is required");
  if (input instanceof QuadTree) {
    tree = input;
    root = input.root;
    data = input.data;
    if (!settings.noQuadTree) useQuadTree = true;
  } else if (Array.isArray(input) && Array.isArray(input[0])) {
    data = input;
  } else {
    throw new Error(
      "input is neither array of arrays nor object retrieved from 'QuadTree()'"
    );
  }
  if (thresholds === void 0 || thresholds === null)
    throw new Error("thresholds is required");
  if (!Array.isArray(thresholds))
    throw new Error("thresholds must be an array");
  if (!settings.noQuadTree) useQuadTree = true;
  for (i = 0; i < thresholds.length; i++)
    if (isNaN(+thresholds[i]))
      throw new Error("thresholds[" + i + "] is not a number");
  if (useQuadTree && !root) {
    tree = new QuadTree(data);
    root = tree.root;
    data = tree.data;
  }
  if (settings.verbose) {
    if (settings.polygons)
      console.log(
        "isoLines: returning single lines (polygons) for each grid cell"
      );
    else
      console.log(
        "isoLines: returning line paths (polygons) for entire data grid"
      );
  }
  thresholds.forEach(function(t, i2) {
    linePolygons = [];
    settings.threshold = t;
    if (settings.verbose)
      console.log(
        "MarchingSquaresJS-isoLines: computing iso lines for threshold " + t
      );
    if (settings.polygons) {
      if (useQuadTree) {
        root.cellsBelowThreshold(settings.threshold, true).forEach(function(c) {
          const cell = prepareCell(data, c.x, c.y, settings);
          if (cell) {
            linePolygons = linePolygons.concat(
              cell2Polygons(cell, c.x, c.y, settings)
            );
          }
        });
      } else {
        for (j = 0; j < data.length - 1; ++j) {
          for (i2 = 0; i2 < data[0].length - 1; ++i2) {
            const cell = prepareCell(data, i2, j, settings);
            if (cell) {
              linePolygons = linePolygons.concat(
                cell2Polygons(cell, i2, j, settings)
              );
            }
          }
        }
      }
    } else {
      cellGrid = [];
      for (i2 = 0; i2 < data[0].length - 1; ++i2) cellGrid[i2] = [];
      if (useQuadTree) {
        root.cellsBelowThreshold(settings.threshold, false).forEach(function(c) {
          cellGrid[c.x][c.y] = prepareCell(data, c.x, c.y, settings);
        });
      } else {
        for (i2 = 0; i2 < data[0].length - 1; ++i2) {
          for (j = 0; j < data.length - 1; ++j) {
            cellGrid[i2][j] = prepareCell(data, i2, j, settings);
          }
        }
      }
      linePolygons = traceLinePaths(data, cellGrid, settings);
    }
    ret.push(linePolygons);
    if (typeof settings.successCallback === "function") {
      settings.successCallback(ret, t);
    }
  });
  return ret;
}
__name(isoLines, "isoLines");
function prepareCell(grid, x, y, settings) {
  let cval = 0;
  const x3 = grid[y + 1][x], x2 = grid[y + 1][x + 1], x1 = grid[y][x + 1], x0 = grid[y][x], threshold = settings.threshold;
  if (isNaN(x0) || isNaN(x1) || isNaN(x2) || isNaN(x3)) {
    return;
  }
  cval |= x3 >= threshold ? 8 : 0;
  cval |= x2 >= threshold ? 4 : 0;
  cval |= x1 >= threshold ? 2 : 0;
  cval |= x0 >= threshold ? 1 : 0;
  cval = +cval;
  const cell = {
    cval,
    polygons: [],
    edges: {},
    x0,
    x1,
    x2,
    x3
  };
  let left, right, top, bottom, average;
  switch (cval) {
    case 0:
      if (settings.polygons)
        cell.polygons.push([
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0]
        ]);
      break;
    case 15:
      break;
    case 14:
      left = settings.interpolate(x0, x3, threshold);
      bottom = settings.interpolate(x0, x1, threshold);
      if (settings.polygons_full) {
        cell.edges.left = {
          path: [
            [0, left],
            [bottom, 0]
          ],
          move: {
            x: 0,
            y: -1,
            enter: "top"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [0, 0],
          [0, left],
          [bottom, 0]
        ]);
      break;
    case 13:
      bottom = settings.interpolate(x0, x1, threshold);
      right = settings.interpolate(x1, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.bottom = {
          path: [
            [bottom, 0],
            [1, right]
          ],
          move: {
            x: 1,
            y: 0,
            enter: "left"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [bottom, 0],
          [1, right],
          [1, 0]
        ]);
      break;
    case 11:
      right = settings.interpolate(x1, x2, threshold);
      top = settings.interpolate(x3, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.right = {
          path: [
            [1, right],
            [top, 1]
          ],
          move: {
            x: 0,
            y: 1,
            enter: "bottom"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [1, right],
          [top, 1],
          [1, 1]
        ]);
      break;
    case 7:
      left = settings.interpolate(x0, x3, threshold);
      top = settings.interpolate(x3, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.top = {
          path: [
            [top, 1],
            [0, left]
          ],
          move: {
            x: -1,
            y: 0,
            enter: "right"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [top, 1],
          [0, left],
          [0, 1]
        ]);
      break;
    case 1:
      left = settings.interpolate(x0, x3, threshold);
      bottom = settings.interpolate(x0, x1, threshold);
      if (settings.polygons_full) {
        cell.edges.bottom = {
          path: [
            [bottom, 0],
            [0, left]
          ],
          move: {
            x: -1,
            y: 0,
            enter: "right"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [bottom, 0],
          [0, left],
          [0, 1],
          [1, 1],
          [1, 0]
        ]);
      break;
    case 2:
      bottom = settings.interpolate(x0, x1, threshold);
      right = settings.interpolate(x1, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.right = {
          path: [
            [1, right],
            [bottom, 0]
          ],
          move: {
            x: 0,
            y: -1,
            enter: "top"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [0, 0],
          [0, 1],
          [1, 1],
          [1, right],
          [bottom, 0]
        ]);
      break;
    case 4:
      right = settings.interpolate(x1, x2, threshold);
      top = settings.interpolate(x3, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.top = {
          path: [
            [top, 1],
            [1, right]
          ],
          move: {
            x: 1,
            y: 0,
            enter: "left"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [0, 0],
          [0, 1],
          [top, 1],
          [1, right],
          [1, 0]
        ]);
      break;
    case 8:
      left = settings.interpolate(x0, x3, threshold);
      top = settings.interpolate(x3, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.left = {
          path: [
            [0, left],
            [top, 1]
          ],
          move: {
            x: 0,
            y: 1,
            enter: "bottom"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [0, 0],
          [0, left],
          [top, 1],
          [1, 1],
          [1, 0]
        ]);
      break;
    case 12:
      left = settings.interpolate(x0, x3, threshold);
      right = settings.interpolate(x1, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.left = {
          path: [
            [0, left],
            [1, right]
          ],
          move: {
            x: 1,
            y: 0,
            enter: "left"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [0, 0],
          [0, left],
          [1, right],
          [1, 0]
        ]);
      break;
    case 9:
      bottom = settings.interpolate(x0, x1, threshold);
      top = settings.interpolate(x3, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.bottom = {
          path: [
            [bottom, 0],
            [top, 1]
          ],
          move: {
            x: 0,
            y: 1,
            enter: "bottom"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [bottom, 0],
          [top, 1],
          [1, 1],
          [1, 0]
        ]);
      break;
    case 3:
      left = settings.interpolate(x0, x3, threshold);
      right = settings.interpolate(x1, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.right = {
          path: [
            [1, right],
            [0, left]
          ],
          move: {
            x: -1,
            y: 0,
            enter: "right"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [0, left],
          [0, 1],
          [1, 1],
          [1, right]
        ]);
      break;
    case 6:
      bottom = settings.interpolate(x0, x1, threshold);
      top = settings.interpolate(x3, x2, threshold);
      if (settings.polygons_full) {
        cell.edges.top = {
          path: [
            [top, 1],
            [bottom, 0]
          ],
          move: {
            x: 0,
            y: -1,
            enter: "top"
          }
        };
      }
      if (settings.polygons)
        cell.polygons.push([
          [0, 0],
          [0, 1],
          [top, 1],
          [bottom, 0]
        ]);
      break;
    case 10:
      left = settings.interpolate(x0, x3, threshold);
      right = settings.interpolate(x1, x2, threshold);
      bottom = settings.interpolate(x0, x1, threshold);
      top = settings.interpolate(x3, x2, threshold);
      average = (x0 + x1 + x2 + x3) / 4;
      if (settings.polygons_full) {
        if (average < threshold) {
          cell.edges.left = {
            path: [
              [0, left],
              [top, 1]
            ],
            move: {
              x: 0,
              y: 1,
              enter: "bottom"
            }
          };
          cell.edges.right = {
            path: [
              [1, right],
              [bottom, 0]
            ],
            move: {
              x: 0,
              y: -1,
              enter: "top"
            }
          };
        } else {
          cell.edges.right = {
            path: [
              [1, right],
              [top, 1]
            ],
            move: {
              x: 0,
              y: 1,
              enter: "bottom"
            }
          };
          cell.edges.left = {
            path: [
              [0, left],
              [bottom, 0]
            ],
            move: {
              x: 0,
              y: -1,
              enter: "top"
            }
          };
        }
      }
      if (settings.polygons) {
        if (average < threshold) {
          cell.polygons.push([
            [0, 0],
            [0, left],
            [top, 1],
            [1, 1],
            [1, right],
            [bottom, 0]
          ]);
        } else {
          cell.polygons.push([
            [0, 0],
            [0, left],
            [bottom, 0]
          ]);
          cell.polygons.push([
            [top, 1],
            [1, 1],
            [1, right]
          ]);
        }
      }
      break;
    case 5:
      left = settings.interpolate(x0, x3, threshold);
      right = settings.interpolate(x1, x2, threshold);
      bottom = settings.interpolate(x0, x1, threshold);
      top = settings.interpolate(x3, x2, threshold);
      average = (x0 + x1 + x2 + x3) / 4;
      if (settings.polygons_full) {
        if (average < threshold) {
          cell.edges.bottom = {
            path: [
              [bottom, 0],
              [0, left]
            ],
            move: {
              x: -1,
              y: 0,
              enter: "right"
            }
          };
          cell.edges.top = {
            path: [
              [top, 1],
              [1, right]
            ],
            move: {
              x: 1,
              y: 0,
              enter: "left"
            }
          };
        } else {
          cell.edges.top = {
            path: [
              [top, 1],
              [0, left]
            ],
            move: {
              x: -1,
              y: 0,
              enter: "right"
            }
          };
          cell.edges.bottom = {
            path: [
              [bottom, 0],
              [1, right]
            ],
            move: {
              x: 1,
              y: 0,
              enter: "left"
            }
          };
        }
      }
      if (settings.polygons) {
        if (average < threshold) {
          cell.polygons.push([
            [0, left],
            [0, 1],
            [top, 1],
            [1, right],
            [1, 0],
            [bottom, 0]
          ]);
        } else {
          cell.polygons.push([
            [0, left],
            [0, 1],
            [top, 1]
          ]);
          cell.polygons.push([
            [bottom, 0],
            [1, right],
            [1, 0]
          ]);
        }
      }
      break;
  }
  return cell;
}
__name(prepareCell, "prepareCell");

// src/isobands.ts
var shapeCoordinates = {
  square: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0]
      ]);
  }, "square"),
  triangle_bl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lb = {
        path: [
          [0, leftbottom],
          [bottomleft, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, leftbottom],
        [bottomleft, 0],
        [0, 0]
      ]);
  }, "triangle_bl"),
  triangle_br: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomright = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.br = {
        path: [
          [bottomright, 0],
          [1, rightbottom]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomright, 0],
        [1, rightbottom],
        [1, 0]
      ]);
  }, "triangle_br"),
  triangle_tr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const righttop = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.rt = {
        path: [
          [1, righttop],
          [topright, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "br"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [1, righttop],
        [topright, 1],
        [1, 1]
      ]);
  }, "triangle_tr"),
  triangle_tl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const topleft = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const lefttop = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.tl = {
        path: [
          [topleft, 1],
          [0, lefttop]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rt"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, lefttop],
        [0, 1],
        [topleft, 1]
      ]);
  }, "triangle_tl"),
  tetragon_t: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const righttop = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    const lefttop = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.rt = {
        path: [
          [1, righttop],
          [0, lefttop]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rt"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, lefttop],
        [0, 1],
        [1, 1],
        [1, righttop]
      ]);
  }, "tetragon_t"),
  tetragon_r: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomright = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const topright = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.br = {
        path: [
          [bottomright, 0],
          [topright, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "br"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomright, 0],
        [topright, 1],
        [1, 1],
        [1, 0]
      ]);
  }, "tetragon_r"),
  tetragon_b: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const leftbottom = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lb = {
        path: [
          [0, leftbottom],
          [1, rightbottom]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, leftbottom],
        [1, rightbottom],
        [1, 0]
      ]);
  }, "tetragon_b"),
  tetragon_l: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const topleft = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const bottomleft = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.tl = {
        path: [
          [topleft, 1],
          [bottomleft, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, 1],
        [topleft, 1],
        [bottomleft, 0]
      ]);
  }, "tetragon_l"),
  tetragon_bl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomleft, 0],
        [0, leftbottom],
        [0, lefttop],
        [bottomright, 0]
      ]);
  }, "tetragon_bl"),
  tetragon_br: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomleft, 0],
        [1, righttop],
        [1, rightbottom],
        [bottomright, 0]
      ]);
  }, "tetragon_br"),
  tetragon_tr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
      cell.edges.tr = {
        path: [
          [topright, 1],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [1, rightbottom],
        [topleft, 1],
        [topright, 1],
        [1, righttop]
      ]);
  }, "tetragon_tr"),
  tetragon_tl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.tr = {
        path: [
          [topright, 1],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [topright, 1],
        [0, leftbottom],
        [0, lefttop],
        [topleft, 1]
      ]);
  }, "tetragon_tl"),
  tetragon_lr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, leftbottom],
        [0, lefttop],
        [1, righttop],
        [1, rightbottom]
      ]);
  }, "tetragon_lr"),
  tetragon_tb: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.tr = {
        path: [
          [topright, 1],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomleft, 0],
        [topleft, 1],
        [topright, 1],
        [bottomright, 0]
      ]);
  }, "tetragon_tb"),
  pentagon_tr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const topleft = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.tl = {
        path: [
          [topleft, 1],
          [1, rightbottom]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, 1],
        [topleft, 1],
        [1, rightbottom],
        [1, 0]
      ]);
  }, "pentagon_tr"),
  pentagon_tl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const leftbottom = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topright = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lb = {
        path: [
          [0, leftbottom],
          [topright, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "br"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, leftbottom],
        [topright, 1],
        [1, 1],
        [1, 0]
      ]);
  }, "pentagon_tl"),
  pentagon_br: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const righttop = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.rt = {
        path: [
          [1, righttop],
          [bottomleft, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, 1],
        [1, 1],
        [1, righttop],
        [bottomleft, 0]
      ]);
  }, "pentagon_br"),
  pentagon_bl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const lefttop = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const bottomright = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.br = {
        path: [
          [bottomright, 0],
          [0, lefttop]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rt"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, lefttop],
        [0, 1],
        [1, 1],
        [1, 0],
        [bottomright, 0]
      ]);
  }, "pentagon_bl"),
  pentagon_tr_rl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const lefttop = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.tl = {
        path: [
          [topleft, 1],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [0, lefttop]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rt"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, lefttop],
        [0, 1],
        [topleft, 1],
        [1, righttop],
        [1, rightbottom]
      ]);
  }, "pentagon_tr_rl"),
  pentagon_rb_bt: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const righttop = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    const topright = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.rt = {
        path: [
          [1, righttop],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [topright, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "br"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [topright, 1],
        [1, 1],
        [1, righttop],
        [bottomright, 0],
        [bottomleft, 0]
      ]);
  }, "pentagon_rb_bt"),
  pentagon_bl_lr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomright = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.br = {
        path: [
          [bottomright, 0],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [1, rightbottom]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomright, 0],
        [0, leftbottom],
        [0, lefttop],
        [1, rightbottom],
        [1, 0]
      ]);
  }, "pentagon_bl_lr"),
  pentagon_lt_tb: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const leftbottom = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const bottomleft = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lb = {
        path: [
          [0, leftbottom],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
      cell.edges.tr = {
        path: [
          [topright, 1],
          [bottomleft, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, leftbottom],
        [topleft, 1],
        [topright, 1],
        [bottomleft, 0]
      ]);
  }, "pentagon_lt_tb"),
  pentagon_bl_tb: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const lefttop = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [0, lefttop]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rt"
        }
      };
      cell.edges.tl = {
        path: [
          [topleft, 1],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, lefttop],
        [0, 1],
        [topleft, 1],
        [bottomright, 0],
        [bottomleft, 0]
      ]);
  }, "pentagon_bl_tb"),
  pentagon_lt_rl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    const topright = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate(x1, x3, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [topright, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "br"
        }
      };
      cell.edges.rt = {
        path: [
          [1, righttop],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, leftbottom],
        [0, lefttop],
        [topright, 1],
        [1, 1],
        [1, righttop]
      ]);
  }, "pentagon_lt_rl"),
  pentagon_tr_bt: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    const bottomright = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.br = {
        path: [
          [bottomright, 0],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
      cell.edges.tr = {
        path: [
          [topright, 1],
          [1, rightbottom]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [topleft, 1],
        [topright, 1],
        [1, rightbottom],
        [1, 0],
        [bottomright, 0]
      ]);
  }, "pentagon_tr_bt"),
  pentagon_rb_lr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const leftbottom = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    const bottomleft = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lb = {
        path: [
          [0, leftbottom],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [bottomleft, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, leftbottom],
        [1, righttop],
        [1, rightbottom],
        [bottomleft, 0]
      ]);
  }, "pentagon_rb_lr"),
  hexagon_lt_tr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const leftbottom = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lb = {
        path: [
          [0, leftbottom],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
      cell.edges.tr = {
        path: [
          [topright, 1],
          [1, rightbottom]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, leftbottom],
        [topleft, 1],
        [topright, 1],
        [1, rightbottom],
        [1, 0]
      ]);
  }, "hexagon_lt_tr"),
  hexagon_bl_lt: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomright = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    const topright = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.br = {
        path: [
          [bottomright, 0],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [topright, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "br"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomright, 0],
        [0, leftbottom],
        [0, lefttop],
        [topright, 1],
        [1, 1],
        [1, 0]
      ]);
  }, "hexagon_bl_lt"),
  hexagon_bl_rb: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const lefttop = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const righttop = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [0, lefttop]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rt"
        }
      };
      cell.edges.rt = {
        path: [
          [1, righttop],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomleft, 0],
        [0, lefttop],
        [0, 1],
        [1, 1],
        [1, righttop],
        [bottomright, 0]
      ]);
  }, "hexagon_bl_rb"),
  hexagon_tr_rb: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const topleft = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.tl = {
        path: [
          [topleft, 1],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [bottomleft, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, 1],
        [topleft, 1],
        [1, righttop],
        [1, rightbottom],
        [bottomleft, 0]
      ]);
  }, "hexagon_tr_rb"),
  hexagon_lt_rb: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const leftbottom = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topright = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    const bottomleft = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lb = {
        path: [
          [0, leftbottom],
          [topright, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "br"
        }
      };
      cell.edges.rt = {
        path: [
          [1, righttop],
          [bottomleft, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, leftbottom],
        [topright, 1],
        [1, 1],
        [1, righttop],
        [bottomleft, 0]
      ]);
  }, "hexagon_lt_rb"),
  hexagon_bl_tr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomright = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const lefttop = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.br = {
        path: [
          [bottomright, 0],
          [0, lefttop]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rt"
        }
      };
      cell.edges.tl = {
        path: [
          [topleft, 1],
          [1, rightbottom]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomright, 0],
        [0, lefttop],
        [0, 1],
        [topleft, 1],
        [1, rightbottom],
        [1, 0]
      ]);
  }, "hexagon_bl_tr"),
  heptagon_tr: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    const topright = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [topright, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "br"
        }
      };
      cell.edges.rt = {
        path: [
          [1, righttop],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomleft, 0],
        [0, leftbottom],
        [0, lefttop],
        [topright, 1],
        [1, 1],
        [1, righttop],
        [bottomright, 0]
      ]);
  }, "heptagon_tr"),
  heptagon_bl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.lb = {
        path: [
          [0, leftbottom],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
      cell.edges.tr = {
        path: [
          [topright, 1],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [bottomleft, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tl"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [0, 0],
        [0, leftbottom],
        [topleft, 1],
        [topright, 1],
        [1, righttop],
        [1, rightbottom],
        [bottomleft, 0]
      ]);
  }, "heptagon_bl"),
  heptagon_tl: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const lefttop = opt.interpolate(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [0, lefttop]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rt"
        }
      };
      cell.edges.tl = {
        path: [
          [topleft, 1],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomleft, 0],
        [0, lefttop],
        [0, 1],
        [topleft, 1],
        [1, righttop],
        [1, rightbottom],
        [bottomright, 0]
      ]);
  }, "heptagon_tl"),
  heptagon_br: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomright = opt.interpolate(x0, x1, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.br = {
        path: [
          [bottomright, 0],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
      cell.edges.tr = {
        path: [
          [topright, 1],
          [1, rightbottom]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lb"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomright, 0],
        [0, leftbottom],
        [0, lefttop],
        [topleft, 1],
        [topright, 1],
        [1, rightbottom],
        [1, 0]
      ]);
  }, "heptagon_br"),
  octagon: /* @__PURE__ */ __name(function(cell, x0, x1, x2, x3, opt) {
    const bottomleft = opt.interpolate_a(x0, x1, opt.minV, opt.maxV);
    const bottomright = opt.interpolate_b(x0, x1, opt.minV, opt.maxV);
    const leftbottom = opt.interpolate_a(x0, x3, opt.minV, opt.maxV);
    const lefttop = opt.interpolate_b(x0, x3, opt.minV, opt.maxV);
    const topleft = opt.interpolate_a(x3, x2, opt.minV, opt.maxV);
    const topright = opt.interpolate_b(x3, x2, opt.minV, opt.maxV);
    const righttop = opt.interpolate_b(x1, x2, opt.minV, opt.maxV);
    const rightbottom = opt.interpolate_a(x1, x2, opt.minV, opt.maxV);
    if (opt.polygons_full) {
      cell.edges.bl = {
        path: [
          [bottomleft, 0],
          [0, leftbottom]
        ],
        move: {
          x: -1,
          y: 0,
          enter: "rb"
        }
      };
      cell.edges.lt = {
        path: [
          [0, lefttop],
          [topleft, 1]
        ],
        move: {
          x: 0,
          y: 1,
          enter: "bl"
        }
      };
      cell.edges.tr = {
        path: [
          [topright, 1],
          [1, righttop]
        ],
        move: {
          x: 1,
          y: 0,
          enter: "lt"
        }
      };
      cell.edges.rb = {
        path: [
          [1, rightbottom],
          [bottomright, 0]
        ],
        move: {
          x: 0,
          y: -1,
          enter: "tr"
        }
      };
    }
    if (opt.polygons)
      cell.polygons.push([
        [bottomleft, 0],
        [0, leftbottom],
        [0, lefttop],
        [topleft, 1],
        [topright, 1],
        [1, righttop],
        [1, rightbottom],
        [bottomright, 0]
      ]);
  }, "octagon")
};
function isoBands(input, thresholds, bandwidths, options) {
  let i, j, settings, useQuadTree = false, tree = null, root = null, data = null, cellGrid = [], bandPolygons, ret = [];
  options = options ?? {};
  if (!!options && typeof options !== "object")
    throw new Error("options must be an object");
  settings = isoBandOptions(options);
  if (!input) throw new Error("data is required");
  if (input instanceof QuadTree) {
    tree = input;
    root = input.root;
    data = input.data;
    if (!settings.noQuadTree) useQuadTree = true;
  } else if (Array.isArray(input) && Array.isArray(input[0])) {
    data = input;
  } else {
    throw new Error(
      "input is neither array of arrays nor object retrieved from 'QuadTree()'"
    );
  }
  if (thresholds === void 0 || thresholds === null)
    throw new Error("thresholds is required");
  if (!Array.isArray(thresholds))
    throw new Error("thresholds must be an array");
  if (bandwidths === void 0 || bandwidths === null)
    throw new Error("bandwidths is required");
  if (!Array.isArray(bandwidths))
    throw new Error("bandwidths must be an array");
  if (!settings.noQuadTree) useQuadTree = true;
  for (i = 0; i < thresholds.length; i++)
    if (isNaN(+thresholds[i]))
      throw new Error("thresholds[" + i + "] is not a number");
  if (thresholds.length !== bandwidths.length)
    throw new Error("threshold and bandwidth arrays have unequal lengths");
  for (i = 0; i < bandwidths.length; i++)
    if (isNaN(+bandwidths[i]))
      throw new Error("bandwidths[" + i + "] is not a number");
  if (useQuadTree && !root) {
    tree = new QuadTree(data);
    root = tree.root;
    data = tree.data;
  }
  if (settings.verbose) {
    if (settings.polygons)
      console.log("isoBands: returning single polygons for each grid cell");
    else console.log("isoBands: returning polygon paths for entire data grid");
  }
  thresholds.forEach(function(lowerBound, b) {
    bandPolygons = [];
    settings.minV = lowerBound;
    settings.maxV = lowerBound + bandwidths[b];
    if (settings.verbose)
      console.log(
        "isoBands: computing isobands for [" + lowerBound + ":" + (lowerBound + bandwidths[b]) + "]"
      );
    if (settings.polygons) {
      if (useQuadTree) {
        root.cellsInBand(settings.minV, settings.maxV, true).forEach(function(c) {
          const cell = prepareCell2(data, c.x, c.y, settings);
          if (cell) {
            bandPolygons = bandPolygons.concat(
              cell2Polygons(cell, c.x, c.y, settings)
            );
          }
        });
      } else {
        for (j = 0; j < data.length - 1; ++j) {
          for (i = 0; i < data[0].length - 1; ++i) {
            const cell = prepareCell2(data, i, j, settings);
            if (cell) {
              bandPolygons = bandPolygons.concat(
                cell2Polygons(cell, i, j, settings)
              );
            }
          }
        }
      }
    } else {
      cellGrid = [];
      for (i = 0; i < data[0].length - 1; ++i) cellGrid[i] = [];
      if (useQuadTree) {
        root.cellsInBand(settings.minV, settings.maxV, false).forEach(function(c) {
          cellGrid[c.x][c.y] = prepareCell2(data, c.x, c.y, settings);
        });
      } else {
        for (i = 0; i < data[0].length - 1; ++i) {
          for (j = 0; j < data.length - 1; ++j) {
            cellGrid[i][j] = prepareCell2(data, i, j, settings);
          }
        }
      }
      bandPolygons = traceBandPaths(data, cellGrid, settings);
    }
    ret.push(bandPolygons);
    if (typeof settings.successCallback === "function")
      settings.successCallback(ret, lowerBound, bandwidths[b]);
  });
  return ret;
}
__name(isoBands, "isoBands");
function computeCenterAverage(bl, br, tr, tl, minV, maxV) {
  const average = (tl + tr + br + bl) / 4;
  if (average > maxV) return 2;
  if (average < minV) return 0;
  return 1;
}
__name(computeCenterAverage, "computeCenterAverage");
function prepareCell2(grid, x, y, opt) {
  let cval = 0;
  const x3 = grid[y + 1][x], x2 = grid[y + 1][x + 1], x1 = grid[y][x + 1], x0 = grid[y][x], minV = opt.minV, maxV = opt.maxV;
  if (isNaN(x0) || isNaN(x1) || isNaN(x2) || isNaN(x3)) {
    return;
  }
  cval |= x3 < minV ? 0 : x3 > maxV ? 128 : 64;
  cval |= x2 < minV ? 0 : x2 > maxV ? 32 : 16;
  cval |= x1 < minV ? 0 : x1 > maxV ? 8 : 4;
  cval |= x0 < minV ? 0 : x0 > maxV ? 2 : 1;
  cval = +cval;
  let center_avg = 0;
  let cell = {
    cval,
    polygons: [],
    edges: {},
    x0,
    x1,
    x2,
    x3,
    x,
    y
  };
  switch (cval) {
    case 85:
      shapeCoordinates.square(cell, x0, x1, x2, x3, opt);
    /* fall through */
    case 0:
    /* 0000 */
    /* fall through */
    case 170:
      break;
    /* single triangle cases */
    case 169:
      shapeCoordinates.triangle_bl(cell, x0, x1, x2, x3, opt);
      break;
    case 166:
      shapeCoordinates.triangle_br(cell, x0, x1, x2, x3, opt);
      break;
    case 154:
      shapeCoordinates.triangle_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 106:
      shapeCoordinates.triangle_tl(cell, x0, x1, x2, x3, opt);
      break;
    case 1:
      shapeCoordinates.triangle_bl(cell, x0, x1, x2, x3, opt);
      break;
    case 4:
      shapeCoordinates.triangle_br(cell, x0, x1, x2, x3, opt);
      break;
    case 16:
      shapeCoordinates.triangle_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 64:
      shapeCoordinates.triangle_tl(cell, x0, x1, x2, x3, opt);
      break;
    /* single trapezoid cases */
    case 168:
      shapeCoordinates.tetragon_bl(cell, x0, x1, x2, x3, opt);
      break;
    case 162:
      shapeCoordinates.tetragon_br(cell, x0, x1, x2, x3, opt);
      break;
    case 138:
      shapeCoordinates.tetragon_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 42:
      shapeCoordinates.tetragon_tl(cell, x0, x1, x2, x3, opt);
      break;
    case 2:
      shapeCoordinates.tetragon_bl(cell, x0, x1, x2, x3, opt);
      break;
    case 8:
      shapeCoordinates.tetragon_br(cell, x0, x1, x2, x3, opt);
      break;
    case 32:
      shapeCoordinates.tetragon_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 128:
      shapeCoordinates.tetragon_tl(cell, x0, x1, x2, x3, opt);
      break;
    /* single rectangle cases */
    case 5:
      shapeCoordinates.tetragon_b(cell, x0, x1, x2, x3, opt);
      break;
    case 20:
      shapeCoordinates.tetragon_r(cell, x0, x1, x2, x3, opt);
      break;
    case 80:
      shapeCoordinates.tetragon_t(cell, x0, x1, x2, x3, opt);
      break;
    case 65:
      shapeCoordinates.tetragon_l(cell, x0, x1, x2, x3, opt);
      break;
    case 165:
      shapeCoordinates.tetragon_b(cell, x0, x1, x2, x3, opt);
      break;
    case 150:
      shapeCoordinates.tetragon_r(cell, x0, x1, x2, x3, opt);
      break;
    case 90:
      shapeCoordinates.tetragon_t(cell, x0, x1, x2, x3, opt);
      break;
    case 105:
      shapeCoordinates.tetragon_l(cell, x0, x1, x2, x3, opt);
      break;
    case 160:
      shapeCoordinates.tetragon_lr(cell, x0, x1, x2, x3, opt);
      break;
    case 130:
      shapeCoordinates.tetragon_tb(cell, x0, x1, x2, x3, opt);
      break;
    case 10:
      shapeCoordinates.tetragon_lr(cell, x0, x1, x2, x3, opt);
      break;
    case 40:
      shapeCoordinates.tetragon_tb(cell, x0, x1, x2, x3, opt);
      break;
    /* single pentagon cases */
    case 101:
      shapeCoordinates.pentagon_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 149:
      shapeCoordinates.pentagon_tl(cell, x0, x1, x2, x3, opt);
      break;
    case 86:
      shapeCoordinates.pentagon_bl(cell, x0, x1, x2, x3, opt);
      break;
    case 89:
      shapeCoordinates.pentagon_br(cell, x0, x1, x2, x3, opt);
      break;
    case 69:
      shapeCoordinates.pentagon_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 21:
      shapeCoordinates.pentagon_tl(cell, x0, x1, x2, x3, opt);
      break;
    case 84:
      shapeCoordinates.pentagon_bl(cell, x0, x1, x2, x3, opt);
      break;
    case 81:
      shapeCoordinates.pentagon_br(cell, x0, x1, x2, x3, opt);
      break;
    case 96:
      shapeCoordinates.pentagon_tr_rl(cell, x0, x1, x2, x3, opt);
      break;
    case 24:
      shapeCoordinates.pentagon_rb_bt(cell, x0, x1, x2, x3, opt);
      break;
    case 6:
      shapeCoordinates.pentagon_bl_lr(cell, x0, x1, x2, x3, opt);
      break;
    case 129:
      shapeCoordinates.pentagon_lt_tb(cell, x0, x1, x2, x3, opt);
      break;
    case 74:
      shapeCoordinates.pentagon_tr_rl(cell, x0, x1, x2, x3, opt);
      break;
    case 146:
      shapeCoordinates.pentagon_rb_bt(cell, x0, x1, x2, x3, opt);
      break;
    case 164:
      shapeCoordinates.pentagon_bl_lr(cell, x0, x1, x2, x3, opt);
      break;
    case 41:
      shapeCoordinates.pentagon_lt_tb(cell, x0, x1, x2, x3, opt);
      break;
    case 66:
      shapeCoordinates.pentagon_bl_tb(cell, x0, x1, x2, x3, opt);
      break;
    case 144:
      shapeCoordinates.pentagon_lt_rl(cell, x0, x1, x2, x3, opt);
      break;
    case 36:
      shapeCoordinates.pentagon_tr_bt(cell, x0, x1, x2, x3, opt);
      break;
    case 9:
      shapeCoordinates.pentagon_rb_lr(cell, x0, x1, x2, x3, opt);
      break;
    case 104:
      shapeCoordinates.pentagon_bl_tb(cell, x0, x1, x2, x3, opt);
      break;
    case 26:
      shapeCoordinates.pentagon_lt_rl(cell, x0, x1, x2, x3, opt);
      break;
    case 134:
      shapeCoordinates.pentagon_tr_bt(cell, x0, x1, x2, x3, opt);
      break;
    case 161:
      shapeCoordinates.pentagon_rb_lr(cell, x0, x1, x2, x3, opt);
      break;
    /* single hexagon cases */
    case 37:
      shapeCoordinates.hexagon_lt_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 148:
      shapeCoordinates.hexagon_bl_lt(cell, x0, x1, x2, x3, opt);
      break;
    case 82:
      shapeCoordinates.hexagon_bl_rb(cell, x0, x1, x2, x3, opt);
      break;
    case 73:
      shapeCoordinates.hexagon_tr_rb(cell, x0, x1, x2, x3, opt);
      break;
    case 133:
      shapeCoordinates.hexagon_lt_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 22:
      shapeCoordinates.hexagon_bl_lt(cell, x0, x1, x2, x3, opt);
      break;
    case 88:
      shapeCoordinates.hexagon_bl_rb(cell, x0, x1, x2, x3, opt);
      break;
    case 97:
      shapeCoordinates.hexagon_tr_rb(cell, x0, x1, x2, x3, opt);
      break;
    case 145:
      shapeCoordinates.hexagon_lt_rb(cell, x0, x1, x2, x3, opt);
      break;
    case 25:
      shapeCoordinates.hexagon_lt_rb(cell, x0, x1, x2, x3, opt);
      break;
    case 70:
      shapeCoordinates.hexagon_bl_tr(cell, x0, x1, x2, x3, opt);
      break;
    case 100:
      shapeCoordinates.hexagon_bl_tr(cell, x0, x1, x2, x3, opt);
      break;
    /* 6-sided saddles */
    case 17:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 0) {
        shapeCoordinates.triangle_bl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.triangle_tr(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.hexagon_lt_rb(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 68:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 0) {
        shapeCoordinates.triangle_tl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.triangle_br(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.hexagon_bl_tr(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 153:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 2) {
        shapeCoordinates.triangle_bl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.triangle_tr(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.hexagon_lt_rb(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 102:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 2) {
        shapeCoordinates.triangle_tl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.triangle_br(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.hexagon_bl_tr(cell, x0, x1, x2, x3, opt);
      }
      break;
    /* 7-sided saddles */
    case 152:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 2) {
        shapeCoordinates.triangle_tr(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_bl(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.heptagon_tr(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 137:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 2) {
        shapeCoordinates.triangle_bl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_tr(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.heptagon_bl(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 98:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 2) {
        shapeCoordinates.triangle_tl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_br(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.heptagon_tl(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 38:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 2) {
        shapeCoordinates.triangle_br(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_tl(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.heptagon_br(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 18:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 0) {
        shapeCoordinates.triangle_tr(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_bl(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.heptagon_tr(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 33:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 0) {
        shapeCoordinates.triangle_bl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_tr(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.heptagon_bl(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 72:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 0) {
        shapeCoordinates.triangle_tl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_br(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.heptagon_tl(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 132:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 0) {
        shapeCoordinates.triangle_br(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_tl(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.heptagon_br(cell, x0, x1, x2, x3, opt);
      }
      break;
    /* 8-sided saddles */
    case 136:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 0) {
        shapeCoordinates.tetragon_tl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_br(cell, x0, x1, x2, x3, opt);
      } else if (center_avg === 1) {
        shapeCoordinates.octagon(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.tetragon_bl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_tr(cell, x0, x1, x2, x3, opt);
      }
      break;
    case 34:
      center_avg = computeCenterAverage(x0, x1, x2, x3, minV, maxV);
      if (center_avg === 0) {
        shapeCoordinates.tetragon_bl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_tr(cell, x0, x1, x2, x3, opt);
      } else if (center_avg === 1) {
        shapeCoordinates.octagon(cell, x0, x1, x2, x3, opt);
      } else {
        shapeCoordinates.tetragon_tl(cell, x0, x1, x2, x3, opt);
        shapeCoordinates.tetragon_br(cell, x0, x1, x2, x3, opt);
      }
      break;
  }
  return cell;
}
__name(prepareCell2, "prepareCell");

/*
Isoline generation using the marching-squares library.
Generates contour lines for specific elevation levels.
*/
/**
 * Generate contour lines using marching-squares library for fixed elevation levels.
 *
 * This uses the `isolines` function from marching-squares, which is optimized for
 * generating contour lines at specific elevation levels (as opposed to intervals).
 *
 * For levels [500, 700, 900, 1000], it creates:
 * - Contour line(s) at 500m elevation
 * - Contour line(s) at 700m elevation
 * - Contour line(s) at 900m elevation
 * - Contour line(s) at 1000m elevation
 *
 * For bathymetry with negative levels [-100, -50, 0], it creates:
 * - Contour line(s) at -100m elevation
 * - Contour line(s) at -50m elevation
 * - Contour line(s) at 0m elevation
 *
 * @param levels Array of elevation levels (e.g., [500, 700, 900, 1000] or [-100, -50, 0])
 * @param tile The input height tile
 * @param extent Vector tile extent (default 4096)
 * @param buffer How many pixels into each neighboring tile to include
 * @returns Object mapping elevation levels to arrays of line geometries
 */
function generateIsolinesMS(levels, tile, extent = 4096, _buffer = 1) {
    // Handle string input (from URL encoding) by parsing as array
    let levelArray;
    if (typeof levels === "string") {
        levelArray = levels
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => !isNaN(n));
    }
    else {
        levelArray = levels;
    }
    if (!levelArray || levelArray.length === 0) {
        return {};
    }
    const result = {};
    // Sort levels
    const sortedLevels = [...levelArray].sort((a, b) => a - b);
    // Convert HeightTile to 2D array for marching-squares
    const width = tile.width;
    const height = tile.height;
    const data = [];
    for (let y = 0; y < height; y++) {
        data[y] = [];
        for (let x = 0; x < width; x++) {
            data[y][x] = tile.get(x, y);
        }
    }
    // Generate isolines for each level
    for (const level of sortedLevels) {
        try {
            // Use marching-squares isoLines function
            // isoLines returns Ring[][] where Ring is Coord[] and Coord is [number, number]
            // For a single threshold, it returns an array with one element (array of rings)
            const linesResult = isoLines(data, [level], {
                linearRing: false, // We want open paths for contour lines
                noFrame: true, // Don't include frame edges
            });
            // Convert marching-squares output to our format
            const geometries = [];
            // linesResult[0] contains all rings for this threshold level
            if (linesResult.length > 0) {
                const lines = linesResult[0];
                for (const line of lines) {
                    // line is an array of [x, y] coordinates
                    // Convert to flat array and scale to extent
                    const geometry = [];
                    const scale = extent / (width - 1);
                    for (const [x, y] of line) {
                        geometry.push(Math.round(x * scale), Math.round(y * scale));
                    }
                    // Only include lines with at least 2 points (4 coordinates)
                    if (geometry.length >= 4) {
                        geometries.push(geometry);
                    }
                }
            }
            if (geometries.length > 0) {
                result[level] = geometries;
            }
        }
        catch (err) {
            console.error(`[ISOLINES-MS] Error processing level ${level}:`, err);
        }
    }
    return result;
}

/*
Isoband generation using the marching-squares library.
Generates filled polygons for elevation ranges (e.g., 500-700m, 700-900m, etc.)
*/
/**
 * Generate filled polygons for elevation ranges between levels.
 *
 * Like GDAL contour -p, this generates polygons representing areas BETWEEN elevation levels.
 * For levels [500, 700, 900, 1000], it creates:
 * - Polygon(s) for areas between 500-700m
 * - Polygon(s) for areas between 700-900m
 * - Polygon(s) for areas between 900-1000m
 *
 * For bathymetry with negative levels [-100, -75, -50, 0], it creates:
 * - Polygon(s) for areas between -100 and -75m
 * - Polygon(s) for areas between -75 and -50m
 * - Polygon(s) for areas between -50 and 0m
 *
 * @param levels Array of elevation levels (e.g., [500, 700, 900, 1000] or [-100, -75, -50, 0])
 * @param tile The input height tile
 * @param extent Vector tile extent (default 4096)
 * @param buffer How many pixels into each neighboring tile to include
 * @returns Object mapping "lower:upper" ranges to arrays of polygons (e.g., "500:700" or "-100:-75")
 */
function generateIsobands(levels, tile, extent = 4096, _buffer = 1) {
    // Handle string input (from URL encoding) by parsing as array
    let levelArray;
    if (typeof levels === "string") {
        levelArray = levels
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => !isNaN(n));
    }
    else {
        levelArray = levels;
    }
    if (!levelArray || levelArray.length === 0) {
        return {};
    }
    const result = {};
    // Sort levels to create ranges
    const sortedLevels = [...levelArray].sort((a, b) => a - b);
    // Convert HeightTile to 2D array for marching-squares
    const width = tile.width;
    const height = tile.height;
    const data = [];
    for (let y = 0; y < height; y++) {
        data[y] = [];
        for (let x = 0; x < width; x++) {
            data[y][x] = tile.get(x, y);
        }
    }
    // Generate iso bands for each range between consecutive levels
    for (let i = 0; i < sortedLevels.length - 1; i++) {
        const lowerLevel = sortedLevels[i];
        const upperLevel = sortedLevels[i + 1];
        // Use colon separator to avoid issues with negative values (e.g., "-100--75" becomes "-100:-75")
        const rangeKey = `${lowerLevel}:${upperLevel}`;
        try {
            // Use marching-squares to generate bands
            // isoBands(data, thresholds, bandwidths)
            const thresholds = [lowerLevel];
            const bandwidths = [upperLevel - lowerLevel];
            const bands = isoBands(data, thresholds, bandwidths, {
                linearRing: true,
                noFrame: true,
            });
            // Convert marching-squares output to our format
            // bands is an array of arrays of paths
            const polygons = [];
            if (bands.length > 0 && bands[0].length > 0) {
                for (const path of bands[0]) {
                    // path is an array of [x, y] coordinates
                    // Convert to flat array and scale to extent
                    const polygon = [];
                    const scale = extent / (width - 1);
                    for (const [x, y] of path) {
                        polygon.push(Math.round(x * scale), Math.round(y * scale));
                    }
                    if (polygon.length >= 6) {
                        polygons.push(polygon);
                    }
                }
            }
            if (polygons.length > 0) {
                result[rangeKey] = polygons;
            }
        }
        catch (err) {
            console.error(`[ISOBANDS] Error processing range ${rangeKey}:`, err);
        }
    }
    return result;
}

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __rest(s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
}

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

function sortedEntries(object) {
    const entries = Object.entries(object);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries;
}
function encodeThresholds(thresholds) {
    return sortedEntries(thresholds)
        .map(([key, value]) => [key, ...(typeof value === "number" ? [value] : value)].join("*"))
        .join("~");
}
function decodeThresholds(thresholds) {
    return Object.fromEntries(thresholds
        .split("~")
        .map((part) => part.split("*").map(Number))
        .map(([key, ...values]) => [key, values]));
}
function encodeLevels(levels) {
    return sortedEntries(levels)
        .map(([key, value]) => [key, ...value].join("*"))
        .join("~");
}
function decodeLevels(levels) {
    return Object.fromEntries(levels
        .split("~")
        .map((part) => part.split("*").map(Number))
        .map(([key, ...values]) => [key, values]));
}
function encodeOptions(_a) {
    var { thresholds, lineLevels, polygonLevels } = _a, rest = __rest(_a, ["thresholds", "lineLevels", "polygonLevels"]);
    const encoded = Object.assign({}, rest);
    if (thresholds) {
        encoded.thresholds = encodeThresholds(thresholds);
    }
    if (lineLevels) {
        encoded.lineLevels = encodeLevels(lineLevels);
    }
    if (polygonLevels) {
        encoded.polygonLevels = encodeLevels(polygonLevels);
    }
    return sortedEntries(encoded)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
}
function decodeOptions(options) {
    return Object.fromEntries(options
        .replace(/^.*\?/, "")
        .split("&")
        .map((part) => {
        const parts = part.split("=").map(decodeURIComponent);
        const k = parts[0];
        let v = parts[1];
        switch (k) {
            case "thresholds":
                v = decodeThresholds(v);
                break;
            case "lineLevels":
            case "polygonLevels":
                v = decodeLevels(v);
                break;
            case "extent":
            case "multiplier":
            case "overzoom":
            case "buffer":
                v = Number(v);
        }
        return [k, v];
    }));
}
function encodeIndividualOptions(options) {
    return sortedEntries(options)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join(",");
}
function getOptionsForZoom(options, zoom) {
    const { thresholds, lineLevels, polygonLevels } = options, rest = __rest(options, ["thresholds", "lineLevels", "polygonLevels"]);
    let thresholdsForZoom = undefined;
    let lineLevelsForZoom = undefined;
    let polygonLevelsForZoom = undefined;
    // Process thresholds (interval-based contour lines)
    if (thresholds) {
        let maxLessThanOrEqualTo = -Infinity;
        Object.entries(thresholds).forEach(([zString, value]) => {
            const z = Number(zString);
            if (z <= zoom && z > maxLessThanOrEqualTo) {
                maxLessThanOrEqualTo = z;
                thresholdsForZoom = typeof value === "number" ? [value] : value;
            }
        });
    }
    // Process lineLevels (fixed elevation contour lines)
    if (lineLevels) {
        let maxLessThanOrEqualTo = -Infinity;
        Object.entries(lineLevels).forEach(([zString, value]) => {
            const z = Number(zString);
            if (z <= zoom && z > maxLessThanOrEqualTo) {
                maxLessThanOrEqualTo = z;
                lineLevelsForZoom = value;
            }
        });
    }
    // Process polygonLevels (fixed elevation polygon levels per zoom)
    if (polygonLevels) {
        let maxLessThanOrEqualTo = -Infinity;
        Object.entries(polygonLevels).forEach(([zString, value]) => {
            const z = Number(zString);
            if (z <= zoom && z > maxLessThanOrEqualTo) {
                maxLessThanOrEqualTo = z;
                polygonLevelsForZoom = value;
            }
        });
    }
    return Object.assign({ thresholds: thresholdsForZoom, lineLevels: lineLevelsForZoom, polygonLevels: polygonLevelsForZoom }, rest);
}
function copy(src) {
    const dst = new ArrayBuffer(src.byteLength);
    new Uint8Array(dst).set(new Uint8Array(src));
    return dst;
}
function prepareDemTile(promise, copy) {
    return promise.then((_a) => {
        var { data } = _a, rest = __rest(_a, ["data"]);
        let newData = data;
        if (copy) {
            newData = new Float32Array(data.length);
            newData.set(data);
        }
        return Object.assign(Object.assign({}, rest), { data: newData, transferrables: [newData.buffer] });
    });
}
function prepareContourTile(promise) {
    return promise.then(({ arrayBuffer }) => {
        const clone = copy(arrayBuffer);
        return {
            arrayBuffer: clone,
            transferrables: [clone],
        };
    });
}
let supportsOffscreenCanvas = null;
function offscreenCanvasSupported() {
    if (supportsOffscreenCanvas == null) {
        supportsOffscreenCanvas =
            typeof OffscreenCanvas !== "undefined" &&
                new OffscreenCanvas(1, 1).getContext("2d") &&
                typeof createImageBitmap === "function";
    }
    return supportsOffscreenCanvas || false;
}
let useVideoFrame = null;
function shouldUseVideoFrame() {
    if (useVideoFrame == null) {
        useVideoFrame = false;
        // if webcodec is supported, AND if the browser mangles getImageData results
        // (ie. safari with increased privacy protections) then use webcodec VideoFrame API
        if (offscreenCanvasSupported() && typeof VideoFrame !== "undefined") {
            const size = 5;
            const canvas = new OffscreenCanvas(5, 5);
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (context) {
                for (let i = 0; i < size * size; i++) {
                    const base = i * 4;
                    context.fillStyle = `rgb(${base},${base + 1},${base + 2})`;
                    context.fillRect(i % size, Math.floor(i / size), 1, 1);
                }
                const data = context.getImageData(0, 0, size, size).data;
                for (let i = 0; i < size * size * 4; i++) {
                    if (i % 4 !== 3 && data[i] !== i) {
                        useVideoFrame = true;
                        break;
                    }
                }
            }
        }
    }
    return useVideoFrame || false;
}
function withTimeout(timeoutMs, value, abortController) {
    let reject = () => { };
    const timeout = setTimeout(() => {
        reject(new Error("timed out"));
        abortController === null || abortController === void 0 ? void 0 : abortController.abort();
    }, timeoutMs);
    onAbort(abortController, () => {
        reject(new Error("aborted"));
        clearTimeout(timeout);
    });
    const cancelPromise = new Promise((_, rej) => {
        reject = rej;
    });
    return Promise.race([
        cancelPromise,
        value.finally(() => clearTimeout(timeout)),
    ]);
}
function onAbort(abortController, action) {
    if (action) {
        abortController === null || abortController === void 0 ? void 0 : abortController.signal.addEventListener("abort", action);
    }
}
function isAborted(abortController) {
    var _a;
    return Boolean((_a = abortController === null || abortController === void 0 ? void 0 : abortController.signal) === null || _a === void 0 ? void 0 : _a.aborted);
}
/**
 * Simple seeded random number generator (LCG)
 * Returns a function that generates pseudorandom numbers between 0 and 1
 */
function seededRandom(seed) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}
/**
 * Generate a jittered grid of points for spot soundings.
 *
 * @param minx - Minimum x coordinate (in tile coordinates)
 * @param miny - Minimum y coordinate (in tile coordinates)
 * @param maxx - Maximum x coordinate (in tile coordinates)
 * @param maxy - Maximum y coordinate (in tile coordinates)
 * @param spacing - Grid spacing in tile coordinates
 * @param tileX - Tile X coordinate (for seeding)
 * @param tileY - Tile Y coordinate (for seeding)
 * @param tileZ - Tile Z coordinate (for seeding)
 * @returns Array of [x, y] coordinates
 */
function generateJitteredGrid(minx, miny, maxx, maxy, spacing, tileX, tileY, tileZ) {
    const nx = Math.floor((maxx - minx) / spacing);
    const ny = Math.floor((maxy - miny) / spacing);
    const points = [];
    // Use tile coordinates for seeding to ensure consistent jitter across tiles
    const seed = tileZ * 1000000 + tileX * 1000 + tileY;
    const random = seededRandom(seed);
    for (let i = 0; i <= nx; i++) {
        for (let j = 0; j <= ny; j++) {
            const dx = (random() * spacing) / 2;
            const dy = (random() * spacing) / 2;
            const x = minx + i * spacing + dx + spacing / 4;
            const y = miny + j * spacing + dy + spacing / 4;
            if (x < maxx && y < maxy) {
                points.push([x, y]);
            }
        }
    }
    return points;
}

let num = 0;
/**
 * LRU Cache for CancelablePromises.
 * The underlying request is only canceled when all callers have canceled their usage of it.
 */
class AsyncCache {
    constructor(maxSize = 100) {
        this.size = () => this.items.size;
        this.get = (key, supplier, abortController) => {
            let result = this.items.get(key);
            if (!result) {
                const sharedAbortController = new AbortController();
                const value = supplier(key, sharedAbortController);
                result = {
                    abortController: sharedAbortController,
                    item: value,
                    lastUsed: ++num,
                    waiting: 1,
                };
                this.items.set(key, result);
                this.prune();
            }
            else {
                result.lastUsed = ++num;
                result.waiting++;
            }
            const items = this.items;
            const value = result.item.then((r) => r, (e) => {
                items.delete(key);
                return Promise.reject(e);
            });
            let canceled = false;
            onAbort(abortController, () => {
                var _a;
                if (result && result.abortController && !canceled) {
                    canceled = true;
                    if (--result.waiting <= 0) {
                        (_a = result.abortController) === null || _a === void 0 ? void 0 : _a.abort();
                        items.delete(key);
                    }
                }
            });
            return value;
        };
        this.clear = () => this.items.clear();
        this.maxSize = maxSize;
        this.items = new Map();
    }
    prune() {
        if (this.items.size > this.maxSize) {
            let minKey;
            let minUse = Infinity;
            this.items.forEach((value, key) => {
                if (value.lastUsed < minUse) {
                    minUse = value.lastUsed;
                    minKey = key;
                }
            });
            if (typeof minKey !== "undefined") {
                this.items.delete(minKey);
            }
        }
    }
}

let offscreenCanvas;
let offscreenContext;
let canvas;
let canvasContext;
/**
 * Parses a `raster-dem` image into a DemTile using Webcoded VideoFrame API.
 */
function decodeImageModern(blob, encoding, abortController) {
    return __awaiter(this, void 0, void 0, function* () {
        const img = yield createImageBitmap(blob);
        if (isAborted(abortController))
            return null;
        return decodeImageUsingOffscreenCanvas(img, encoding);
    });
}
function decodeImageUsingOffscreenCanvas(img, encoding) {
    if (!offscreenCanvas) {
        offscreenCanvas = new OffscreenCanvas(img.width, img.height);
        offscreenContext = offscreenCanvas.getContext("2d", {
            willReadFrequently: true,
        });
    }
    return getElevations(img, encoding, offscreenCanvas, offscreenContext);
}
/**
 * Parses a `raster-dem` image into a DemTile using webcodec VideoFrame API which works
 * even when browsers disable/degrade the canvas getImageData API as a privacy protection.
 */
function decodeImageVideoFrame(blob, encoding, abortController) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const img = yield createImageBitmap(blob);
        if (isAborted(abortController))
            return null;
        const vf = new VideoFrame(img, { timestamp: 0 });
        try {
            // formats we can handle: BGRX, BGRA, RGBA, RGBX
            const valid = ((_a = vf === null || vf === void 0 ? void 0 : vf.format) === null || _a === void 0 ? void 0 : _a.startsWith("BGR")) || ((_b = vf === null || vf === void 0 ? void 0 : vf.format) === null || _b === void 0 ? void 0 : _b.startsWith("RGB"));
            if (!valid) {
                throw new Error(`Unrecognized format: ${vf === null || vf === void 0 ? void 0 : vf.format}`);
            }
            const swapBR = (_c = vf === null || vf === void 0 ? void 0 : vf.format) === null || _c === void 0 ? void 0 : _c.startsWith("BGR");
            const size = vf.allocationSize();
            const data = new Uint8ClampedArray(size);
            yield vf.copyTo(data);
            if (swapBR) {
                for (let i = 0; i < data.length; i += 4) {
                    const tmp = data[i];
                    data[i] = data[i + 2];
                    data[i + 2] = tmp;
                }
            }
            return decodeParsedImage(img.width, img.height, encoding, data);
        }
        catch (_) {
            if (isAborted(abortController))
                return null;
            // fall back to offscreen canvas
            return decodeImageUsingOffscreenCanvas(img, encoding);
        }
        finally {
            vf.close();
        }
    });
}
/**
 * Parses a `raster-dem` image into a DemTile using `<img>` element drawn to a `<canvas>`.
 * Only works on the main thread, but works across all browsers.
 */
function decodeImageOld(blob, encoding, abortController) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!canvas) {
            canvas = document.createElement("canvas");
            canvasContext = canvas.getContext("2d", {
                willReadFrequently: true,
            });
        }
        const img = new Image();
        onAbort(abortController, () => (img.src = ""));
        const fetchedImage = yield new Promise((resolve, reject) => {
            img.onload = () => {
                if (!isAborted(abortController))
                    resolve(img);
                URL.revokeObjectURL(img.src);
                img.onload = null;
            };
            img.onerror = () => reject(new Error("Could not load image."));
            img.src = blob.size ? URL.createObjectURL(blob) : "";
        });
        return getElevations(fetchedImage, encoding, canvas, canvasContext);
    });
}
/**
 * Parses a `raster-dem` image in a worker that doesn't support OffscreenCanvas and createImageBitmap
 * by running decodeImageOld on the main thread and returning the result.
 */
function decodeImageOnMainThread(blob, encoding, abortController) {
    return self.actor.send("decodeImage", [], abortController, undefined, blob, encoding);
}
function isWorker() {
    return (
    // @ts-expect-error WorkerGlobalScope defined
    typeof WorkerGlobalScope !== "undefined" &&
        typeof self !== "undefined" &&
        // @ts-expect-error WorkerGlobalScope defined
        self instanceof WorkerGlobalScope);
}
const defaultDecoder = shouldUseVideoFrame()
    ? decodeImageVideoFrame
    : offscreenCanvasSupported()
        ? decodeImageModern
        : isWorker()
            ? decodeImageOnMainThread
            : decodeImageOld;
function getElevations(img, encoding, canvas, canvasContext) {
    canvas.width = img.width;
    canvas.height = img.height;
    if (!canvasContext)
        throw new Error("failed to get context");
    canvasContext.drawImage(img, 0, 0, img.width, img.height);
    const rgba = canvasContext.getImageData(0, 0, img.width, img.height).data;
    return decodeParsedImage(img.width, img.height, encoding, rgba);
}
function decodeParsedImage(width, height, encoding, input) {
    const decoder = encoding === "mapbox"
        ? (r, g, b) => -1e4 + (r * 256 * 256 + g * 256 + b) * 0.1
        : (r, g, b) => r * 256 + g + b / 256 - 32768;
    const data = new Float32Array(width * height);
    for (let i = 0; i < input.length; i += 4) {
        data[i / 4] = decoder(input[i], input[i + 1], input[i + 2]);
    }
    return { width, height, data };
}

const MIN_VALID_M = -12e3;
const MAX_VALID_M = 9000;
function defaultIsValid(number) {
    return !isNaN(number) && number >= MIN_VALID_M && number <= MAX_VALID_M;
}
/** A tile containing elevation values aligned to a grid. */
class HeightTile {
    constructor(width, height, get) {
        /**
         * Splits this tile into a `1<<subz` x `1<<subz` grid and returns the tile at coordinates `subx, suby`.
         */
        this.split = (subz, subx, suby) => {
            if (subz === 0)
                return this;
            const by = 1 << subz;
            const dx = (subx * this.width) / by;
            const dy = (suby * this.height) / by;
            return new HeightTile(this.width / by, this.height / by, (x, y) => this.get(x + dx, y + dy));
        };
        /**
         * Returns a new tile scaled up by `factor` with pixel values that are subsampled using
         * bilinear interpolation between the original height tile values.
         *
         * The original and result tile are assumed to represent values taken at the center of each pixel.
         */
        this.subsamplePixelCenters = (factor) => {
            const lerp = (a, b, f) => isNaN(a) ? b : isNaN(b) ? a : a + (b - a) * f;
            if (factor <= 1)
                return this;
            const sub = 0.5 - 1 / (2 * factor);
            const blerper = (x, y) => {
                const dx = x / factor - sub;
                const dy = y / factor - sub;
                const ox = Math.floor(dx);
                const oy = Math.floor(dy);
                const a = this.get(ox, oy);
                const b = this.get(ox + 1, oy);
                const c = this.get(ox, oy + 1);
                const d = this.get(ox + 1, oy + 1);
                const fx = dx - ox;
                const fy = dy - oy;
                const top = lerp(a, b, fx);
                const bottom = lerp(c, d, fx);
                return lerp(top, bottom, fy);
            };
            return new HeightTile(this.width * factor, this.height * factor, blerper);
        };
        /**
         * Assumes the input tile represented measurements taken at the center of each pixel, and
         * returns a new tile where values are the height at the top-left of each pixel by averaging
         * the 4 adjacent pixel values.
         */
        this.averagePixelCentersToGrid = (radius = 1) => new HeightTile(this.width + 1, this.height + 1, (x, y) => {
            let sum = 0, count = 0, v = 0;
            for (let newX = x - radius; newX < x + radius; newX++) {
                for (let newY = y - radius; newY < y + radius; newY++) {
                    if (!isNaN((v = this.get(newX, newY)))) {
                        count++;
                        sum += v;
                    }
                }
            }
            return count === 0 ? NaN : sum / count;
        });
        /** Returns a new tile with elevation values scaled by `multiplier`. */
        this.scaleElevation = (multiplier) => multiplier === 1
            ? this
            : new HeightTile(this.width, this.height, (x, y) => this.get(x, y) * multiplier);
        /**
         * Precompute every value from `-bufer, -buffer` to `width + buffer, height + buffer` and serve them
         * out of a `Float32Array`. Until this method is called, all `get` requests are lazy and call all previous
         * methods in the chain up to the root DEM tile.
         */
        this.materialize = (buffer = 2) => {
            const stride = this.width + 2 * buffer;
            const data = new Float32Array(stride * (this.height + 2 * buffer));
            let idx = 0;
            for (let y = -buffer; y < this.height + buffer; y++) {
                for (let x = -buffer; x < this.width + buffer; x++) {
                    data[idx++] = this.get(x, y);
                }
            }
            return new HeightTile(this.width, this.height, (x, y) => data[(y + buffer) * stride + x + buffer]);
        };
        this.get = get;
        this.width = width;
        this.height = height;
    }
    /** Construct a height tile from raw DEM pixel values */
    static fromRawDem(demTile) {
        return new HeightTile(demTile.width, demTile.height, (x, y) => {
            const value = demTile.data[y * demTile.width + x];
            return defaultIsValid(value) ? value : NaN;
        });
    }
    /**
     * Construct a height tile from a DEM tile plus it's 8 neighbors, so that
     * you can request `x` or `y` outside the bounds of the original tile.
     *
     * @param neighbors An array containing tiles: `[nw, n, ne, w, c, e, sw, s, se]`
     */
    static combineNeighbors(neighbors) {
        if (neighbors.length !== 9) {
            throw new Error("Must include a tile plus 8 neighbors");
        }
        const mainTile = neighbors[4];
        if (!mainTile) {
            return undefined;
        }
        const width = mainTile.width;
        const height = mainTile.height;
        return new HeightTile(width, height, (x, y) => {
            let gridIdx = 0;
            if (y < 0) {
                y += height;
            }
            else if (y < height) {
                gridIdx += 3;
            }
            else {
                y -= height;
                gridIdx += 6;
            }
            if (x < 0) {
                x += width;
            }
            else if (x < width) {
                gridIdx += 1;
            }
            else {
                x -= width;
                gridIdx += 2;
            }
            const grid = neighbors[gridIdx];
            return grid ? grid.get(x, y) : NaN;
        });
    }
}

const SHIFT_LEFT_32 = (1 << 16) * (1 << 16);
const SHIFT_RIGHT_32 = 1 / SHIFT_LEFT_32;

// Threshold chosen based on both benchmarking and knowledge about browser string
// data structures (which currently switch structure types at 12 bytes or more)
const TEXT_DECODER_MIN_LENGTH = 12;
const utf8TextDecoder = typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8');

const PBF_VARINT  = 0; // varint: int32, int64, uint32, uint64, sint32, sint64, bool, enum
const PBF_FIXED64 = 1; // 64-bit: double, fixed64, sfixed64
const PBF_BYTES   = 2; // length-delimited: string, bytes, embedded messages, packed repeated fields
const PBF_FIXED32 = 5; // 32-bit: float, fixed32, sfixed32

class Pbf {
    /**
     * @param {Uint8Array | ArrayBuffer} [buf]
     */
    constructor(buf = new Uint8Array(16)) {
        this.buf = ArrayBuffer.isView(buf) ? buf : new Uint8Array(buf);
        this.dataView = new DataView(this.buf.buffer);
        this.pos = 0;
        this.type = 0;
        this.length = this.buf.length;
    }

    // === READING =================================================================

    /**
     * @template T
     * @param {(tag: number, result: T, pbf: Pbf) => void} readField
     * @param {T} result
     * @param {number} [end]
     */
    readFields(readField, result, end = this.length) {
        while (this.pos < end) {
            const val = this.readVarint(),
                tag = val >> 3,
                startPos = this.pos;

            this.type = val & 0x7;
            readField(tag, result, this);

            if (this.pos === startPos) this.skip(val);
        }
        return result;
    }

    /**
     * @template T
     * @param {(tag: number, result: T, pbf: Pbf) => void} readField
     * @param {T} result
     */
    readMessage(readField, result) {
        return this.readFields(readField, result, this.readVarint() + this.pos);
    }

    readFixed32() {
        const val = this.dataView.getUint32(this.pos, true);
        this.pos += 4;
        return val;
    }

    readSFixed32() {
        const val = this.dataView.getInt32(this.pos, true);
        this.pos += 4;
        return val;
    }

    // 64-bit int handling is based on github.com/dpw/node-buffer-more-ints (MIT-licensed)

    readFixed64() {
        const val = this.dataView.getUint32(this.pos, true) + this.dataView.getUint32(this.pos + 4, true) * SHIFT_LEFT_32;
        this.pos += 8;
        return val;
    }

    readSFixed64() {
        const val = this.dataView.getUint32(this.pos, true) + this.dataView.getInt32(this.pos + 4, true) * SHIFT_LEFT_32;
        this.pos += 8;
        return val;
    }

    readFloat() {
        const val = this.dataView.getFloat32(this.pos, true);
        this.pos += 4;
        return val;
    }

    readDouble() {
        const val = this.dataView.getFloat64(this.pos, true);
        this.pos += 8;
        return val;
    }

    /**
     * @param {boolean} [isSigned]
     */
    readVarint(isSigned) {
        const buf = this.buf;
        let val, b;

        b = buf[this.pos++]; val  =  b & 0x7f;        if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 7;  if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 14; if (b < 0x80) return val;
        b = buf[this.pos++]; val |= (b & 0x7f) << 21; if (b < 0x80) return val;
        b = buf[this.pos];   val |= (b & 0x0f) << 28;

        return readVarintRemainder(val, isSigned, this);
    }

    readVarint64() { // for compatibility with v2.0.1
        return this.readVarint(true);
    }

    readSVarint() {
        const num = this.readVarint();
        return num % 2 === 1 ? (num + 1) / -2 : num / 2; // zigzag encoding
    }

    readBoolean() {
        return Boolean(this.readVarint());
    }

    readString() {
        const end = this.readVarint() + this.pos;
        const pos = this.pos;
        this.pos = end;

        if (end - pos >= TEXT_DECODER_MIN_LENGTH && utf8TextDecoder) {
            // longer strings are fast with the built-in browser TextDecoder API
            return utf8TextDecoder.decode(this.buf.subarray(pos, end));
        }
        // short strings are fast with our custom implementation
        return readUtf8(this.buf, pos, end);
    }

    readBytes() {
        const end = this.readVarint() + this.pos,
            buffer = this.buf.subarray(this.pos, end);
        this.pos = end;
        return buffer;
    }

    // verbose for performance reasons; doesn't affect gzipped size

    /**
     * @param {number[]} [arr]
     * @param {boolean} [isSigned]
     */
    readPackedVarint(arr = [], isSigned) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readVarint(isSigned));
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSVarint(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readSVarint());
        return arr;
    }
    /** @param {boolean[]} [arr] */
    readPackedBoolean(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readBoolean());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFloat(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readFloat());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedDouble(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readDouble());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFixed32(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readFixed32());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSFixed32(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readSFixed32());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFixed64(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readFixed64());
        return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSFixed64(arr = []) {
        const end = this.readPackedEnd();
        while (this.pos < end) arr.push(this.readSFixed64());
        return arr;
    }
    readPackedEnd() {
        return this.type === PBF_BYTES ? this.readVarint() + this.pos : this.pos + 1;
    }

    /** @param {number} val */
    skip(val) {
        const type = val & 0x7;
        if (type === PBF_VARINT) while (this.buf[this.pos++] > 0x7f) {}
        else if (type === PBF_BYTES) this.pos = this.readVarint() + this.pos;
        else if (type === PBF_FIXED32) this.pos += 4;
        else if (type === PBF_FIXED64) this.pos += 8;
        else throw new Error(`Unimplemented type: ${type}`);
    }

    // === WRITING =================================================================

    /**
     * @param {number} tag
     * @param {number} type
     */
    writeTag(tag, type) {
        this.writeVarint((tag << 3) | type);
    }

    /** @param {number} min */
    realloc(min) {
        let length = this.length || 16;

        while (length < this.pos + min) length *= 2;

        if (length !== this.length) {
            const buf = new Uint8Array(length);
            buf.set(this.buf);
            this.buf = buf;
            this.dataView = new DataView(buf.buffer);
            this.length = length;
        }
    }

    finish() {
        this.length = this.pos;
        this.pos = 0;
        return this.buf.subarray(0, this.length);
    }

    /** @param {number} val */
    writeFixed32(val) {
        this.realloc(4);
        this.dataView.setInt32(this.pos, val, true);
        this.pos += 4;
    }

    /** @param {number} val */
    writeSFixed32(val) {
        this.realloc(4);
        this.dataView.setInt32(this.pos, val, true);
        this.pos += 4;
    }

    /** @param {number} val */
    writeFixed64(val) {
        this.realloc(8);
        this.dataView.setInt32(this.pos, val & -1, true);
        this.dataView.setInt32(this.pos + 4, Math.floor(val * SHIFT_RIGHT_32), true);
        this.pos += 8;
    }

    /** @param {number} val */
    writeSFixed64(val) {
        this.realloc(8);
        this.dataView.setInt32(this.pos, val & -1, true);
        this.dataView.setInt32(this.pos + 4, Math.floor(val * SHIFT_RIGHT_32), true);
        this.pos += 8;
    }

    /** @param {number} val */
    writeVarint(val) {
        val = +val || 0;

        if (val > 0xfffffff || val < 0) {
            writeBigVarint(val, this);
            return;
        }

        this.realloc(4);

        this.buf[this.pos++] =           val & 0x7f  | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] = ((val >>>= 7) & 0x7f) | (val > 0x7f ? 0x80 : 0); if (val <= 0x7f) return;
        this.buf[this.pos++] =   (val >>> 7) & 0x7f;
    }

    /** @param {number} val */
    writeSVarint(val) {
        this.writeVarint(val < 0 ? -val * 2 - 1 : val * 2);
    }

    /** @param {boolean} val */
    writeBoolean(val) {
        this.writeVarint(+val);
    }

    /** @param {string} str */
    writeString(str) {
        str = String(str);
        this.realloc(str.length * 4);

        this.pos++; // reserve 1 byte for short string length

        const startPos = this.pos;
        // write the string directly to the buffer and see how much was written
        this.pos = writeUtf8(this.buf, str, this.pos);
        const len = this.pos - startPos;

        if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

        // finally, write the message length in the reserved place and restore the position
        this.pos = startPos - 1;
        this.writeVarint(len);
        this.pos += len;
    }

    /** @param {number} val */
    writeFloat(val) {
        this.realloc(4);
        this.dataView.setFloat32(this.pos, val, true);
        this.pos += 4;
    }

    /** @param {number} val */
    writeDouble(val) {
        this.realloc(8);
        this.dataView.setFloat64(this.pos, val, true);
        this.pos += 8;
    }

    /** @param {Uint8Array} buffer */
    writeBytes(buffer) {
        const len = buffer.length;
        this.writeVarint(len);
        this.realloc(len);
        for (let i = 0; i < len; i++) this.buf[this.pos++] = buffer[i];
    }

    /**
     * @template T
     * @param {(obj: T, pbf: Pbf) => void} fn
     * @param {T} obj
     */
    writeRawMessage(fn, obj) {
        this.pos++; // reserve 1 byte for short message length

        // write the message directly to the buffer and see how much was written
        const startPos = this.pos;
        fn(obj, this);
        const len = this.pos - startPos;

        if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

        // finally, write the message length in the reserved place and restore the position
        this.pos = startPos - 1;
        this.writeVarint(len);
        this.pos += len;
    }

    /**
     * @template T
     * @param {number} tag
     * @param {(obj: T, pbf: Pbf) => void} fn
     * @param {T} obj
     */
    writeMessage(tag, fn, obj) {
        this.writeTag(tag, PBF_BYTES);
        this.writeRawMessage(fn, obj);
    }

    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedVarint(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedVarint, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSVarint(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedSVarint, arr);
    }
    /**
     * @param {number} tag
     * @param {boolean[]} arr
     */
    writePackedBoolean(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedBoolean, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFloat(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedFloat, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedDouble(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedDouble, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFixed32(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedFixed32, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSFixed32(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedSFixed32, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFixed64(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedFixed64, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSFixed64(tag, arr) {
        if (arr.length) this.writeMessage(tag, writePackedSFixed64, arr);
    }

    /**
     * @param {number} tag
     * @param {Uint8Array} buffer
     */
    writeBytesField(tag, buffer) {
        this.writeTag(tag, PBF_BYTES);
        this.writeBytes(buffer);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFixed32Field(tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeFixed32(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSFixed32Field(tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeSFixed32(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFixed64Field(tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeFixed64(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSFixed64Field(tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeSFixed64(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeVarintField(tag, val) {
        this.writeTag(tag, PBF_VARINT);
        this.writeVarint(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSVarintField(tag, val) {
        this.writeTag(tag, PBF_VARINT);
        this.writeSVarint(val);
    }
    /**
     * @param {number} tag
     * @param {string} str
     */
    writeStringField(tag, str) {
        this.writeTag(tag, PBF_BYTES);
        this.writeString(str);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFloatField(tag, val) {
        this.writeTag(tag, PBF_FIXED32);
        this.writeFloat(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeDoubleField(tag, val) {
        this.writeTag(tag, PBF_FIXED64);
        this.writeDouble(val);
    }
    /**
     * @param {number} tag
     * @param {boolean} val
     */
    writeBooleanField(tag, val) {
        this.writeVarintField(tag, +val);
    }
}
/**
 * @param {number} l
 * @param {boolean | undefined} s
 * @param {Pbf} p
 */
function readVarintRemainder(l, s, p) {
    const buf = p.buf;
    let h, b;

    b = buf[p.pos++]; h  = (b & 0x70) >> 4;  if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 3;  if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 10; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 17; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x7f) << 24; if (b < 0x80) return toNum(l, h, s);
    b = buf[p.pos++]; h |= (b & 0x01) << 31; if (b < 0x80) return toNum(l, h, s);

    throw new Error('Expected varint not more than 10 bytes');
}

/**
 * @param {number} low
 * @param {number} high
 * @param {boolean} [isSigned]
 */
function toNum(low, high, isSigned) {
    return isSigned ? high * 0x100000000 + (low >>> 0) : ((high >>> 0) * 0x100000000) + (low >>> 0);
}

/**
 * @param {number} val
 * @param {Pbf} pbf
 */
function writeBigVarint(val, pbf) {
    let low, high;

    if (val >= 0) {
        low  = (val % 0x100000000) | 0;
        high = (val / 0x100000000) | 0;
    } else {
        low  = ~(-val % 0x100000000);
        high = ~(-val / 0x100000000);

        if (low ^ 0xffffffff) {
            low = (low + 1) | 0;
        } else {
            low = 0;
            high = (high + 1) | 0;
        }
    }

    if (val >= 0x10000000000000000 || val < -18446744073709552e3) {
        throw new Error('Given varint doesn\'t fit into 10 bytes');
    }

    pbf.realloc(10);

    writeBigVarintLow(low, high, pbf);
    writeBigVarintHigh(high, pbf);
}

/**
 * @param {number} high
 * @param {number} low
 * @param {Pbf} pbf
 */
function writeBigVarintLow(low, high, pbf) {
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos++] = low & 0x7f | 0x80; low >>>= 7;
    pbf.buf[pbf.pos]   = low & 0x7f;
}

/**
 * @param {number} high
 * @param {Pbf} pbf
 */
function writeBigVarintHigh(high, pbf) {
    const lsb = (high & 0x07) << 4;

    pbf.buf[pbf.pos++] |= lsb         | ((high >>>= 3) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f | ((high >>>= 7) ? 0x80 : 0); if (!high) return;
    pbf.buf[pbf.pos++]  = high & 0x7f;
}

/**
 * @param {number} startPos
 * @param {number} len
 * @param {Pbf} pbf
 */
function makeRoomForExtraLength(startPos, len, pbf) {
    const extraLen =
        len <= 0x3fff ? 1 :
        len <= 0x1fffff ? 2 :
        len <= 0xfffffff ? 3 : Math.floor(Math.log(len) / (Math.LN2 * 7));

    // if 1 byte isn't enough for encoding message length, shift the data to the right
    pbf.realloc(extraLen);
    for (let i = pbf.pos - 1; i >= startPos; i--) pbf.buf[i + extraLen] = pbf.buf[i];
}

/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedVarint(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeVarint(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedSVarint(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSVarint(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedFloat(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFloat(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedDouble(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeDouble(arr[i]);
}
/**
 * @param {boolean[]} arr
 * @param {Pbf} pbf
 */
function writePackedBoolean(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeBoolean(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedFixed32(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFixed32(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedSFixed32(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSFixed32(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedFixed64(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFixed64(arr[i]);
}
/**
 * @param {number[]} arr
 * @param {Pbf} pbf
 */
function writePackedSFixed64(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSFixed64(arr[i]);
}

// Buffer code below from https://github.com/feross/buffer, MIT-licensed

/**
 * @param {Uint8Array} buf
 * @param {number} pos
 * @param {number} end
 */
function readUtf8(buf, pos, end) {
    let str = '';
    let i = pos;

    while (i < end) {
        const b0 = buf[i];
        let c = null; // codepoint
        let bytesPerSequence =
            b0 > 0xEF ? 4 :
            b0 > 0xDF ? 3 :
            b0 > 0xBF ? 2 : 1;

        if (i + bytesPerSequence > end) break;

        let b1, b2, b3;

        if (bytesPerSequence === 1) {
            if (b0 < 0x80) {
                c = b0;
            }
        } else if (bytesPerSequence === 2) {
            b1 = buf[i + 1];
            if ((b1 & 0xC0) === 0x80) {
                c = (b0 & 0x1F) << 0x6 | (b1 & 0x3F);
                if (c <= 0x7F) {
                    c = null;
                }
            }
        } else if (bytesPerSequence === 3) {
            b1 = buf[i + 1];
            b2 = buf[i + 2];
            if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80) {
                c = (b0 & 0xF) << 0xC | (b1 & 0x3F) << 0x6 | (b2 & 0x3F);
                if (c <= 0x7FF || (c >= 0xD800 && c <= 0xDFFF)) {
                    c = null;
                }
            }
        } else if (bytesPerSequence === 4) {
            b1 = buf[i + 1];
            b2 = buf[i + 2];
            b3 = buf[i + 3];
            if ((b1 & 0xC0) === 0x80 && (b2 & 0xC0) === 0x80 && (b3 & 0xC0) === 0x80) {
                c = (b0 & 0xF) << 0x12 | (b1 & 0x3F) << 0xC | (b2 & 0x3F) << 0x6 | (b3 & 0x3F);
                if (c <= 0xFFFF || c >= 0x110000) {
                    c = null;
                }
            }
        }

        if (c === null) {
            c = 0xFFFD;
            bytesPerSequence = 1;

        } else if (c > 0xFFFF) {
            c -= 0x10000;
            str += String.fromCharCode(c >>> 10 & 0x3FF | 0xD800);
            c = 0xDC00 | c & 0x3FF;
        }

        str += String.fromCharCode(c);
        i += bytesPerSequence;
    }

    return str;
}

/**
 * @param {Uint8Array} buf
 * @param {string} str
 * @param {number} pos
 */
function writeUtf8(buf, str, pos) {
    for (let i = 0, c, lead; i < str.length; i++) {
        c = str.charCodeAt(i); // code point

        if (c > 0xD7FF && c < 0xE000) {
            if (lead) {
                if (c < 0xDC00) {
                    buf[pos++] = 0xEF;
                    buf[pos++] = 0xBF;
                    buf[pos++] = 0xBD;
                    lead = c;
                    continue;
                } else {
                    c = lead - 0xD800 << 10 | c - 0xDC00 | 0x10000;
                    lead = null;
                }
            } else {
                if (c > 0xDBFF || (i + 1 === str.length)) {
                    buf[pos++] = 0xEF;
                    buf[pos++] = 0xBF;
                    buf[pos++] = 0xBD;
                } else {
                    lead = c;
                }
                continue;
            }
        } else if (lead) {
            buf[pos++] = 0xEF;
            buf[pos++] = 0xBF;
            buf[pos++] = 0xBD;
            lead = null;
        }

        if (c < 0x80) {
            buf[pos++] = c;
        } else {
            if (c < 0x800) {
                buf[pos++] = c >> 0x6 | 0xC0;
            } else {
                if (c < 0x10000) {
                    buf[pos++] = c >> 0xC | 0xE0;
                } else {
                    buf[pos++] = c >> 0x12 | 0xF0;
                    buf[pos++] = c >> 0xC & 0x3F | 0x80;
                }
                buf[pos++] = c >> 0x6 & 0x3F | 0x80;
            }
            buf[pos++] = c & 0x3F | 0x80;
        }
    }
    return pos;
}

/*
Adapted from vt-pbf https://github.com/mapbox/vt-pbf

The MIT License (MIT)

Copyright (c) 2015 Anand Thakker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
var GeomType;
(function (GeomType) {
    GeomType[GeomType["UNKNOWN"] = 0] = "UNKNOWN";
    GeomType[GeomType["POINT"] = 1] = "POINT";
    GeomType[GeomType["LINESTRING"] = 2] = "LINESTRING";
    GeomType[GeomType["POLYGON"] = 3] = "POLYGON";
})(GeomType || (GeomType = {}));
/**
 * Enodes and serializes a mapbox vector tile as an array of bytes.
 */
function encodeVectorTile(tile) {
    const pbf = new Pbf();
    for (const id in tile.layers) {
        const layer = tile.layers[id];
        if (!layer.extent) {
            layer.extent = tile.extent;
        }
        pbf.writeMessage(3, writeLayer, Object.assign(Object.assign({}, layer), { id }));
    }
    return pbf.finish();
}
function writeLayer(layer, pbf) {
    if (!pbf)
        throw new Error("pbf undefined");
    pbf.writeStringField(1, layer.id || ""); // name (required, field 1)
    // Write all features (field 2)
    const context = {
        keys: [],
        values: [],
        keycache: {},
        valuecache: {},
    };
    for (const feature of layer.features) {
        context.feature = feature;
        pbf.writeMessage(2, writeFeature, context);
    }
    // Write all keys (field 3)
    for (const key of context.keys) {
        pbf.writeStringField(3, key);
    }
    // Write all values (field 4)
    for (const value of context.values) {
        pbf.writeMessage(4, writeValue, value);
    }
    pbf.writeVarintField(5, layer.extent || 4096); // extent (field 5)
    pbf.writeVarintField(15, 2); // version (field 15, LAST)
}
function writeFeature(context, pbf) {
    const feature = context.feature;
    if (!feature || !pbf)
        throw new Error();
    pbf.writeMessage(2, writeProperties, context);
    pbf.writeVarintField(3, feature.type);
    pbf.writeMessage(4, writeGeometry, feature);
}
function writeProperties(context, pbf) {
    const feature = context.feature;
    if (!feature || !pbf)
        throw new Error();
    const keys = context.keys;
    const values = context.values;
    const keycache = context.keycache;
    const valuecache = context.valuecache;
    for (const key in feature.properties) {
        let value = feature.properties[key];
        let keyIndex = keycache[key];
        if (value === null)
            continue; // don't encode null value properties
        if (typeof keyIndex === "undefined") {
            keys.push(key);
            keyIndex = keys.length - 1;
            keycache[key] = keyIndex;
        }
        pbf.writeVarint(keyIndex);
        const type = typeof value;
        if (type !== "string" && type !== "boolean" && type !== "number") {
            value = JSON.stringify(value);
        }
        const valueKey = `${type}:${value}`;
        let valueIndex = valuecache[valueKey];
        if (typeof valueIndex === "undefined") {
            values.push(value);
            valueIndex = values.length - 1;
            valuecache[valueKey] = valueIndex;
        }
        pbf.writeVarint(valueIndex);
    }
}
function command(cmd, length) {
    return (length << 3) + (cmd & 0x7);
}
function zigzag(num) {
    return (num << 1) ^ (num >> 31);
}
function writeGeometry(feature, pbf) {
    if (!pbf)
        throw new Error();
    const geometry = feature.geometry;
    const type = feature.type;
    let x = 0;
    let y = 0;
    for (const ring of geometry) {
        let count = 1;
        if (type === GeomType.POINT) {
            count = ring.length / 2;
        }
        pbf.writeVarint(command(1, count)); // moveto
        // do not write polygon closing path as lineto
        const length = ring.length / 2;
        const lineCount = type === GeomType.POLYGON ? length - 1 : length;
        for (let i = 0; i < lineCount; i++) {
            if (i === 1 && type !== 1) {
                pbf.writeVarint(command(2, lineCount - 1)); // lineto
            }
            const dx = ring[i * 2] - x;
            const dy = ring[i * 2 + 1] - y;
            pbf.writeVarint(zigzag(dx));
            pbf.writeVarint(zigzag(dy));
            x += dx;
            y += dy;
        }
        if (type === GeomType.POLYGON) {
            pbf.writeVarint(command(7, 1)); // closepath
        }
    }
}
function writeValue(value, pbf) {
    if (!pbf)
        throw new Error();
    if (typeof value === "string") {
        pbf.writeStringField(1, value);
    }
    else if (typeof value === "boolean") {
        pbf.writeBooleanField(7, value);
    }
    else if (typeof value === "number") {
        if (value % 1 !== 0) {
            pbf.writeDoubleField(3, value);
        }
        else if (value < 0) {
            pbf.writeSVarintField(6, value);
        }
        else {
            pbf.writeVarintField(5, value);
        }
    }
}

const perf = typeof performance !== "undefined" ? performance : undefined;
const timeOrigin = perf
    ? perf.timeOrigin || new Date().getTime() - perf.now()
    : new Date().getTime();
function getResourceTiming(url) {
    var _a;
    return JSON.parse(JSON.stringify(((_a = perf === null || perf === void 0 ? void 0 : perf.getEntriesByName) === null || _a === void 0 ? void 0 : _a.call(perf, url)) || []));
}
function now() {
    return perf ? perf.now() : new Date().getTime();
}
function flatten(input) {
    const result = [];
    for (const list of input) {
        result.push(...list);
    }
    return result;
}
/** Utility for tracking how long tiles take to generate, and where the time is going. */
class Timer {
    constructor(name) {
        this.marks = {};
        this.urls = [];
        this.fetched = [];
        this.resources = [];
        this.tilesFetched = 0;
        this.timeOrigin = timeOrigin;
        this.finish = (url) => {
            this.markFinish();
            const get = (type) => {
                const all = this.marks[type] || [];
                const max = Math.max(...all.map((ns) => Math.max(...ns)));
                const min = Math.min(...all.map((ns) => Math.min(...ns)));
                return Number.isFinite(max) ? max - min : undefined;
            };
            const duration = get("main") || 0;
            const fetch = get("fetch");
            const decode = get("decode");
            const process = get("isoline");
            return {
                url,
                tilesUsed: this.tilesFetched,
                origin: this.timeOrigin,
                marks: this.marks,
                resources: [
                    ...this.resources,
                    ...flatten(this.fetched.map(getResourceTiming)),
                ],
                duration,
                fetch,
                decode,
                process,
                wait: duration - (fetch || 0) - (decode || 0) - (process || 0),
            };
        };
        this.error = (url) => (Object.assign(Object.assign({}, this.finish(url)), { error: true }));
        this.marker = (category) => {
            var _a;
            if (!this.marks[category]) {
                this.marks[category] = [];
            }
            const marks = [now()];
            (_a = this.marks[category]) === null || _a === void 0 ? void 0 : _a.push(marks);
            return () => marks.push(now());
        };
        this.useTile = (url) => {
            if (this.urls.indexOf(url) < 0) {
                this.urls.push(url);
                this.tilesFetched++;
            }
        };
        this.fetchTile = (url) => {
            if (this.fetched.indexOf(url) < 0) {
                this.fetched.push(url);
            }
        };
        this.addAll = (timings) => {
            var _a;
            this.tilesFetched += timings.tilesUsed;
            const offset = timings.origin - this.timeOrigin;
            for (const category in timings.marks) {
                const key = category;
                const ourList = this.marks[key] || (this.marks[key] = []);
                ourList.push(...(((_a = timings.marks[key]) === null || _a === void 0 ? void 0 : _a.map((ns) => ns.map((n) => n + offset))) || []));
            }
            this.resources.push(...timings.resources.map((rt) => applyOffset(rt, offset)));
        };
        this.markFinish = this.marker(name);
    }
}
const startOrEnd = /(Start$|End$|^start|^end)/;
function applyOffset(obj, offset) {
    const result = {};
    for (const key in obj) {
        if (obj[key] !== 0 && startOrEnd.test(key)) {
            result[key] = Number(obj[key]) + offset;
        }
        else {
            result[key] = obj[key];
        }
    }
    return result;
}

const defaultGetTile = (url, abortController) => __awaiter(void 0, void 0, void 0, function* () {
    const options = {
        signal: abortController.signal,
    };
    const response = yield fetch(url, options);
    if (!response.ok) {
        throw new Error(`Bad response: ${response.status} for ${url}`);
    }
    return {
        data: yield response.blob(),
        expires: response.headers.get("expires") || undefined,
        cacheControl: response.headers.get("cache-control") || undefined,
    };
});
/**
 * Caches, decodes, and processes raster tiles in the current thread.
 */
class LocalDemManager {
    constructor(options) {
        this.loaded = Promise.resolve();
        this.fetchAndParseTile = (z, x, y, abortController, timer) => {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            const url = this.demUrlPattern
                .replace("{z}", z.toString())
                .replace("{x}", x.toString())
                .replace("{y}", y.toString());
            timer === null || timer === void 0 ? void 0 : timer.useTile(url);
            return this.parsedCache.get(url, (_, childAbortController) => __awaiter(this, void 0, void 0, function* () {
                const response = yield self.fetchTile(z, x, y, childAbortController, timer);
                if (isAborted(childAbortController))
                    throw new Error("canceled");
                const promise = self.decodeImage(response.data, self.encoding, childAbortController);
                const mark = timer === null || timer === void 0 ? void 0 : timer.marker("decode");
                const result = yield promise;
                mark === null || mark === void 0 ? void 0 : mark();
                return result;
            }), abortController);
        };
        this.tileCache = new AsyncCache(options.cacheSize);
        this.parsedCache = new AsyncCache(options.cacheSize);
        this.contourCache = new AsyncCache(options.cacheSize);
        this.timeoutMs = options.timeoutMs;
        this.demUrlPattern = options.demUrlPattern;
        this.encoding = options.encoding;
        this.maxzoom = options.maxzoom;
        this.decodeImage = options.decodeImage || defaultDecoder;
        this.getTile = options.getTile || defaultGetTile;
    }
    fetchTile(z, x, y, parentAbortController, timer) {
        const url = this.demUrlPattern
            .replace("{z}", z.toString())
            .replace("{x}", x.toString())
            .replace("{y}", y.toString());
        timer === null || timer === void 0 ? void 0 : timer.useTile(url);
        return this.tileCache.get(url, (_, childAbortController) => {
            timer === null || timer === void 0 ? void 0 : timer.fetchTile(url);
            const mark = timer === null || timer === void 0 ? void 0 : timer.marker("fetch");
            return withTimeout(this.timeoutMs, this.getTile(url, childAbortController).finally(() => mark === null || mark === void 0 ? void 0 : mark()), childAbortController);
        }, parentAbortController);
    }
    fetchDem(z, x, y, options, abortController, timer) {
        return __awaiter(this, void 0, void 0, function* () {
            const zoom = Math.min(z - (options.overzoom || 0), this.maxzoom);
            const subZ = z - zoom;
            const div = 1 << subZ;
            const newX = Math.floor(x / div);
            const newY = Math.floor(y / div);
            const tile = yield this.fetchAndParseTile(zoom, newX, newY, abortController, timer);
            return HeightTile.fromRawDem(tile).split(subZ, x % div, y % div);
        });
    }
    fetchContourTile(z, x, y, options, parentAbortController, timer) {
        const { multiplier = 1, buffer = 1, extent = 4096, subsampleBelow = 100, contourLayer = "contours", polygonLayer = "areas", thresholds, lineLevels, polygonLevels, elevationKey = "ele", lowerElevationKey = "lower", upperElevationKey = "upper", levelKey = "level", spotGridSpacing, spotSortOrder = "desc", spotLayer = "spot-soundings", } = options;
        // no levels means less than min zoom with levels specified
        if (!((thresholds && thresholds.length) ||
            (lineLevels && lineLevels.length) ||
            (polygonLevels && polygonLevels.length))) {
            return Promise.resolve({ arrayBuffer: new ArrayBuffer(0) });
        }
        const key = [z, x, y, encodeIndividualOptions(options)].join("/");
        return this.contourCache.get(key, (_, childAbortController) => __awaiter(this, void 0, void 0, function* () {
            const max = 1 << z;
            const neighborPromises = [];
            for (let iy = y - 1; iy <= y + 1; iy++) {
                for (let ix = x - 1; ix <= x + 1; ix++) {
                    neighborPromises.push(iy < 0 || iy >= max
                        ? undefined
                        : this.fetchDem(z, (ix + max) % max, iy, options, childAbortController, timer));
                }
            }
            const neighbors = yield Promise.all(neighborPromises);
            let virtualTile = HeightTile.combineNeighbors(neighbors);
            if (!virtualTile || isAborted(childAbortController)) {
                return { arrayBuffer: new Uint8Array().buffer };
            }
            const mark = timer === null || timer === void 0 ? void 0 : timer.marker("isoline");
            if (virtualTile.width >= subsampleBelow) {
                virtualTile = virtualTile.materialize(2);
            }
            else {
                while (virtualTile.width < subsampleBelow) {
                    virtualTile = virtualTile.subsamplePixelCenters(2).materialize(2);
                }
            }
            virtualTile = virtualTile
                .averagePixelCentersToGrid()
                .scaleElevation(multiplier)
                .materialize(1);
            const lineFeatures = [];
            const polygonFeatures = [];
            const pointFeatures = [];
            // Generate contour lines for thresholds
            if (thresholds && thresholds.length > 0) {
                const isolines = generateIsolines(thresholds[0], virtualTile, extent, buffer);
                Object.entries(isolines).forEach(([eleString, geom]) => {
                    const ele = Number(eleString);
                    lineFeatures.push({
                        type: GeomType.LINESTRING,
                        geometry: geom,
                        properties: {
                            [elevationKey]: ele,
                            [levelKey]: Math.max(...thresholds.map((l, i) => (ele % l === 0 ? i : 0))),
                        },
                    });
                });
            }
            // Generate contour lines (using marching-squares isolines for fixed levels)
            if (lineLevels && lineLevels.length > 0) {
                const isolines = generateIsolinesMS(lineLevels, virtualTile, extent, buffer);
                Object.entries(isolines).forEach(([eleString, geom]) => {
                    const ele = Number(eleString);
                    lineFeatures.push({
                        type: GeomType.LINESTRING,
                        geometry: geom,
                        properties: {
                            [elevationKey]: ele,
                        },
                    });
                });
            }
            // Generate contour polygons (using marching-squares isoBands)
            if (polygonLevels && polygonLevels.length > 0) {
                const isobands = generateIsobands(polygonLevels, virtualTile, extent, buffer);
                Object.entries(isobands).map(([rangeStr, geoms]) => {
                    // Parse range key (format: "lower:upper" to support negative values)
                    const [lower, upper] = rangeStr.split(":").map(Number);
                    geoms.map((geom) => {
                        polygonFeatures.push({
                            type: GeomType.POLYGON,
                            geometry: [geom],
                            properties: {
                                [lowerElevationKey]: lower,
                                [upperElevationKey]: upper,
                            },
                        });
                    });
                });
            }
            // Generate spot soundings
            if (spotGridSpacing) {
                const spacingInExtent = (spotGridSpacing / 512) * extent;
                const gridPoints = generateJitteredGrid(0, 0, extent, extent, spacingInExtent, x, y, z);
                for (const [px, py] of gridPoints) {
                    const tileX = Math.floor((px / extent) * virtualTile.width);
                    const tileY = Math.floor((py / extent) * virtualTile.height);
                    if (tileX >= 0 &&
                        tileX < virtualTile.width &&
                        tileY >= 0 &&
                        tileY < virtualTile.height) {
                        const elevation = virtualTile.get(tileX, tileY);
                        pointFeatures.push({
                            type: GeomType.POINT,
                            geometry: [[px, py]],
                            properties: {
                                [elevationKey]: elevation,
                            },
                        });
                    }
                }
                pointFeatures.sort((a, b) => {
                    const eleA = a.properties[elevationKey];
                    const eleB = b.properties[elevationKey];
                    return spotSortOrder === "asc" ? eleA - eleB : eleB - eleA;
                });
            }
            mark === null || mark === void 0 ? void 0 : mark();
            const layers = {};
            if (lineFeatures.length)
                layers[contourLayer] = { features: lineFeatures };
            if (polygonFeatures.length)
                layers[polygonLayer] = { features: polygonFeatures };
            if (pointFeatures.length)
                layers[spotLayer] = { features: pointFeatures };
            const result = encodeVectorTile({
                extent,
                layers,
            });
            mark === null || mark === void 0 ? void 0 : mark();
            return { arrayBuffer: copy(result.buffer) };
        }), parentAbortController);
    }
}

let id = 0;
/**
 * Utility for sending messages to a remote instance of `<T>` running in a web worker
 * from the main thread, or in the main thread running from a web worker.
 */
class Actor {
    constructor(dest, dispatcher, timeoutMs = 20000) {
        this.callbacks = {};
        this.cancels = {};
        this.dest = dest;
        this.timeoutMs = timeoutMs;
        this.dest.onmessage = (_a) => __awaiter(this, [_a], void 0, function* ({ data }) {
            const message = data;
            if (message.type === "cancel") {
                const cancel = this.cancels[message.id];
                delete this.cancels[message.id];
                cancel === null || cancel === void 0 ? void 0 : cancel.abort();
            }
            else if (message.type === "response") {
                const callback = this.callbacks[message.id];
                delete this.callbacks[message.id];
                if (callback) {
                    callback(message.error ? new Error(message.error) : undefined, message.response, message.timings);
                }
            }
            else if (message.type === "request") {
                const timer = new Timer("worker");
                // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
                const handler = dispatcher[message.name];
                const abortController = new AbortController();
                const request = handler.apply(handler, [
                    ...message.args,
                    abortController,
                    timer,
                ]);
                const url = `${message.name}_${message.id}`;
                if (message.id && request) {
                    this.cancels[message.id] = abortController;
                    try {
                        const response = yield request;
                        const transferrables = response === null || response === void 0 ? void 0 : response.transferrables;
                        this.postMessage({
                            id: message.id,
                            type: "response",
                            response,
                            timings: timer.finish(url),
                        }, transferrables);
                    }
                    catch (e) {
                        this.postMessage({
                            id: message.id,
                            type: "response",
                            error: (e === null || e === void 0 ? void 0 : e.toString()) || "error",
                            timings: timer.finish(url),
                        });
                    }
                    delete this.cancels[message.id];
                }
            }
        });
    }
    postMessage(message, transferrables) {
        this.dest.postMessage(message, transferrables || []);
    }
    /** Invokes a method by name with a set of arguments in the remote context. */
    send(name, transferrables, abortController, timer, ...args) {
        const thisId = ++id;
        const value = new Promise((resolve, reject) => {
            this.postMessage({ id: thisId, type: "request", name, args }, transferrables);
            this.callbacks[thisId] = (error, result, timings) => {
                timer === null || timer === void 0 ? void 0 : timer.addAll(timings);
                if (error)
                    reject(error);
                else
                    resolve(result);
            };
        });
        onAbort(abortController, () => {
            delete this.callbacks[thisId];
            this.postMessage({ id: thisId, type: "cancel" });
        });
        return withTimeout(this.timeoutMs, value, abortController);
    }
}

exports.A = Actor;
exports.H = HeightTile;
exports.L = LocalDemManager;
exports.T = Timer;
exports._ = __awaiter;
exports.a = decodeOptions;
exports.b = decodeParsedImage;
exports.c = generateIsobands;
exports.d = defaultDecoder;
exports.e = encodeOptions;
exports.f = generateIsolinesMS;
exports.g = getOptionsForZoom;
exports.h = generateIsolines;
exports.i = prepareContourTile;
exports.p = prepareDemTile;

}));

define(['./shared'], (function (actor) { 'use strict';

const noManager = (managerId) => Promise.reject(new Error(`No manager registered for ${managerId}`));
/**
 * Receives messages from an actor in the web worker.
 */
class WorkerDispatch {
    constructor() {
        /** There is one worker shared between all managers in the main thread using the plugin, so need to store each of their configurations. */
        this.managers = {};
        this.init = (message, _) => {
            this.managers[message.managerId] = new actor.L(message);
            return Promise.resolve();
        };
        this.fetchTile = (managerId, z, x, y, abortController, timer) => {
            var _a;
            return ((_a = this.managers[managerId]) === null || _a === void 0 ? void 0 : _a.fetchTile(z, x, y, abortController, timer)) ||
                noManager(managerId);
        };
        this.fetchAndParseTile = (managerId, z, x, y, abortController, timer) => {
            var _a;
            return actor.p(((_a = this.managers[managerId]) === null || _a === void 0 ? void 0 : _a.fetchAndParseTile(z, x, y, abortController, timer)) || noManager(managerId), true);
        };
        this.fetchContourTile = (managerId, z, x, y, options, abortController, timer) => {
            var _a;
            return actor.i(((_a = this.managers[managerId]) === null || _a === void 0 ? void 0 : _a.fetchContourTile(z, x, y, options, abortController, timer)) || noManager(managerId));
        };
    }
}

const g = typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
        ? window
        : global;
g.actor = new actor.A(g, new WorkerDispatch());

}));

define(['./shared'], (function (actor) { 'use strict';

const CONFIG = { workerUrl: "" };

let _actor;
let id = 0;
class MainThreadDispatch {
    constructor() {
        this.decodeImage = (blob, encoding, abortController) => actor.p(actor.d(blob, encoding, abortController), false);
    }
}
function defaultActor() {
    if (!_actor) {
        const worker = new Worker(CONFIG.workerUrl);
        const dispatch = new MainThreadDispatch();
        _actor = new actor.A(worker, dispatch);
    }
    return _actor;
}
/**
 * Caches, decodes, and processes raster tiles in a shared web worker.
 */
class RemoteDemManager {
    constructor(options) {
        this.fetchTile = (z, x, y, abortController, timer) => this.actor.send("fetchTile", [], abortController, timer, this.managerId, z, x, y);
        this.fetchAndParseTile = (z, x, y, abortController, timer) => this.actor.send("fetchAndParseTile", [], abortController, timer, this.managerId, z, x, y);
        this.fetchContourTile = (z, x, y, options, abortController, timer) => this.actor.send("fetchContourTile", [], abortController, timer, this.managerId, z, x, y, options);
        const managerId = (this.managerId = ++id);
        this.actor = options.actor || defaultActor();
        this.loaded = this.actor.send("init", [], new AbortController(), undefined, Object.assign(Object.assign({}, options), { managerId }));
    }
}

if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer() {
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            fileReader.onload = (event) => { var _a; return resolve((_a = event.target) === null || _a === void 0 ? void 0 : _a.result); };
            fileReader.onerror = reject;
            fileReader.readAsArrayBuffer(this);
        });
    };
}
const v3compat = (v4) => (requestParameters, arg2) => {
    if (arg2 instanceof AbortController) {
        return v4(requestParameters, arg2);
    }
    else {
        const abortController = new AbortController();
        v4(requestParameters, abortController)
            .then((result) => arg2(undefined, result.data, result.cacheControl, result.expires), (err) => arg2(err))
            .catch((err) => arg2(err));
        return { cancel: () => abortController.abort() };
    }
};
const used = new Set();
/**
 * A remote source of DEM tiles that can be connected to maplibre.
 */
class DemSource {
    constructor({ url, cacheSize = 100, id = "dem", encoding = "terrarium", maxzoom = 12, worker = true, timeoutMs = 10000, actor: actor$1, }) {
        this.timingCallbacks = [];
        /** Registers a callback to be invoked with a performance report after each tile is requested. */
        this.onTiming = (callback) => {
            this.timingCallbacks.push(callback);
        };
        /**
         * Adds contour and shared DEM protocol handlers to maplibre.
         *
         * @param maplibre maplibre global object
         */
        this.setupMaplibre = (maplibre) => {
            maplibre.addProtocol(this.sharedDemProtocolId, this.sharedDemProtocol);
            maplibre.addProtocol(this.contourProtocolId, this.contourProtocol);
        };
        /**
         * Callback to be used with maplibre addProtocol to re-use cached DEM tiles across sources.
         */
        this.sharedDemProtocolV4 = (request, abortController) => actor._(this, void 0, void 0, function* () {
            const [z, x, y] = this.parseUrl(request.url);
            const timer = new actor.T("main");
            let timing;
            try {
                const data = yield this.manager.fetchTile(z, x, y, abortController, timer);
                timing = timer.finish(request.url);
                const arrayBuffer = yield data.data.arrayBuffer();
                return {
                    data: arrayBuffer,
                    cacheControl: data.cacheControl,
                    expires: data.expires,
                };
            }
            catch (error) {
                timing = timer.error(request.url);
                throw error;
            }
            finally {
                this.timingCallbacks.forEach((cb) => cb(timing));
            }
        });
        /**
         * Callback to be used with maplibre addProtocol to generate contour vector tiles according
         * to options encoded in the tile URL pattern generated by `contourProtocolUrl`.
         */
        this.contourProtocolV4 = (request, abortController) => actor._(this, void 0, void 0, function* () {
            const timer = new actor.T("main");
            let timing;
            try {
                const [z, x, y] = this.parseUrl(request.url);
                const options = actor.a(request.url);
                const data = yield this.manager.fetchContourTile(z, x, y, actor.g(options, z), abortController, timer);
                timing = timer.finish(request.url);
                return { data: data.arrayBuffer };
            }
            catch (error) {
                timing = timer.error(request.url);
                throw error;
            }
            finally {
                this.timingCallbacks.forEach((cb) => cb(timing));
            }
        });
        this.contourProtocol = v3compat(this.contourProtocolV4);
        this.sharedDemProtocol = v3compat(this.sharedDemProtocolV4);
        /**
         * Returns a URL with the correct maplibre protocol prefix and all `option` encoded in request parameters.
         */
        this.contourProtocolUrl = (options) => `${this.contourProtocolUrlBase}?${actor.e(options)}`;
        let protocolPrefix = id;
        let i = 1;
        while (used.has(protocolPrefix)) {
            protocolPrefix = id + i++;
        }
        used.add(protocolPrefix);
        this.sharedDemProtocolId = `${protocolPrefix}-shared`;
        this.contourProtocolId = `${protocolPrefix}-contour`;
        this.sharedDemProtocolUrl = `${this.sharedDemProtocolId}://{z}/{x}/{y}`;
        this.contourProtocolUrlBase = `${this.contourProtocolId}://{z}/{x}/{y}`;
        const ManagerClass = worker ? RemoteDemManager : actor.L;
        this.manager = new ManagerClass({
            demUrlPattern: url,
            cacheSize,
            encoding,
            maxzoom,
            timeoutMs,
            actor: actor$1,
        });
    }
    getDemTile(z, x, y, abortController) {
        return this.manager.fetchAndParseTile(z, x, y, abortController || new AbortController());
    }
    parseUrl(url) {
        const [, z, x, y] = /\/\/(\d+)\/(\d+)\/(\d+)/.exec(url) || [];
        return [Number(z), Number(x), Number(y)];
    }
}

const exported = {
    generateIsolines: actor.h,
    generateIsolinesMS: actor.f,
    generateIsobandsMS: actor.c,
    DemSource,
    HeightTile: actor.H,
    LocalDemManager: actor.L,
    decodeParsedImage: actor.b,
    set workerUrl(url) {
        CONFIG.workerUrl = url;
    },
    get workerUrl() {
        return CONFIG.workerUrl;
    },
};

return exported;

}));

/* eslint-disable no-undef */

var mlcontour$1 = mlcontour;

export { mlcontour$1 as default };
