from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import Point
from pyogrio import read_dataframe


# ============================================================
# CONFIGURATION
# ============================================================

# DATA_DIR = Path(r"D:\dataset")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OSM_PBF_PATH = DATA_DIR / "pakistan-latest.osm.pbf"

WGS84_CRS = "EPSG:4326"
UTM_CRS = "EPSG:32643"

# Must match the original HydroTwin dataset pipeline
BUFFER_M = 500


# ============================================================
# OSM TAG DETECTION
# ============================================================

def detect_tag_column(gdf, possible_names):
    """
    Find the actual OSM tag column used by pyogrio/GeoPandas.
    """
    for name in possible_names:
        if name in gdf.columns:
            return name

    return None


# ============================================================
# LOAD OSM LAYERS
# ============================================================

def load_osm_layers():
    """
    Load roads and waterways from the local Pakistan OSM PBF.

    This uses the same local OSM source as the original
    HydroTwin dataset pipeline.

    Returns:
        roads
        waterways
    """

    if not OSM_PBF_PATH.exists():
        raise FileNotFoundError(
            f"OSM file not found: {OSM_PBF_PATH}"
        )

    # --------------------------------------------------------
    # Read OSM lines
    # --------------------------------------------------------

    lines = read_dataframe(
        OSM_PBF_PATH,
        layer="lines"
    )

    if lines.empty:
        raise RuntimeError(
            "No line features were found in the OSM PBF."
        )

    # --------------------------------------------------------
    # Detect OSM tags
    # --------------------------------------------------------

    highway_col = detect_tag_column(
        lines,
        ["highway"]
    )

    waterway_col = detect_tag_column(
        lines,
        ["waterway"]
    )

    if highway_col is None:
        raise RuntimeError(
            "Could not find the OSM 'highway' tag column."
        )

    if waterway_col is None:
        raise RuntimeError(
            "Could not find the OSM 'waterway' tag column."
        )

    # --------------------------------------------------------
    # Roads
    # --------------------------------------------------------

    roads = lines[
        lines[highway_col].notna()
    ].copy()

    roads["__highway_type"] = (
        roads[highway_col]
        .astype(str)
        .str.lower()
    )

    # --------------------------------------------------------
    # Waterways
    # --------------------------------------------------------

    waterways = lines[
        lines[waterway_col].notna()
    ].copy()

    waterways["__waterway_type"] = (
        waterways[waterway_col]
        .astype(str)
        .str.lower()
    )

    # --------------------------------------------------------
    # Project to same CRS as training pipeline
    # --------------------------------------------------------

    roads = roads.to_crs(UTM_CRS)

    waterways = waterways.to_crs(UTM_CRS)

    return roads, waterways


# ============================================================
# DISTANCE CALCULATION
# ============================================================

def nearest_distance(point, layer):
    """
    Calculate distance from a point to the nearest geometry.

    Input and layer must use a projected CRS in meters.
    """

    if layer.empty:
        return np.nan

    # --------------------------------------------------------
    # Fast spatial-index method
    # --------------------------------------------------------

    try:
        result = layer.sindex.nearest(
            point,
            return_all=False
        )

        if result is not None and len(result) > 0:

            # Depending on GeoPandas version, result may be
            # a 1D or 2D array.
            if getattr(result, "ndim", 1) == 2:
                geometry_index = int(result[1][0])
            else:
                geometry_index = int(result[0])

            geom = layer.iloc[geometry_index].geometry

            return float(point.distance(geom))

    except Exception:
        pass

    # --------------------------------------------------------
    # Safe fallback
    # --------------------------------------------------------

    try:
        return float(
            layer.geometry.distance(point).min()
        )

    except Exception:
        return np.nan


# ============================================================
# MAIN FEATURE EXTRACTION
# ============================================================

def extract_osm_features(latitude, longitude):
    """
    Extract the three OSM features required by the
    HydroTwin 9-feature ML model:

        distance_to_river_m
        distance_to_canal_m
        distance_to_road_m

    Parameters
    ----------
    latitude : float
        WGS84 latitude.

    longitude : float
        WGS84 longitude.

    Returns
    -------
    dict
        HydroTwin-compatible OSM features.
    """

    # --------------------------------------------------------
    # Validate coordinates
    # --------------------------------------------------------

    if latitude is None or longitude is None:
        raise ValueError(
            "Latitude and longitude are required."
        )

    latitude = float(latitude)
    longitude = float(longitude)

    if not -90 <= latitude <= 90:
        raise ValueError(
            "Latitude must be between -90 and 90."
        )

    if not -180 <= longitude <= 180:
        raise ValueError(
            "Longitude must be between -180 and 180."
        )

    # --------------------------------------------------------
    # Create WGS84 point
    # --------------------------------------------------------

    point_wgs84 = gpd.GeoDataFrame(
        {
            "latitude": [latitude],
            "longitude": [longitude]
        },
        geometry=[
            Point(longitude, latitude)
        ],
        crs=WGS84_CRS
    )

    # --------------------------------------------------------
    # Project point to same CRS used during training
    # --------------------------------------------------------

    point_projected = point_wgs84.to_crs(UTM_CRS)

    point = point_projected.geometry.iloc[0]

    # --------------------------------------------------------
    # Load OSM data
    # --------------------------------------------------------

    roads, waterways = load_osm_layers()

    # --------------------------------------------------------
    # Separate rivers and canals exactly like the
    # original dataset pipeline
    # --------------------------------------------------------

    rivers = waterways[
        waterways["__waterway_type"] == "river"
    ]

    canals = waterways[
        waterways["__waterway_type"] == "canal"
    ]

    # --------------------------------------------------------
    # Calculate distances
    # --------------------------------------------------------

    distance_to_river = nearest_distance(
        point,
        rivers
    )

    distance_to_canal = nearest_distance(
        point,
        canals
    )

    distance_to_road = nearest_distance(
        point,
        roads
    )

    # --------------------------------------------------------
    # Return HydroTwin features
    # --------------------------------------------------------

    return {
        "distance_to_river_m": distance_to_river,
        "distance_to_canal_m": distance_to_canal,
        "distance_to_road_m": distance_to_road,
    }


# ============================================================
# TEST
# ============================================================

if __name__ == "__main__":

    latitude = 32.1877
    longitude = 74.1945

    print("=" * 60)
    print("HydroTwin OSM Feature Extraction Test")
    print("=" * 60)

    print(f"Latitude : {latitude}")
    print(f"Longitude: {longitude}")
    print(f"CRS     : {UTM_CRS}")
    print(f"Buffer  : {BUFFER_M} m")

    print()
    print("Loading OSM data...")

    result = extract_osm_features(
        latitude,
        longitude
    )

    print()
    print("OSM result:")
    print(result)

    print()
    print("HydroTwin OSM extraction successful.")