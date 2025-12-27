import com.onthegomap.planetiler.pmtiles.ReadablePmtiles;
import com.onthegomap.planetiler.archive.ReadableTileArchive;
import com.onthegomap.planetiler.geo.TileCoord;
import com.onthegomap.planetiler.geo.GeoUtils;
import org.locationtech.jts.geom.Coordinate;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * DepthCalculator - Calculates missing depth values for wrecks and rocks from Terrarium DEM tiles
 *
 * Terrarium Encoding:
 * elevation = (red * 256 + green + blue / 256) - 32768
 * depth = -elevation (positive values for underwater)
 */
public class DepthCalculator {

  private final ReadableTileArchive pmtiles;
  private final int maxZoom;
  private final int tileSize;
  private final Map<String, BufferedImage> cache;
  private final int cacheSize;

  /**
   * Constructor with PMTiles path
   *
   * @param fname Path to bathymetry PMTiles file
   */
  public DepthCalculator(String fname, int tileSize) throws IOException {
    ReadablePmtiles pm = (ReadablePmtiles) ReadablePmtiles.newReadFromFile(Path.of(fname));
    this.pmtiles = pm;
    this.maxZoom = pm.getHeader().maxZoom();
    this.tileSize = tileSize;
    this.cacheSize = 100;

    this.cache = new LinkedHashMap<>(cacheSize, 0.75f, true) {
      @Override
      protected boolean removeEldestEntry(Map.Entry<String, BufferedImage> eldest) {
        return size() > DepthCalculator.this.cacheSize;
      }
    };
  }

  public DepthCalculator(String fname) throws IOException {
    this(fname, 512);
  }

