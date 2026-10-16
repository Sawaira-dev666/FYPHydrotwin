from backend.gis.terrain import extract_terrain_features
from backend.gis.osm import extract_osm_features
from backend.gis.rainfall import extract_rainfall_features


def extract_all_features(latitude: float, longitude: float):
    """
    Extract all 9 features required by the HydroTwin
    Random Forest model from a latitude/longitude.
    """

    print("Extracting terrain features...")
    terrain = extract_terrain_features(
        latitude,
        longitude
    )

    print("Extracting OSM features...")
    osm = extract_osm_features(
        latitude,
        longitude
    )

    print("Extracting rainfall features...")
    rainfall = extract_rainfall_features(
        latitude,
        longitude
    )

    # --------------------------------------------------------
    # Combine all features
    # --------------------------------------------------------

    features = {
        "elevation_m": terrain["elevation_m"],
        "hand_m": terrain["hand_m"],

        "distance_to_river_m": osm[
            "distance_to_river_m"
        ],

        "distance_to_canal_m": osm[
            "distance_to_canal_m"
        ],

        "distance_to_road_m": osm[
            "distance_to_road_m"
        ],

        "historical_rainfall_mean": rainfall[
            "historical_rainfall_mean"
        ],

        "maximum_rainfall_mm": rainfall[
            "maximum_rainfall_mm"
        ],

        "maximum_3day_rainfall_mm": rainfall[
            "maximum_3day_rainfall_mm"
        ],

        "maximum_7day_rainfall_mm": rainfall[
            "maximum_7day_rainfall_mm"
        ],
    }

    return features


# ============================================================
# TEST
# ============================================================

if __name__ == "__main__":

    latitude = 32.1877
    longitude = 74.1945

    print("=" * 70)
    print("HYDROTWIN COMPLETE GIS FEATURE EXTRACTION TEST")
    print("=" * 70)

    print()
    print(f"Latitude : {latitude}")
    print(f"Longitude: {longitude}")

    print()
    print("-" * 70)

    result = extract_all_features(
        latitude,
        longitude
    )

    print()
    print("FINAL 9 ML FEATURES")
    print("-" * 70)

    for name, value in result.items():
        print(f"{name}: {value}")

    print()
    print("-" * 70)
    print("Total features:", len(result))
    print("Feature extraction successful.")