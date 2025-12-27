import java.util.*;
import java.util.regex.*;
import java.nio.file.Path;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.geo.GeometryType;
import com.onthegomap.planetiler.util.LanguageUtils;
import org.locationtech.jts.geom.*;

/**
 * Seamap.java
 *
 * Mapping logic:
 *   • seamark:* objects directly (buoys, beacons, lights, etc.)
 *   • additional derivations:
 *        - route=ferry => type=ferry_route (linestring)
 *        - waterway:sign=anchor => anchorage (point/line/polygon)
 *        - power=cable location=underwater => cable_submarine
 *        - man_made=pipeline location=underwater => pipeline_submarine
 *        - man_made=pier => mooring category=pier (point/line/polygon)
 *        - leisure=marina => harbour category=marina (line/polygon)
 *        - leisure in (swimming_area,nature_reserve) => restricted_area
 *        - man_made=tower/lighthouse/... => landmark or lighthouse
 *
 * Attributes per feature:
 *   osm_id, type, name, reference, function, category, shape,
 *   color, color_pattern, light, light_color, light_sequence,
 *   topmark_color, topmark_shape
 *
 * Note:
 * - For polygons we additionally generate a label with a PointOnSurface equivalent
 */
public class Seamap implements Profile {

  public static void main(String[] args) throws Exception {
    var arguments = Arguments.fromArgsOrConfigFile(args).withDefault("download", true);
    String area = arguments.getString("area", "geofabrik area to download", "monaco");
    Path dataDir = Path.of("data");

    Seamark.depthCalculator = new DepthCalculator(dataDir.resolve("depth.pmtiles"));

    Planetiler.create(arguments)
      .setProfile(new Seamap())
      .addOsmSource("osm", dataDir.resolve(area + ".osm.pbf"), "geofabrik:" + area)
      .addShapefileSource("land", LandPolygons.ensureLandPolygons(dataDir))
      .overwriteOutput(dataDir.resolve("seamarks.pmtiles"))
      .run();
  }

  @Override
  public String name() {
    return "seamap";
  }

  @Override
  public void processFeature(SourceFeature sf, FeatureCollector features) {
    // Process land polygons from shapefile
    if (!sf.isPoint() && "land".equals(sf.getSource())) {
      LandPolygons.processLandFeature(sf, features);
      return;
    }

    // Process seamarks from OSM
    Map<String, Object> attrs = Seamark.extractSeamarkAttributes(sf);
    String type = (String) attrs.get("type");
    if (type != null) {
      boolean isLightMajor = type.equals("light_major");
      boolean isLightMinor = type.equals("light_minor");
      boolean isSeparationZone = type.startsWith("separation_");
      boolean isPlatform = type.equals("platform");
      boolean isSafeWater = type.contains("_safe_water");
      boolean isIsoltedDanger = type.contains("_isolated_danger");
      boolean isCardinal = type.contains("_cardinal");
      boolean isFogSignal = type.equals("fog_signal");
      boolean isRestricted = Arrays.asList(
        "anchorage",
        "cable_area",
        "fairway",
        "inshore_traffic_zone",
        "marine_farm",
        "military_area",
        "protected_area",
        "restricted_area",
        "production_area",
        "pipeline_area",
        "precautionary_area",
        "seaplane_landing_area",
        "submarine_transit_lane"
      ).contains(type);

      // add seamark to vector tile
      attrs.put("osm_id", sf.id());
      FeatureCollector.Feature feature = features.anyGeometry("seamark");
      attrs.forEach((k, v) -> feature.setAttr(k, v));

      // Set zoom range based on type:
      if (isLightMajor || isLightMinor || isSeparationZone || isRestricted || isPlatform || isFogSignal) {
        feature.setMinZoom(4);
      } else if (isSafeWater || isIsoltedDanger || isCardinal) {
        feature.setMinZoom(6);
      } else {
        feature.setMinZoom(8);
      }

      // create label-grid for rocks, sorted by danger level
      if (type.equals("rock")) {
        String category = (String) attrs.get("category");
        int depth = attrs.get("depth") != null ? Math.round(((Number) attrs.get("depth")).floatValue()) : 0;
        int rank;
        if ("submerged".equals(category)) {
          rank = 0; // Most dangerous: always underwater, invisible
        } else if ("awash".equals(category)) {
          rank = 10000; // Very dangerous: at wave height, barely visible
        } else if ("covers".equals(category)) {
          rank = 20000; // Dangerous: periodically submerged
        } else {
          rank = 30000; // Least dangerous: always visible (dry, always_dry, or no water_level)
        }
        feature.setSortKey(rank + depth).setPointLabelGridSizeAndLimit(12, 32, 4);
      }

      // create label-grid for wrecks, sorted by danger level
      if (type.equals("wreck")) {
        String category = (String) attrs.get("category");
        int depth = attrs.get("depth") != null ? Math.round(((Number) attrs.get("depth")).floatValue()) : 0;
        int rank;
        if ("dangerous".equals(category)) {
          rank = 0; // Most dangerous: dangerous to surface navigation
        } else if ("mast_showing".equals(category)) {
          rank = 10000; // Very dangerous: mast visible
        } else if ("hull_showing".equals(category)) {
          rank = 20000; // Dangerous: hull or superstructure visible
        } else if ("distributed_remains".equals(category)) {
          rank = 30000; // Moderately dangerous: foul ground
        } else {
          rank = 40000; // Least dangerous: non-dangerous or unspecified
        }
        feature.setSortKey(rank + depth).setPointLabelGridSizeAndLimit(12, 16, 1);
      }

      // add sector-lights (Arcs und Rays) to vector tile
      if (sf.tags().containsKey("seamark:light:1:colour")) {
        try {
          List<Lights.LightGeometry> lightGeometries = Lights.extractLightGeometries(sf, type);
          for (Lights.LightGeometry lightGeom : lightGeometries) {
            FeatureCollector.Feature lightFeature = features.geometry("light", lightGeom.geometry);
            lightFeature.setAttr("osm_id", sf.id());
            lightFeature.setAttr("type", type);
            lightGeom.attrs.forEach((k, v) -> lightFeature.setAttr(k, v));

            // Light sectors follow the same zoom logic as their parent seamark
            if (isLightMajor || isLightMinor) {
              lightFeature.setMinZoom(6);
            } else {
              lightFeature.setMinZoom(8);
            }
          }
        } catch (Exception e) {
          System.err.println("Error generating light geometries for OSM ID " + sf.id() + ": " + e);
        }
      }
    }
  }

}
