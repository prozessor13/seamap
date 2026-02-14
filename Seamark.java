import java.util.*;
import com.onthegomap.planetiler.util.Parse;
import com.onthegomap.planetiler.reader.SourceFeature;
import org.locationtech.jts.geom.Coordinate;
import java.util.regex.*;

public class Seamark {

  public static DepthCalculator depthCalculator = null;

  /**
   * Extracts all light geometries (Arcs + Rays) from OSM tags.
   *
   * @param sf SourceFeature containing OSM Tags
   * @return List of LightGeometry objects (Arcs + Rays)
   */
  public static Map<String, Object> extractSeamarkAttributes(SourceFeature sf) {
    var tags = sf.tags();
    Map<String, Object> attrs = new LinkedHashMap<>();

    // handle correct tagged seamark objects:
    if (value(tags, "seamark:type") != null) {
      String type = value(tags, "seamark:type");
      attrs.put("type", type);
      attrs.put("name", coalesce(seamarkValue(tags, type, "name"), value(tags, "seamark:name"), value(tags, "name")));
      attrs.put("reference", coalesce(seamarkValue(tags, type, "reference"), value(tags, "seamark:reference"), value(tags, "reference")));
      attrs.put("category", getSeamarkCategory(tags, type));
      attrs.put("restriction", coalesce(seamarkValue(tags, type, "restriction"), value(tags, "seamark:restriction"), value(tags, "restriction")));
      attrs.put("function", coalesce(seamarkValue(tags, type, "function"), value(tags, "seamark:function"), value(tags, "function")));
      attrs.put("water_level", coalesce(seamarkValue(tags, type, "water_level"), value(tags, "seamark:water_level"), value(tags, "water_level")));
      attrs.put("shape", seamarkValue(tags, type, "shape"));
      attrs.put("color", replaceSemiWithUnderscore(seamarkValue(tags, type, "colour")));
      attrs.put("color_pattern", seamarkValue(tags, type, "colour_pattern"));
      attrs.put("fog_signal", seamarkValue(tags, "fog_signal", "category"));
      attrs.put("radar_reflector", radarReflector(tags, type));
      attrs.put("light", seamarkLightAbbr(tags));
      attrs.put("light_color", coalesce(seamarkValue(tags, "light", "colour"), seamarkValue(tags, "light", "1:colour")));
      attrs.put("light_sequence", coalesce(seamarkValue(tags, "light", "sequence"), seamarkValue(tags, "light", "1:sequence")));
      attrs.put("light_category", coalesce(seamarkValue(tags, "light", "category"), seamarkValue(tags, "light", "1:category")));
      attrs.put("topmark_color", replaceSemiWithUnderscore(coalesce(seamarkValue(tags, "topmark", "colour"), seamarkValue(tags, "daymark", "colour"))));
      attrs.put("topmark_shape", sanitizeTopmarkShape(coalesce(seamarkValue(tags, "topmark", "shape"), seamarkValue(tags, "daymark", "shape"))));
      attrs.put("depth", Parse.parseDoubleOrNull(coalesce(seamarkValue(tags, type, "depth"), value(tags, "seamark:depth"), value(tags, "depth"))));
      attrs.put("minimum_depth", Parse.parseDoubleOrNull(coalesce(seamarkValue(tags, type, "minimum_depth"), value(tags, "seamark:minimum_depth"), value(tags, "minimum_depth"))));
      attrs.put("maximum_depth", Parse.parseDoubleOrNull(coalesce(seamarkValue(tags, type, "maximum_depth"), value(tags, "seamark:maximum_depth"), value(tags, "maximum_depth"))));

    // create semarks from normal OSM tags:
    } else if ("ferry".equals(value(tags, "route")) && sf.canBeLine()) {
      attrs.put("type", "ferry_route");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("anchor".equals(value(tags, "waterway:sign"))) {
      attrs.put("type", "anchorage");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("cable".equals(value(tags, "power")) && "underwater".equals(value(tags, "location")) && sf.canBeLine()) {
      attrs.put("type", "cable_submarine");
      attrs.put("category", "power");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("pipeline".equals(value(tags, "man_made")) && "underwater".equals(value(tags, "location")) && sf.canBeLine()) {
      attrs.put("type", "pipeline_submarine");
      attrs.put("category", value(tags, "substance"));
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("offshore_platform".equals(value(tags, "man_made"))) {
      attrs.put("type", "platform");
      attrs.put("category", "offshore_platform");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("pier".equals(value(tags, "man_made"))) {
      attrs.put("type", "shoreline_construction");
      attrs.put("category", "pier");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("groyne".equals(value(tags, "man_made"))) {
      attrs.put("type", "shoreline_construction");
      attrs.put("category", "groyne");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("breakwater".equals(value(tags, "man_made"))) {
      attrs.put("type", "shoreline_construction");
      attrs.put("category", "breakwater");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("water_tap".equals(value(tags, "man_made"))) {
      attrs.put("type", "small_craft_facility");
      attrs.put("category", "drinking_water");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("slipway".equals(value(tags, "leisure"))) {
      attrs.put("type", "small_craft_facility");
      attrs.put("category", "slipway");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("wreck".equals(value(tags, "historic"))) {
      attrs.put("type", "wreck");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if ("marina".equals(value(tags, "leisure")) && (sf.canBeLine() || sf.canBePolygon())) {
      attrs.put("type", "harbour");
      attrs.put("category", "marina");
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if (("swimming_area".equals(value(tags, "leisure")) || "nature_reserve".equals(value(tags, "leisure"))) && (sf.canBeLine() || sf.canBePolygon())) {
      attrs.put("type", "restricted_area");
      attrs.put("category", value(tags, "leisure"));
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    } else if (sf.isPoint() && ("tower".equals(value(tags, "man_made")) || "windmill".equals(value(tags, "man_made")) || "gasometer".equals(value(tags, "man_made")))) {
      attrs.put("type", "landmark");
      attrs.put("category", value(tags, "man_made"));
      attrs.put("function", value(tags, value(tags, "man_made") + ":type"));
      attrs.put("name", value(tags, "name"));
      attrs.put("reference", value(tags, "ref"));
    }

    // derive convenient helpers from attrs for the defaults logic
    String type = attrs.get("type") != null ? attrs.get("type").toString() : null;
    String category = attrs.get("category") != null ? attrs.get("category").toString() : null;

    // set defaults for shape, color, patterns, topmarks
    if ("buoy_cardinal".equals(type) || ("beacon_cardinal".equals(type) && "north".equals(category))) {
      attrs.put("shape", coalesceObj(attrs.get("shape"), "buoy_cardinal".equals(type) ? "pillar" : "pile"));
      attrs.put("color", coalesceObj(attrs.get("color"), "black_yellow"));
      attrs.put("color_pattern", coalesceObj(attrs.get("color_pattern"), "horizontal"));
      attrs.put("topmark_shape", coalesceObj(attrs.get("topmark_shape"), "2_cones_up"));
      attrs.put("topmark_color", coalesceObj(attrs.get("topmark_color"), "black"));
    } else if ("buoy_cardinal".equals(type) || ("beacon_cardinal".equals(type) && "east".equals(category))) {
      attrs.put("shape", coalesceObj(attrs.get("shape"), "buoy_cardinal".equals(type) ? "pillar" : "pile"));
      attrs.put("color", coalesceObj(attrs.get("color"), "black_yellow_black"));
      attrs.put("color_pattern", coalesceObj(attrs.get("color_pattern"), "horizontal"));
      attrs.put("topmark_shape", coalesceObj(attrs.get("topmark_shape"), "2_cones_base_together"));
      attrs.put("topmark_color", coalesceObj(attrs.get("topmark_color"), "black"));
    } else if ("buoy_cardinal".equals(type) || ("beacon_cardinal".equals(type) && "south".equals(category))) {
      attrs.put("shape", coalesceObj(attrs.get("shape"), "buoy_cardinal".equals(type) ? "pillar" : "pile"));
      attrs.put("color", coalesceObj(attrs.get("color"), "yellow_black"));
      attrs.put("color_pattern", coalesceObj(attrs.get("color_pattern"), "horizontal"));
      attrs.put("topmark_shape", coalesceObj(attrs.get("topmark_shape"), "2_cones_down"));
      attrs.put("topmark_color", coalesceObj(attrs.get("topmark_color"), "black"));
    } else if ("buoy_cardinal".equals(type) || ("beacon_cardinal".equals(type) && "west".equals(category))) {
      attrs.put("shape", coalesceObj(attrs.get("shape"), "buoy_cardinal".equals(type) ? "pillar" : "pile"));
      attrs.put("color", coalesceObj(attrs.get("color"), "yellow_black_yellow"));
      attrs.put("color_pattern", coalesceObj(attrs.get("color_pattern"), "horizontal"));
      attrs.put("topmark_shape", coalesceObj(attrs.get("topmark_shape"), "2_cones_point_together"));
      attrs.put("topmark_color", coalesceObj(attrs.get("topmark_color"), "black"));
    } else if ("buoy_isolated_danger".equals(type) || "beacon_isolated_danger".equals(type)) {
      attrs.put("shape", coalesceObj(attrs.get("shape"), "buoy_isolated_danger".equals(type) ? "pillar" : "pile"));
      attrs.put("color", coalesceObj(attrs.get("color"), "red_black_red"));
      attrs.put("color_pattern", coalesceObj(attrs.get("color_pattern"), "horizontal"));
      attrs.put("topmark_shape", coalesceObj(attrs.get("topmark_shape"), "2_spheres"));
      attrs.put("topmark_color", coalesceObj(attrs.get("topmark_color"), "black"));
    } else if ("buoy_safe_water".equals(type) || "beacon_safe_water".equals(type)) {
      attrs.put("shape", coalesceObj(attrs.get("shape"), "buoy_safe_water".equals(type) ? "pillar" : "pile"));
      attrs.put("color", coalesceObj(attrs.get("color"), "red_white"));
      attrs.put("color_pattern", coalesceObj(attrs.get("color_pattern"), "vertical"));
      attrs.put("topmark_shape", coalesceObj(attrs.get("topmark_shape"), "sphere"));
      attrs.put("topmark_color", coalesceObj(attrs.get("topmark_color"), "red"));
    } else if ("buoy_special_purpose".equals(type) || "beacon_special_purpose".equals(type)) {
      attrs.put("shape", coalesceObj(attrs.get("shape"), "buoy_special_purpose".equals(type) ? "pillar" : "pile"));
      attrs.put("color", coalesceObj(attrs.get("color"), "yellow"));
    }
    if (type != null && type.startsWith("beacon_")) attrs.put("shape", coalesceObj(attrs.get("shape"), "pile"));
    if (type != null && type.startsWith("buoy_")) attrs.put("shape", coalesceObj(attrs.get("shape"), "pillar"));
    if (attrs.get("shape") != null && "pile".equals(attrs.get("shape").toString())) attrs.put("shape", "buoyant");
    if (attrs.get("color") != null && attrs.get("color").toString().contains("_")) attrs.put("color_pattern", coalesceObj(attrs.get("color_pattern"), "horizontal"));

    // rocks/wrecks: fill missing depth values
    if (("wreck".equals(type) || "rock".equals(type)) && attrs.get("depth") == null) {
      try {
        org.locationtech.jts.geom.Point centroid = (org.locationtech.jts.geom.Point) sf.centroid();
        if (depthCalculator != null && centroid != null) {
          Coordinate coord = centroid.getCoordinate();
          attrs.put("depth", depthCalculator.getDepthAtLocation(coord));
        }
      } catch(Exception e) {}
    }

    return attrs;
  }

  private static String value(Map<String, Object> tags, String key) {
    Object val = tags.get(key);
    if (val == null) return null;
    String valStr = val.toString();
    if (valStr.isEmpty()) return null;
    return valStr;
  }

  private static String seamarkValue(Map<String, Object> tags, String type, String subtype) {
    return value(tags, "seamark:" + type + ":" + subtype);
  }

  private static String coalesce(String... vals) {
    for (String v: vals) {
      if (v != null && !v.isEmpty()) return v;
    }
    return null;
  }

  private static String coalesceObj(Object... vals) {
    for (Object o : vals) {
      if (o == null) continue;
      String s = o instanceof String ? (String) o : o.toString();
      if (s != null && !s.isEmpty()) return s;
    }
    return null;
  }

  private static String replaceSemiWithUnderscore(String v) {
    if (v == null) return null;
    return v.replace(";", "_");
  }

  private static String sanitizeTopmarkShape(String v) {
    if (v == null) return null;
    String out = v.replace(",", "");
    out = out.replace(" ", "_");
    return out;
  }

  private static String radarReflector(Map<String,Object> tags, String type) {
    String reflector = value(tags, "seamark:radar_reflector");
    String reflectivity = seamarkValue(tags, type, "reflectivity");
    String transponder = seamarkValue(tags, "radar_transponder", "category");
    if ("yes".equals(reflector)) {
      return "yes";
    } else if ("conspicuous".equals(reflectivity) || "reflector".equals(reflectivity)) {
      return reflectivity;
    } else if (transponder != null) {
      return transponder;
    } else {
      return null;
    }
  }

  private static String seamarkLightAbbr(Map<String,Object> tags) {
    String color = "";
    String group = null;
    String character = null;
    Double range = 0.0;
    String period = null;
    String height = null;

    // Single light definition
    if (tags.containsKey("seamark:light:colour")) {
      color = seamarkValue(tags, "light", "colour");
      group = seamarkValue(tags, "light", "group");
      character = seamarkValue(tags, "light", "character");
      range = Parse.parseDoubleOrNull(seamarkValue(tags, "light", "range"));
      period = seamarkValue(tags, "light", "period");
      height = seamarkValue(tags, "light", "height");

    // Collect all seamark:light:<n>:colour and :range
    } else if (tags.containsKey("seamark:light:1:colour")) {
      Pattern p = Pattern.compile("^seamark:light:(\\d+):colour$");
      for (Map.Entry<String,Object> e : tags.entrySet()) {
        Matcher m = p.matcher(e.getKey());
        if (m.matches()) {
          String idx = m.group(1);
          String _color = seamarkValue(tags, "light", idx + ":colour");
          if (_color == null) continue;
          Double _range = Parse.parseDoubleOrNull(seamarkValue(tags, "light", idx + ":range"));
          if (_range != null && _range > range) range = _range;
          color = color + _color.substring(0,1).toUpperCase();
        }
      }
      // Collect other common attributes from light:1
      group = seamarkValue(tags, "light", "1:group");
      character = seamarkValue(tags, "light", "1:character");
      period = seamarkValue(tags, "light", "1:period");
      height = seamarkValue(tags, "light", "1:height");
    }

    // Build abbreviation
    if (color.isEmpty()) return null;
    StringBuilder sb = new StringBuilder();
    if (character != null) sb.append(character);
    if (group != null) sb.append("(").append(group).append(")");
    else sb.append(".");
    sb.append(color.substring(0,1).toUpperCase());
    sb.append(".");
    if (period != null) sb.append(period).append("s");
    if (height != null) sb.append(height).append("m");
    if (range != null && range > 0) sb.append(Math.round(range)).append("M");
    return sb.toString();
  }

  // Based on https://wiki.openstreetmap.org/wiki/Seamarks/Seamark_Objects
  private static String getSeamarkCategory(Map<String, Object> tags, String type) {
    if ("seabed_area".equals(type)) {
      return seamarkValue(tags, type, "surface");
    } else if ("wreck".equals(type)) {
      String category = seamarkValue(tags, type, "category");
      if (category == null) { // Fallback: derive category from water_level if category is not set
        String waterLevel = seamarkValue(tags, "wreck", "water_level");
        if ("submerged".equals(waterLevel) || "awash".equals(waterLevel) || "covers".equals(waterLevel)) {
          category = "dangerous";
        } else if ("always_dry".equals(waterLevel) || "dry".equals(waterLevel)) {
          category = "hull_showing";
        }
      }
      return category;
    } else if ("pipeline_submarine".equals(type)) {
      return coalesce(
        seamarkValue(tags, "pipeline_submarine", "category"),
        seamarkValue(tags, "pipeline_submarine", "product")
      );
    } else {
      return coalesce(seamarkValue(tags, type, "category"), value(tags, "seamark:category"), value(tags, "category"));
    }
  }

}
