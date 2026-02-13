import java.util.*;
import java.util.regex.*;
import java.nio.file.Path;
import java.nio.file.Files;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.geo.GeometryType;
import com.onthegomap.planetiler.geo.TileCoord;
import com.onthegomap.planetiler.util.LanguageUtils;
import com.onthegomap.planetiler.VectorTile;
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

  private Set<Long> bathymetryWaterIds = new HashSet<>();

  public static void main(String[] args) throws Exception {
    var arguments = Arguments.fromArgsOrConfigFile(args).withDefault("download", true);
    String area = arguments.getString("area", "geofabrik area to download", "monaco");
    Path dataDir = Path.of("data");

    // Initialize depth calculator only if --depth parameter is provided
    String depthPath = arguments.getString("depth", "path to depth.pmtiles file", null);
    if (depthPath != null) {
      System.out.println("Loading depth data from: " + depthPath);
      Seamark.depthCalculator = new DepthCalculator(Path.of(depthPath));
      System.out.println("Depth data loaded successfully");
    }

    Seamap profile = new Seamap();
    profile.loadBathymetryIds();

    Planetiler.create(arguments)
      .setProfile(profile)
      .addOsmSource("osm", dataDir.resolve(area + ".osm.pbf"), "geofabrik:" + area)
      .addShapefileSource("land", LandPolygons.ensureLandPolygons(dataDir))
      .overwriteOutput(dataDir.resolve("seamarks.pmtiles"))
      .run();
  }

  private void loadBathymetryIds() {
    Path idFile = Path.of("water_with_bathymetry.txt");
    if (Files.exists(idFile)) {
      try {
        Files.lines(idFile)
          .map(String::trim)
          .filter(line -> !line.isEmpty())
          .mapToLong(Long::parseLong)
          .forEach(bathymetryWaterIds::add);
        System.out.println("Loaded " + bathymetryWaterIds.size() + " water IDs with bathymetry");
      } catch (Exception e) {
        System.err.println("Could not load bathymetry water IDs: " + e.getMessage());
      }
    } else {
      System.err.println("WARNING: water_with_bathymetry.txt not found, all water will be treated as no-bathymetry");
    }
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

    // Extract large water bodies (lakes, reservoirs) from OSM
    if ("osm".equals(sf.getSource()) && !sf.isPoint()) {
      var tags = sf.tags();
      String natural = (String) tags.get("natural");
      String water = (String) tags.get("water");

      if ("water".equals(natural) && sf.canBePolygon()) {
        boolean hasBathy = bathymetryWaterIds.contains(sf.id());

        // Add water body to separate layer
        FeatureCollector.Feature waterFeature = features.polygon("water");
        // Only set type if it's not "unknown"
        if (water != null) {
          waterFeature.setAttr("water", water);
        }
        // Store has_bathymetry internally for postProcessing, but don't export it to tiles
        waterFeature.setAttr("has_bathymetry", hasBathy);
        if (tags.containsKey("name")) {
          waterFeature.setAttr("name", tags.get("name"));
        }
        waterFeature.setMinZoom(4); // Adjust based on size/importance
      }
    }

    // Process seamarks
    Map<String, Object> attrs = Seamark.extractSeamarkAttributes(sf);
    String type = (String) attrs.get("type");
    String category = (String) attrs.get("category");
    if (type != null) {
      // add seamark to vector tile
      attrs.put("osm_id", sf.id());
      FeatureCollector.Feature feature = features.anyGeometry("seamark");
      attrs.forEach((k, v) -> feature.setAttr(k, v));
      feature.setMinZoom(SeamarkZoomRules.getMinZoom(attrs));

      // create label-grid for rocks, sorted by danger level
      if (type.equals("rock")) {
        String rockCategory = (String) attrs.get("category");
        int depth = attrs.get("depth") != null ? Math.round(((Number) attrs.get("depth")).floatValue()) : 0;
        int rank;
        if ("submerged".equals(rockCategory)) rank = 0; // Most dangerous: always underwater, invisible
        else if ("awash".equals(rockCategory)) rank = 10000; // Very dangerous: at wave height, barely visible
        else if ("covers".equals(rockCategory)) rank = 20000; // Dangerous: periodically submerged
        else rank = 30000; // Least dangerous: always visible (dry, always_dry, or no water_level)
        feature.setSortKey(rank + depth).setPointLabelGridSizeAndLimit(12, 32, 4);
      }

      // create label-grid for wrecks, sorted by danger level
      if (type.equals("wreck")) {
        String wreckCategory = (String) attrs.get("category");
        int depth = attrs.get("depth") != null ? Math.round(((Number) attrs.get("depth")).floatValue()) : 0;
        int rank;
        if ("dangerous".equals(wreckCategory)) rank = 0; // Most dangerous: dangerous to surface navigation
        else if ("mast_showing".equals(wreckCategory)) rank = 10000; // Very dangerous: mast visible
        else if ("hull_showing".equals(wreckCategory)) rank = 20000; // Dangerous: hull or superstructure visible
        else if ("distributed_remains".equals(wreckCategory)) rank = 30000; // Moderately dangerous: foul ground
        else rank = 40000; // Least dangerous: non-dangerous or unspecified
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
            lightFeature.setMinZoom(SeamarkZoomRules.getLightMinZoom(type));
          }
        } catch (Exception e) {
          System.err.println("Error generating light geometries for OSM ID " + sf.id() + ": " + e);
        }
      }
    }
  }

  // Temporarily disabled - may cause performance issues
  // @Override
  public Map<String, List<VectorTile.Feature>> postProcessTileFeatures(TileCoord tileCoord, Map<String, List<VectorTile.Feature>> layers) {
    List<VectorTile.Feature> landFeatures = layers.get("land");
    List<VectorTile.Feature> waterFeatures = layers.get("water");

    if (landFeatures != null && !landFeatures.isEmpty()) {
      try {
        // 1. Union all land geometries
        Geometry allLand = null;
        for (VectorTile.Feature landFeature : landFeatures) {
          Geometry geom = landFeature.geometry().decode();
          if (allLand == null) {
            allLand = geom;
          } else {
            allLand = allLand.union(geom);
          }
        }

        // 2. Union all water geometries that have bathymetry
        Geometry allWater = null;
        if (waterFeatures != null && !waterFeatures.isEmpty()) {
          for (VectorTile.Feature waterFeature : waterFeatures) {
            Object hasBathy = waterFeature.tags().get("has_bathymetry");
            // Only cut out water bodies that have bathymetry data
            if (hasBathy != null && (Boolean) hasBathy) {
              Geometry geom = waterFeature.geometry().decode();
              if (allWater == null) {
                allWater = geom;
              } else {
                allWater = allWater.union(geom);
              }
            }
          }
        }

        // 3. Subtract water with bathymetry from land
        if (allLand != null && allWater != null) {
          allLand = allLand.difference(allWater);
        }

        // 4. Replace land layer with modified land
        if (allLand != null && !allLand.isEmpty()) {
          Map<String, Object> attrs = new HashMap<>();
          VectorTile.Feature newLandFeature = new VectorTile.Feature("land", 1, VectorTile.encodeGeometry(allLand), attrs);
          layers.put("land", List.of(newLandFeature));
        }

        // 5. Keep water layer with only non-bathymetry features, remove internal attributes
        if (waterFeatures != null && !waterFeatures.isEmpty()) {
          List<VectorTile.Feature> nonBathyWater = new ArrayList<>();
          for (VectorTile.Feature waterFeature : waterFeatures) {
            Object hasBathy = waterFeature.tags().get("has_bathymetry");
            // Keep water features without bathymetry in the water layer
            if (hasBathy == null || !(Boolean) hasBathy) {
              // Remove has_bathymetry attribute before adding to output
              Map<String, Object> cleanAttrs = new HashMap<>(waterFeature.tags());
              cleanAttrs.remove("has_bathymetry");
              VectorTile.Feature cleanFeature = new VectorTile.Feature(
                waterFeature.layer(),
                waterFeature.id(),
                waterFeature.geometry(),
                cleanAttrs
              );
              nonBathyWater.add(cleanFeature);
            }
          }
          if (!nonBathyWater.isEmpty()) {
            layers.put("water", nonBathyWater);
          } else {
            layers.remove("water");
          }
        }

      } catch (Exception e) {
        // Geometry operation failed, keep original layers
        System.err.println("Error in postProcessTileFeatures for tile " + tileCoord + ": " + e.getMessage());
      }
    }

    return layers;
  }

}
