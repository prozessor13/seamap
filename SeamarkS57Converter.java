import java.util.*;

/**
 * Konvertiert OSM Seamark Tags zu S-57 Objekten und Attributen.
 * Vollständig basierend auf IHO S-57 Standard Edition 3.1 und
 * https://wiki.openstreetmap.org/wiki/Seamarks/Seamark_Objects
 *
 * Verwendung:
 * Map<String, Object> tags = sourceFeature.tags();
 * S57Result result = SeamarkS57Converter.convertFromObjectTags(tags);
 * if (result != null) {
 *     String objCode = result.getObjectCode(); // z.B. "BOYLAT"
 *     Map<String, String> attrs = result.getAttributes();
 * }
 */
public class SeamarkS57Converter {

    // OSM seamark:type zu S-57 Object Code (Akronym)
    private static final Map<String, String> OBJECT_CODES = createObjectCodes();

    // OSM Attribut-Namen zu S-57 Attribut Akronym
    private static final Map<String, String> ATTRIBUTE_CODES = createAttributeCodes();

    // S-57 COLOUR Enumeration (1-13)
    private static final Map<String, Integer> COLOUR_VALUES = createColourValues();

    /**
     * Konvertiert OSM Tags (Map<String, Object>) zu S-57 Codes.
     * Wrapper-Methode für direkte Verwendung mit Planetiler SourceFeature.tags()
     */
    public static S57Result convertFromObjectTags(Map<String, Object> tags) {
        return convert(toStringTags(tags));
    }

    /**
     * Konvertiert OSM Tags zu S-57 Codes.
     * Leitet seamark:type aus verschiedenen OSM Tags ab falls nicht direkt vorhanden.
     */
    public static S57Result convert(Map<String, String> tags) {
        // Zuerst prüfen ob seamark:type direkt vorhanden ist
        String seamarkType = tags.get("seamark:type");

        // Falls nicht, aus anderen OSM Tags ableiten
        if (seamarkType == null || seamarkType.isEmpty()) {
            seamarkType = deriveSeamarkTypeFromOSM(tags);
        }

        if (seamarkType == null || seamarkType.isEmpty()) {
            return null;
        }

        String objectCode = OBJECT_CODES.get(seamarkType);
        if (objectCode == null) {
            return null;
        }

        Map<String, String> attributes = new HashMap<>();
        String prefix = "seamark:" + seamarkType + ":";

        for (Map.Entry<String, String> tag : tags.entrySet()) {
            String key = tag.getKey();
            String value = tag.getValue();

            // Parse "seamark:type:attribute" Pattern
            if (key.startsWith(prefix)) {
                String attrName = key.substring(prefix.length());
                String attrCode = ATTRIBUTE_CODES.get(attrName);
                if (attrCode != null) {
                    // Farben codieren
                    if (attrCode.equals("COLOUR") || attrCode.equals("COLPAT")) {
                        value = encodeColour(value);
                    }
                    attributes.put(attrCode, value);
                }
            }
            // Generische seamark: Attribute
            else if (key.startsWith("seamark:") && !key.equals("seamark:type")) {
                String attrName = key.substring(8);
                if (!attrName.contains(":")) {
                    String attrCode = ATTRIBUTE_CODES.get(attrName);
                    if (attrCode != null) {
                        if (attrCode.equals("COLOUR") || attrCode.equals("COLPAT")) {
                            value = encodeColour(value);
                        }
                        attributes.put(attrCode, value);
                    }
                }
            }
        }

        return new S57Result(seamarkType, objectCode, attributes);
    }

    /**
     * Leitet seamark:type aus normalen OSM Tags ab (wenn seamark:type nicht vorhanden).
     * Entspricht der Mapping-Logik in Seamap.java.
     */
    private static String deriveSeamarkTypeFromOSM(Map<String, String> tags) {
        String route = tags.get("route");
        String waterwaySign = tags.get("waterway:sign");
        String power = tags.get("power");
        String location = tags.get("location");
        String manMade = tags.get("man_made");
        String leisure = tags.get("leisure");

        // route=ferry => ferry_route
        if ("ferry".equals(route)) {
            return "ferry_route";
        }

        // waterway:sign=anchor => anchorage
        if ("anchor".equals(waterwaySign)) {
            return "anchorage";
        }

        // power=cable location=underwater => cable_submarine
        if ("cable".equals(power) && "underwater".equals(location)) {
            return "cable_submarine";
        }

        // man_made=pipeline location=underwater => pipeline_submarine
        if ("pipeline".equals(manMade) && "underwater".equals(location)) {
            return "pipeline_submarine";
        }

        // man_made=pier => pier (S57: SLCONS for pier structures)
        if ("pier".equals(manMade)) {
            return "pier";
        }

        // leisure=marina => harbour
        if ("marina".equals(leisure)) {
            return "harbour";
        }

        // leisure=swimming_area or nature_reserve => restricted_area
        if ("swimming_area".equals(leisure) || "nature_reserve".equals(leisure)) {
            return "restricted_area";
        }

        // man_made=tower => landmark
        if ("tower".equals(manMade) || "windmill".equals(manMade) || "gasometer".equals(manMade)) {
            return "landmark";
        }

        return null;
    }

