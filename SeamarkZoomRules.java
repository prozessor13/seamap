import java.util.*;

/**
 * SeamarkZoomRules
 *
 * Defines at which zoom levels different types of seamarks should be visible.
 * This centralizes all zoom-related logic for seamarks.
 */
public class SeamarkZoomRules {

  /**
   * Get the minimum zoom level for a given seamark based on its type and attributes.
   *
   * @param attrs Map containing seamark attributes (type, category, etc.)
   * @return minimum zoom level (0-14)
   */
  public static int getMinZoom(Map<String, Object> attrs) {
    String type = (String) attrs.get("type");
    String category = (String) attrs.get("category");

    if (type == null) {
      return 8; // default
    }

    // High priority features visible from zoom 4
    if (isHighPriorityType(type)) {
      return 4;
    }

    // Medium-high priority features visible from zoom 6
    if (isMediumHighPriorityType(type, category)) {
      return 6;
    }

    // Default: visible from zoom 8
    return 8;
  }

  /**
   * Get the minimum zoom level for light sectors/geometries.
   *
   * @param type The type of the parent seamark
   * @return minimum zoom level for the light geometry
   */
  public static int getLightMinZoom(String type) {
    if ("light_major".equals(type) || "light_minor".equals(type)) {
      return 6;
    }
    return 8;
  }

  /**
   * Check if a seamark type is high priority (visible from zoom 4).
   */
  private static boolean isHighPriorityType(String type) {
    return type.equals("light_major") ||
           type.equals("light_minor") ||
           type.startsWith("separation_") ||
           type.equals("platform") ||
           type.equals("fog_signal") ||
           isRestrictedArea(type);
  }

  /**
   * Check if a seamark type is medium-high priority (visible from zoom 6).
   */
  private static boolean isMediumHighPriorityType(String type, String category) {
    if (type.contains("_safe_water") ||
        type.contains("_isolated_danger") ||
        type.contains("_cardinal")) {
      return true;
    }

    // Dangerous wrecks
    if (type.equals("wreck") && isDangerousWreck(category)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a type represents a restricted area.
   */
  private static boolean isRestrictedArea(String type) {
    return Arrays.asList(
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
  }

  /**
   * Check if a wreck category is considered dangerous.
   */
  private static boolean isDangerousWreck(String category) {
    return Arrays.asList("dangerous", "mast_showing").contains(category);
  }
}