  /**
   * Calculates tile coordinates from geographic coordinates
   */
  private TileCoord getTileCoord(double lon, double lat, int zoom) {
    int n = 1 << zoom;
    int x = (int) Math.floor((lon + 180.0) / 360.0 * n);

    double latRad = Math.toRadians(lat);
    int y = (int) Math.floor((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0 * n);

    // System.err.println("Berechne Tile für lon=" + lon + " lat=" + lat + " zoom=" + zoom + " => " + zoom + "/" + x + "/" + y);
    return TileCoord.ofXYZ(x, y, zoom);
  }

  /**
   * Calculates pixel position within a tile
   */
  private int[] getPixelInTile(double lon, double lat, int zoom) {
    int n = 1 << zoom;
    double x = (lon + 180.0) / 360.0 * n;

    double latRad = Math.toRadians(lat);
    double y = (1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0 * n;

    int tileX = (int) Math.floor(x);
    int tileY = (int) Math.floor(y);

    int pixelX = (int) Math.floor((x - tileX) * tileSize);
    int pixelY = (int) Math.floor((y - tileY) * tileSize);

    return new int[]{pixelX, pixelY};
  }

  /**
   * Generates cache key for a tile
   */
  private String getTileKey(TileCoord coord) {
    return coord.z() + "/" + coord.x() + "/" + coord.y();
  }

  /**
   * Loads a DEM tile
   */
  private BufferedImage loadTile(TileCoord coord) throws IOException {
    String key = getTileKey(coord);

    // Check cache
    if (cache.containsKey(key)) {
      return cache.get(key);
    }

    byte[] tileData = pmtiles.getTile(coord);

    if (tileData == null || tileData.length == 0) {
      System.err.println("No depth tile found for " + key + " (coord=" + coord + ")");
      return null;
    }

    BufferedImage image = null;
    try {
      image = ImageIO.read(new ByteArrayInputStream(tileData));
      if (image == null) {
        System.err.println("Error decoding tile " + key);
        System.err.println("Make sure imageio-webp.jar and dependencies are in classpath.");
        return null;
      }
    } catch (IOException e) {
      System.err.println("IOException decoding tile " + key + ": " + e.getMessage());
      return null;
    }

    // Update cache
    cache.put(key, image);

    return image;
  }

  /**
   * Samples a single pixel and loads neighboring tiles if needed
   *
   * @param baseTileX X coordinate of base tile
   * @param baseTileY Y coordinate of base tile
   * @param pixelX Pixel X position (can be > tileSize)
   * @param pixelY Pixel Y position (can be > tileSize)
   * @return Elevation value of the pixel
   */
  private double samplePixel(int baseTileX, int baseTileY, int pixelX, int pixelY) throws IOException {
    int actualTileX = baseTileX;
    int actualTileY = baseTileY;
    int actualPixelX = pixelX;
    int actualPixelY = pixelY;

    // Check if pixel is outside base tile
    if (pixelX >= tileSize) {
      actualTileX++;
      actualPixelX = pixelX - tileSize;
    }
    if (pixelY >= tileSize) {
      actualTileY++;
      actualPixelY = pixelY - tileSize;
    }

    // Load the appropriate tile
    TileCoord coord = TileCoord.ofXYZ(actualTileX, actualTileY, maxZoom);
    BufferedImage img = loadTile(coord);

    if (img == null) {
      // Fallback: use value 0 (sea level)
      return 0.0;
    }

    // Ensure pixel is within bounds
    actualPixelX = Math.max(0, Math.min(actualPixelX, tileSize - 1));
    actualPixelY = Math.max(0, Math.min(actualPixelY, tileSize - 1));

    return decodeTerrarium(img.getRGB(actualPixelX, actualPixelY));
  }

  /**
   * Decodes Terrarium elevation value from RGB
   *
   * @param r Red channel (0-255)
   * @param g Green channel (0-255)
   * @param b Blue channel (0-255)
   * @return Elevation in meters (negative = underwater)
   */
  private double decodeTerrarium(int r, int g, int b) {
    return (r * 256.0 + g + b / 256.0) - 32768.0;
  }

  /**
   * Decodes Terrarium elevation value from RGB int value
   *
   * @param rgb RGB value as int
   * @return Elevation in meters (negative = underwater)
   */
  private double decodeTerrarium(int rgb) {
    int r = (rgb >> 16) & 0xFF;
    int g = (rgb >> 8) & 0xFF;
    int b = rgb & 0xFF;
    return decodeTerrarium(r, g, b);
  }

  /**
   * Calculates depth at a geographic position
   *
   * @param lon Longitude
   * @param lat Latitude
   * @return Depth in meters (null if not available)
   */
  public Double getDepthAtLocation(double lon, double lat) {
    try {
      // Use maxZoom for best resolution
      TileCoord tileCoord = getTileCoord(lon, lat, maxZoom);
      int[] pixel = getPixelInTile(lon, lat, maxZoom);

      // Load tile
      BufferedImage image = loadTile(tileCoord);

      if (image == null) {
        return null;
      }

      // Bilinear interpolation between 4 surrounding pixels
      int n = 1 << maxZoom;
      double x = (lon + 180.0) / 360.0 * n;
      double y = (1.0 - Math.log(Math.tan(Math.toRadians(lat)) + 1.0 / Math.cos(Math.toRadians(lat))) / Math.PI) / 2.0 * n;

      int tileX = (int) Math.floor(x);
      int tileY = (int) Math.floor(y);

      double pixelXf = (x - tileX) * tileSize;
      double pixelYf = (y - tileY) * tileSize;

      int x0 = (int) Math.floor(pixelXf);
      int y0 = (int) Math.floor(pixelYf);

      double fx = pixelXf - x0;
      double fy = pixelYf - y0;

      // Sample 4 pixels - handle tile boundaries
      double e00 = samplePixel(tileX, tileY, x0, y0);
      double e10 = samplePixel(tileX, tileY, x0 + 1, y0);
      double e01 = samplePixel(tileX, tileY, x0, y0 + 1);
      double e11 = samplePixel(tileX, tileY, x0 + 1, y0 + 1);

      // Bilinear interpolation
      double e0 = e00 * (1 - fx) + e10 * fx;
      double e1 = e01 * (1 - fx) + e11 * fx;
      double elevation = e0 * (1 - fy) + e1 * fy;

      // Depth is negated elevation (positive values for underwater)
      double depth = -elevation;

      // Round to one decimal place
      depth = Math.round(depth * 10.0) / 10.0;

      // System.err.println("Koordinate: lon=" + lon + ", lat=" + lat +
      //                    " => tile(" + tileX + "," + tileY + ") pixel(" + x0 + "," + y0 + ")" +
      //                    " => samples[(" + x0 + "," + y0 + ")=" + String.format("%.1f", e00) +
      //                    ", (" + (x0+1) + "," + y0 + ")=" + String.format("%.1f", e10) +
      //                    ", (" + x0 + "," + (y0+1) + ")=" + String.format("%.1f", e01) +
      //                    ", (" + (x0+1) + "," + (y0+1) + ")=" + String.format("%.1f", e11) +
      //                    "] => elevation=" + String.format("%.1f", elevation) + " => depth=" + depth);

      return depth > 0 ? depth : 0.0;

    } catch (IOException e) {
      System.err.println("Error calculating depth for position " + lon + ", " + lat + ": " + e.getMessage());
      return null;
    }
  }

  /**
   * Calculates depth for a JTS coordinate (World Mercator 0-1)
   * Converts from World Mercator to Lon/Lat before calculation
   */
  public Double getDepthAtLocation(Coordinate coord) {
    // Convert from World Mercator (0-1) to Lon/Lat degrees
    double lon = GeoUtils.getWorldLon(coord.x);
    double lat = GeoUtils.getWorldLat(coord.y);
    return getDepthAtLocation(lon, lat);
  }

}
