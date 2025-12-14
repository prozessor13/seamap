import java.util.*;
import org.locationtech.jts.geom.*;
import com.onthegomap.planetiler.reader.SourceFeature;

/**
 * Creates light sector geometries (Arcs and Rays) from OSM Seamark data.
 * - Light Arcs: Arcs for each color sector
 * - Light Rays: Rays at sector boundaries
 */
public class Lights {

    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory();
    // In Planetiler normalized coordinates: 1.0 = entire world width
    private static final double WORLD_WIDTH_METERS = 2.0 * Math.PI * 6378137.0;  // ~40075017m
    // Radii in meters (derived from nautical miles * 1852)
    private static final double MINOR_ARC_RADIUS = 0.4 * 1852;  // ~741m
    private static final double MAJOR_ARC_RADIUS = 0.7 * 1852;  // ~1296m
    private static final double MINOR_RAY_RADIUS = 1.2 * 1852;  // ~2222m
    private static final double MAJOR_RAY_RADIUS = 2.5 * 1852;  // ~4630m

    public static class LightGeometry {
        public final Geometry geometry;
        public final Map<String, Object> attrs;

        public LightGeometry(String subtype, String color, String range, Integer sectorStart, Integer sectorEnd, Geometry geometry) {
            this.geometry = geometry;
            this.attrs = new HashMap<>();
            attrs.put("subtype", subtype);
            if (color != null) attrs.put("color", color);
            if (range != null) attrs.put("range", range);
            if (sectorStart != null) attrs.put("sector_start", sectorStart);
            if (sectorEnd != null) attrs.put("sector_end", sectorEnd);
        }
    }

    /**
     * Extracts all light geometries (Arcs + Rays) from OSM tags.
     *
     * @param sf SourceFeature containing OSM Tags
     * @param seamarkType The seamark:type (e.g. "light_minor" or "light_major")
     * @return List of LightGeometry objects (Arcs + Rays)
     */
    public static List<LightGeometry> extractLightGeometries(SourceFeature sf, String seamarkType) {
        List<LightGeometry> results = new ArrayList<>();
        Map<Integer, Map<String, String>> segments = parseLightSegments(sf.tags());
        if (segments.isEmpty()) return results;

        boolean isMajor = "light_major".equals(seamarkType);
        double arcRadius = isMajor ? MAJOR_ARC_RADIUS : MINOR_ARC_RADIUS;
        double rayRadius = isMajor ? MAJOR_RAY_RADIUS : MINOR_RAY_RADIUS;
        Point center;
        try {
            center = sf.worldGeometry().getCentroid();
        } catch (Exception e) {
            return results;
        }

        // 1. Create Arc geometries for each sector
        for (Map.Entry<Integer, Map<String, String>> entry : segments.entrySet()) {
            Map<String, String> segment = entry.getValue();
            String color = segment.get("colour");
            String range = segment.get("range");
            int sectorStart = parseIntOrDefault(segment.get("sector_start"), 0);
            int sectorEnd = parseIntOrDefault(segment.get("sector_end"), 360);
            Geometry arc = createLightArc(center, sectorStart, sectorEnd, arcRadius);
            results.add(new LightGeometry("arc", color, range, sectorStart, sectorEnd, arc));
        }

        // 2. Create Ray geometries at sector boundaries
        Map<Double, String> angleToRange = new HashMap<>();
        for (Map<String, String> segment : segments.values()) {
            String sectorStartStr = segment.get("sector_start");
            String sectorEndStr = segment.get("sector_end");
            // Only create rays if sector boundaries are explicitly defined
            if (sectorStartStr != null) {
                angleToRange.put(parseDoubleOrDefault(sectorStartStr, 0.0), segment.get("range"));
            }
            if (sectorEndStr != null) {
                angleToRange.put(parseDoubleOrDefault(sectorEndStr, 360.0), segment.get("range"));
            }
        }
        for (Map.Entry<Double, String> entry : angleToRange.entrySet()) {
            LineString ray = createLightRay(center, entry.getKey(), rayRadius);
            results.add(new LightGeometry("ray", null, entry.getValue(), null, null, ray));
        }

        return results;
    }

    private static Map<Integer, Map<String, String>> parseLightSegments(Map<String, Object> tags) {
        Map<Integer, Map<String, String>> segments = new HashMap<>();
        for (Map.Entry<String, Object> entry : tags.entrySet()) {
            String key = entry.getKey();
            if (!key.startsWith("seamark:light:")) continue;
            String[] parts = key.substring("seamark:light:".length()).split(":", 2);
            if (parts.length != 2) continue;
            try {
                int segmentNum = Integer.parseInt(parts[0]);
                String attrName = parts[1];
                String attrValue = entry.getValue() != null ? entry.getValue().toString() : null;
                segments.computeIfAbsent(segmentNum, k -> new HashMap<>()).put(attrName, attrValue);
            } catch (NumberFormatException ignored) {
                System.err.println("Warning: Could not parse light segment number from tag: " + key + " = " + entry.getValue());
            }
        }

        return segments;
    }

    private static LineString createLightArc(Point center, int from, int to, double radiusMeters) {
        while (to < from) to += 360;
        List<Coordinate> coords = new ArrayList<>();
        for (double d = from; d <= to; d += 0.1) {
            double rad = Math.toRadians(d);
            double x = center.getX() - radiusMeters / WORLD_WIDTH_METERS * Math.sin(rad);
            double y = center.getY() + radiusMeters / WORLD_WIDTH_METERS * Math.cos(rad);
            coords.add(new Coordinate(x, y));
        }
        return GEOMETRY_FACTORY.createLineString(coords.toArray(new Coordinate[0]));
    }

    private static LineString createLightRay(Point center, double deg, double radiusMeters) {
        double rad = Math.toRadians(deg);
        double x = center.getX() - radiusMeters / WORLD_WIDTH_METERS * Math.sin(rad);
        double y = center.getY() + radiusMeters / WORLD_WIDTH_METERS * Math.cos(rad);
        Coordinate[] coords = new Coordinate[] { center.getCoordinate(), new Coordinate(x, y) };
        return GEOMETRY_FACTORY.createLineString(coords);
    }

    private static int parseIntOrDefault(String str, int defaultValue) {
        try {
            return (int) Math.floor(Double.parseDouble(str));
        } catch (Exception e) {
            return defaultValue;
        }
    }

    private static double parseDoubleOrDefault(String str, double defaultValue) {
        try {
            return Double.parseDouble(str);
        } catch (Exception e) {
            return defaultValue;
        }
    }
}
