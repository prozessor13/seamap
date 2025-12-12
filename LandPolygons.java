import java.io.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.FeatureCollector;

/**
 * LandPolygons.java
 *
 * Handles downloading and processing of land polygons from
 * https://osmdata.openstreetmap.de/data/land-polygons.html
 *
 * The land polygons are provided in WGS84 (EPSG:4326) projection
 * and can be used as a base layer for nautical charts.
 */
public class LandPolygons {

  private static final String LAND_POLYGONS_URL =
    "https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip";
  private static final String LAND_POLYGONS_DIR = "land-polygons-split-4326";
  private static final String LAND_POLYGONS_SHP = "land_polygons.shp";

  /**
   * Downloads the land polygons shapefile if it doesn't exist locally.
   *
   * @param dataDir The directory where data files are stored (e.g., "data")
   * @return Path to the land_polygons.shp file
   * @throws IOException if download or extraction fails
   */
  public static Path ensureLandPolygons(Path dataDir) throws IOException, InterruptedException {
    Path targetDir = dataDir.resolve(LAND_POLYGONS_DIR);
    Path shpFile = targetDir.resolve(LAND_POLYGONS_SHP);

    // Check if shapefile already exists
    if (Files.exists(shpFile)) {
      System.out.println("Land polygons shapefile already exists at: " + shpFile);
      return shpFile;
    }

    // Create data directory if it doesn't exist
    Files.createDirectories(dataDir);

    System.out.println("Downloading land polygons from: " + LAND_POLYGONS_URL);
    System.out.println("This may take a while (file size ~600 MB)...");

    // Download the zip file
    Path zipFile = dataDir.resolve("land-polygons-split-4326.zip");
    downloadFile(LAND_POLYGONS_URL, zipFile);

    System.out.println("Download complete. Extracting...");

    // Extract the zip file
    extractZipFile(zipFile, dataDir);

    System.out.println("Extraction complete. Land polygons ready at: " + shpFile);

    // Optionally delete the zip file to save space
    Files.deleteIfExists(zipFile);

    return shpFile;
  }

  /**
   * Downloads a file from a URL to a target path.
   */
  private static void downloadFile(String url, Path targetPath) throws IOException, InterruptedException {
    HttpClient client = HttpClient.newBuilder()
      .followRedirects(HttpClient.Redirect.NORMAL)
      .build();

    HttpRequest request = HttpRequest.newBuilder()
      .uri(URI.create(url))
      .GET()
      .build();

    HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());

    if (response.statusCode() != 200) {
      throw new IOException("Failed to download file. HTTP status: " + response.statusCode());
    }

    // Write the response body to file with progress indication
    try (InputStream in = response.body();
         OutputStream out = Files.newOutputStream(targetPath)) {

      byte[] buffer = new byte[8192];
      long totalBytesRead = 0;
      int bytesRead;

      while ((bytesRead = in.read(buffer)) != -1) {
        out.write(buffer, 0, bytesRead);
        totalBytesRead += bytesRead;

        // Print progress every 10 MB
        if (totalBytesRead % (10 * 1024 * 1024) == 0) {
          System.out.printf("Downloaded: %d MB%n", totalBytesRead / (1024 * 1024));
        }
      }

      System.out.printf("Total downloaded: %d MB%n", totalBytesRead / (1024 * 1024));
    }
  }

  /**
   * Extracts a zip file to a target directory.
   */
  private static void extractZipFile(Path zipFilePath, Path targetDir) throws IOException {
    try (ZipInputStream zis = new ZipInputStream(Files.newInputStream(zipFilePath))) {
      ZipEntry entry;

      while ((entry = zis.getNextEntry()) != null) {
        Path entryPath = targetDir.resolve(entry.getName());

        if (entry.isDirectory()) {
          Files.createDirectories(entryPath);
        } else {
          // Ensure parent directory exists
          Files.createDirectories(entryPath.getParent());

          // Extract file
          try (OutputStream out = Files.newOutputStream(entryPath)) {
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = zis.read(buffer)) != -1) {
              out.write(buffer, 0, bytesRead);
            }
          }

          System.out.println("Extracted: " + entry.getName());
        }

        zis.closeEntry();
      }
    }
  }

  /**
   * Processes land polygon features for vector tiles.
   * Called from the main Profile.processFeature() method.
   *
   * @param sf SourceFeature from the shapefile
   * @param features FeatureCollector to add the processed feature to
   */
  public static void processLandFeature(SourceFeature sf, FeatureCollector features) {
    features.polygon("land").setBufferPixels(4);
  }

  /**
   * Example main method to test download functionality.
   */
  public static void main(String[] args) {
    try {
      Path dataDir = Path.of("data");
      Path shpFile = ensureLandPolygons(dataDir);
      System.out.println("Land polygons shapefile is ready: " + shpFile);
    } catch (Exception e) {
      System.err.println("Error: " + e.getMessage());
      e.printStackTrace();
    }
  }
}
