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
      // add seamark to vector tile
      attrs.put("osm_id", sf.id());
      FeatureCollector.Feature feature = features.anyGeometry("seamark");
      attrs.forEach((k, v) -> feature.setAttr(k, v));

      // add sector-lights (Arcs und Rays) to vector tile
      if (sf.tags().containsKey("seamark:light:1:colour")) {
        try {
          List<Lights.LightGeometry> lightGeometries = Lights.extractLightGeometries(sf, type);
          for (Lights.LightGeometry lightGeom : lightGeometries) {
            FeatureCollector.Feature lightFeature = features.geometry("light", lightGeom.geometry);
            lightFeature.setAttr("osm_id", sf.id());
            lightFeature.setAttr("type", type);
            lightGeom.attrs.forEach((k, v) -> lightFeature.setAttr(k, v));
          }
        } catch (Exception e) {
          System.err.println("Error generating light geometries for OSM ID " + sf.id() + ": " + e);
        }
      }
    }
  }

}