    /**
     * Codiert Farben von OSM-Namen zu S-57 Integer-Codes
     */
    private static String encodeColour(String osmColour) {
        if (osmColour == null || osmColour.isEmpty()) {
            return osmColour;
        }

        // Mehrere Farben (komma-separiert)
        if (osmColour.contains(";")) {
            String[] colours = osmColour.split(";");
            StringBuilder encoded = new StringBuilder();
            for (int i = 0; i < colours.length; i++) {
                Integer code = COLOUR_VALUES.get(colours[i].trim().toLowerCase());
                if (code != null) {
                    if (i > 0) encoded.append(",");
                    encoded.append(code);
                }
            }
            return encoded.toString();
        }

        // Einzelne Farbe
        Integer code = COLOUR_VALUES.get(osmColour.toLowerCase());
        return code != null ? String.valueOf(code) : osmColour;
    }

    /**
     * S-57 COLOUR attribute values (Code 75)
     */
    private static Map<String, Integer> createColourValues() {
        Map<String, Integer> map = new HashMap<>();
        map.put("white", 1);
        map.put("black", 2);
        map.put("red", 3);
        map.put("green", 4);
        map.put("blue", 5);
        map.put("yellow", 6);
        map.put("grey", 7);
        map.put("gray", 7);  // US spelling
        map.put("brown", 8);
        map.put("amber", 9);
        map.put("violet", 10);
        map.put("orange", 11);
        map.put("magenta", 12);
        map.put("pink", 13);
        return Collections.unmodifiableMap(map);
    }

    /**
     * Vollständiges Mapping von OSM seamark:type zu S-57 Object Acronym
     */
    private static Map<String, String> createObjectCodes() {
        Map<String, String> map = new HashMap<>();

        // Buoys
        map.put("buoy_lateral", "BOYLAT");
        map.put("buoy_cardinal", "BOYCAR");
        map.put("buoy_isolated_danger", "BOYISD");
        map.put("buoy_safe_water", "BOYSAW");
        map.put("buoy_special_purpose", "BOYSPP");
        map.put("buoy_installation", "BOYINB");
        map.put("buoy_emergency_wreck_marking", "BOYINB"); // Emergency wreck marking buoy

        // Beacons
        map.put("beacon_lateral", "BCNLAT");
        map.put("beacon_cardinal", "BCNCAR");
        map.put("beacon_isolated_danger", "BCNISD");
        map.put("beacon_safe_water", "BCNSAW");
        map.put("beacon_special_purpose", "BCNSPP");

        // Lights
        map.put("light_major", "LIGHTS");
        map.put("light_minor", "LITMIN");
        map.put("light_float", "LITFLT");
        map.put("light_vessel", "LITVES");
        map.put("light", "LIGHTS");  // Generic light

        // Landmarks
        map.put("landmark", "LNDMRK");
        map.put("lighthouse", "LIGHTS");

        // Marine structures
        map.put("harbour", "HRBARE");
        map.put("harbour_basin", "HRBBSN");
        map.put("anchorage", "ACHARE");
        map.put("berth", "BERTHS");
        map.put("dock", "HRBARE");
        map.put("pontoon", "PONTON");
        map.put("pier", "SLCONS");
        map.put("gate", "GATCON");
        map.put("lock_basin", "LOKBSN");
        map.put("mooring", "MORFAC");
        map.put("mooring_buoy", "MORFAC");
        map.put("dolphin", "MORFAC");  // Mooring dolphin

        // Navigation
        map.put("notice", "NOTMRK");
        map.put("distance_mark", "DISMAR");
        map.put("separation_line", "TSELNE");
        map.put("separation_zone", "TSEZNE");
        map.put("separation_boundary", "TSSBND");  // Traffic Separation Scheme Boundary
        map.put("separation_crossing", "TSSCRS");  // Traffic Separation Scheme Crossing
        map.put("separation_roundabout", "TSEZNE"); // Traffic Separation Roundabout
        map.put("fairway", "FAIRWY");
        map.put("recommended_track", "RCRTCL");
        map.put("radar_station", "RADSTA");
        map.put("radio_station", "RDOSTA");
        map.put("signal_station_traffic", "SISTAT");
        map.put("signal_station_warning", "SISTAT");
        map.put("signal_station_port", "SISTAT");
        map.put("virtual_aton", "VEHATN");  // Virtual AtoN (Aids to Navigation)

        // Obstructions
        map.put("obstruction", "OBSTRN");
        map.put("rock", "UWTROC");
        map.put("wreck", "WRECKS");
        map.put("hulk", "HULKES");
        map.put("foul_ground", "FOULGD");  // Foul ground

        // Areas
        map.put("restricted_area", "RESARE");
        map.put("military_area", "MIPARE");
        map.put("production_area", "PRCARE");
        map.put("anchorage_area", "ACHARE");
        map.put("fairway_area", "FAIRWY");
        map.put("seabed_area", "SBDARE");
        map.put("sea_area", "SEAARE");
        map.put("dumping_ground", "DMPGRD");
        map.put("caution_area", "CTNARE");
        map.put("fishing_ground", "FSHGRD");
        map.put("marine_management", "MIPARE");  // Marine protected area
        map.put("precautionary_area", "PRCARE");
        map.put("inshore_traffic_zone", "ISTZNE");  // Inshore traffic zone

        // Infrastructure
        map.put("bridge", "BRIDGE");
        map.put("building", "BUISGL");
        map.put("cable_submarine", "CBLSUB");
        map.put("cable_overhead", "CBLOHD");
        map.put("cable_area", "CBLARE");  // Cable area
        map.put("pipeline_submarine", "PIPSOL");
        map.put("pipeline_overhead", "PIPOHD");
        map.put("pipeline_area", "PIPARE");  // Pipeline area
        map.put("pile", "PILPNT");
        map.put("pylon", "PYLONS");
        map.put("offshore_platform", "OFSPLF");
        map.put("platform", "OFSPLF");
        map.put("tunnel", "TUNNEL");
        map.put("wall", "SLCONS");
        map.put("dyke", "DYKCON");
        map.put("dam", "DAMCON");
        map.put("weir", "DAMCON");
        map.put("slipway", "SLCONS");
        map.put("gridiron", "GRIDRN");  // Gridiron (ship repair grid)
        map.put("dry_dock", "DRYDOC");
        map.put("floating_dock", "FLODOC");

        // Natural features
        map.put("shoreline_construction", "SLCONS");
        map.put("coastline", "COALNE");
        map.put("lake", "LAKARE");
        map.put("river", "RIVERS");
        map.put("canal", "CANALS");
        map.put("spring", "SPRING");
        map.put("vegetation", "VEGATN");
        map.put("land_area", "LNDARE");
        map.put("land_region", "LNDELV");
        map.put("rapids", "RAPIDS");
        map.put("waterfall", "WATFAL");
        map.put("tideway", "TIDEWY");  // Tideway
        map.put("current", "CURENT");  // Current
        map.put("water_turbulence", "WATTUR");  // Water turbulence

        // Marine farm and fishing
        map.put("marine_farm", "MARCUL");
        map.put("fishing_facility", "FSHFAC");

        // Historical and military
        map.put("fortified_structure", "FORSTC");
        map.put("military_practice_area", "MIPARE");

        // Transport
        map.put("ferry_route", "FERYRT");
        map.put("cable_ferry", "FERYRT");
        map.put("ferry_terminal", "FSHFAC");

        // Depth contours and soundings
        map.put("depth_contour", "DEPARE");
        map.put("depth_area", "DEPARE");
        map.put("sounding", "SOUNDG");
        map.put("dredged_area", "DRGARE");  // Dredged area
        map.put("unsurveyed_area", "UNSARE");  // Unsurveyed area

        // Other
        map.put("small_craft_facility", "SMCFAC");
        map.put("topmark", "TOPMAR");
        map.put("fog_signal", "FOGSIG");
        map.put("radar_reflector", "RADRFL");
        map.put("radar_transponder", "RDOCAL");
        map.put("retro_reflector", "RETRFL");
        map.put("rescue_station", "RSCSTA");
        map.put("coastguard_station", "CGUSTA");  // Coastguard station
        map.put("pilot_boarding", "PILBOP");  // Pilot boarding place
        map.put("runway", "RUNWAY");
        map.put("sea_plane_landing_area", "SPLARE");  // Seaplane landing area
        map.put("radar_line", "RADLNE");  // Radar line
        map.put("radio_calling_in_point", "RDOCAL");  // Radio calling-in point
        map.put("measured_distance_line", "DISMAR");  // Measured distance markers
        map.put("conveyor", "CONVYR");  // Conveyor
        map.put("checkpoint", "CHKPNT");  // Checkpoint
        map.put("control_point", "CTRPNT");  // Control point
        map.put("clearing_line", "CLRLIN");  // Clearing line
        map.put("navigation_line", "NAVLNE");  // Navigation line

        return Collections.unmodifiableMap(map);
    }

    /**
     * Vollständiges Mapping von OSM Attribut-Namen zu S-57 Attribute Acronym
     */
    private static Map<String, String> createAttributeCodes() {
        Map<String, String> map = new HashMap<>();

        // Basic attributes
        map.put("name", "OBJNAM");          // Object name
        map.put("category", "CATACH");      // Category (varies by object)
        map.put("status", "STATUS");        // Status
        map.put("condition", "CONDTN");     // Condition

        // Colours
        map.put("colour", "COLOUR");        // Colour
        map.put("color", "COLOUR");         // US spelling
        map.put("colour_pattern", "COLPAT"); // Colour pattern
        map.put("color_pattern", "COLPAT"); // US spelling

        // Measurements
        map.put("height", "HEIGHT");        // Height
        map.put("elevation", "ELEVAT");     // Elevation
        map.put("vertical_length", "VERLEN"); // Vertical length
        map.put("vertical_clearance", "VERCLR"); // Vertical clearance
        map.put("horizontal_clearance", "HORCLR"); // Horizontal clearance
        map.put("depth", "VALSOU");         // Value of sounding
        map.put("depth_value", "VALSOU");   // Value of sounding

        // Light properties
        map.put("light:character", "LITCHR"); // Light character
        map.put("light:colour", "COLOUR");   // Light colour
        map.put("light:period", "SIGPER");   // Signal period
        map.put("light:range", "VALNMR");    // Value nominal range
        map.put("light:height", "HEIGHT");   // Height
        map.put("light:sequence", "SIGSEQ"); // Signal sequence
        map.put("light:group", "SIGGRP");    // Signal group

        // Navigation
        map.put("conspicuous", "CONVIS");    // Conspicuous visually
        map.put("radar_conspicuous", "CONRAD"); // Conspicuous radar
        map.put("navigation_authority", "NATION"); // Nationality
        map.put("orientation", "ORIENT");    // Orientation

        // Construction
        map.put("construction", "CONRAD");   // Construction
        map.put("function", "FUNCTN");       // Function
        map.put("product", "PRODCT");        // Product
        map.put("restriction", "RESTRN");    // Restriction
        map.put("nationality", "NATION");    // Nationality

        // Shape
        map.put("shape", "BOYSHP");          // Buoy/beacon shape (varies)
        map.put("buoy_shape", "BOYSHP");     // Buoy shape
        map.put("beacon_shape", "BCNSHP");   // Beacon shape
        map.put("topmark_shape", "TOPSHP");  // Topmark shape

        // Additional
        map.put("reference", "PUBREF");      // Publication reference
        map.put("information", "INFORM");    // Information
        map.put("callsign", "CALSGN");       // Call sign
        map.put("communication_channel", "COMCHA"); // Communication channel
        map.put("vertical_datum", "VERDAT"); // Vertical datum
        map.put("horizontal_datum", "HORDAT"); // Horizontal datum

        // Radar and radio
        map.put("radar_band", "RADWAL");     // Radar wave length
        map.put("signal_frequency", "SIGFRQ"); // Signal frequency

        // Wreck specific
        map.put("wreck_category", "CATWRK"); // Category of wreck

        // Marine farm
        map.put("farm_category", "CATMFA");  // Category marine farm

        return Collections.unmodifiableMap(map);
    }

    /**
     * Resultat der S-57 Konvertierung
     */
    public static class S57Result {
        private final String seamarkType;
        private final String objectCode;
        private final Map<String, String> attributes;

        public S57Result(String seamarkType, String objectCode, Map<String, String> attributes) {
            this.seamarkType = seamarkType;
            this.objectCode = objectCode;
            this.attributes = Collections.unmodifiableMap(attributes);
        }

        /**
         * @return OSM seamark:type (z.B. "buoy_lateral")
         */
        public String getSeamarkType() {
            return seamarkType;
        }

        /**
         * @return S-57 Object Acronym (z.B. "BOYLAT" für lateral buoy)
         */
        public String getObjectCode() {
            return objectCode;
        }

        /**
         * @return Map von S-57 Attribut Acronym zu Wert
         */
        public Map<String, String> getAttributes() {
            return attributes;
        }

        @Override
        public String toString() {
            return "S57Result{type=" + seamarkType +
                   ", objectCode=" + objectCode +
                   ", attributes=" + attributes + "}";
        }
    }

    /**
     * Konvertiert Map<String,Object> zu Map<String,String> durch Aufruf von toString() auf Werten.
     * Hilfsmethode für Planetiler SourceFeature.tags() welche Map<String,Object> zurückgibt.
     */
    private static Map<String, String> toStringTags(Map<String, Object> tags) {
        Map<String, String> out = new HashMap<>();
        for (Map.Entry<String, Object> e : tags.entrySet()) {
            if (e.getKey() == null) continue;
            Object v = e.getValue();
            if (v == null) continue;
            out.put(e.getKey(), v.toString());
        }
        return out;
    }
}