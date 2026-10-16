from pathlib import Path
import math

import geopandas as gpd
import numpy as np
from pyogrio import read_dataframe
from shapely.geometry import Point


# ============================================================
# CONFIGURATION
# ============================================================

# DATA_DIR = Path(r"D:\dataset")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OSM_PBF_PATH = DATA_DIR / "pakistan-latest.osm.pbf"

WGS84_CRS = "EPSG:4326"

# Size of the 3D environment around selected location.
# 2000 m = 2 km x 2 km area.
DEFAULT_RADIUS_M = 1000

# Limit geometry complexity sent to browser.
SIMPLIFY_M = 1.5

# Maximum features returned to frontend.
MAX_BUILDINGS = 2500
MAX_ROADS = 1500
MAX_WATERWAYS = 500


# ============================================================
# DYNAMIC LOCAL UTM
# ============================================================

def get_local_utm_crs(longitude: float, latitude: float) -> str:
    """
    Select an appropriate UTM zone for the selected location.

    This is used ONLY for the 3D visualization.

    The existing ML pipeline continues using EPSG:32643.
    """

    zone = int(math.floor((longitude + 180) / 6) + 1)

    if latitude >= 0:
        epsg = 32600 + zone
    else:
        epsg = 32700 + zone

    return f"EPSG:{epsg}"


# ============================================================
# BOUNDING BOX
# ============================================================

def make_bbox(
    latitude: float,
    longitude: float,
    radius_m: float,
):
    """
    Create a WGS84 bounding box around the selected point.
    """

    lat_deg = radius_m / 111_320.0

    lon_deg = radius_m / (
        111_320.0 *
        max(math.cos(math.radians(latitude)), 0.01)
    )

    return (
        longitude - lon_deg,
        latitude - lat_deg,
        longitude + lon_deg,
        latitude + lat_deg,
    )


# ============================================================
# OSM TAG HELPERS
# ============================================================

def detect_tag_column(gdf, names):
    for name in names:
        if name in gdf.columns:
            return name

    return None


def safe_text(value):
    if value is None:
        return None

    try:
        if isinstance(value, float) and np.isnan(value):
            return None
    except Exception:
        pass

    text = str(value).strip()

    if not text or text.lower() == "nan":
        return None

    return text


def safe_float(value):
    if value is None:
        return None

    try:
        if isinstance(value, float) and np.isnan(value):
            return None
    except Exception:
        pass

    try:
        text = str(value).strip()

        # Handle values such as:
        # "12 m"
        # "12"
        # "12.5"
        text = (
            text
            .replace("m", "")
            .replace(",", "")
            .strip()
        )

        return float(text)

    except Exception:
        return None


# ============================================================
# BUILDING HEIGHT
# ============================================================
def estimate_building_height(row):
    """
    Determine building height from OSM information.

    Priority:
        1. OSM height
        2. building levels
        3. estimated default height
    """

    # --------------------------------------------------------
    # OSM height
    # --------------------------------------------------------

    if "height" in row.index:

        height = safe_float(
            row["height"]
        )

        if height is not None and 1 <= height <= 150:
            return height, "osm_height"

    # --------------------------------------------------------
    # Building levels
    # --------------------------------------------------------

    levels_column = None

    if "building:levels" in row.index:
        levels_column = "building:levels"

    elif "building_levels" in row.index:
        levels_column = "building_levels"

    if levels_column is not None:

        levels = safe_float(
            row[levels_column]
        )

        if levels is not None and 1 <= levels <= 40:
            return levels * 3.0, "estimated_from_levels"

    # --------------------------------------------------------
    # Default estimated height
    # --------------------------------------------------------

    return 6.0, "estimated_default"
# ============================================================
# GEOMETRY CONVERSION
# ============================================================

def polygon_to_points(geometry, center_x, center_y):
    """
    Convert polygon exterior to local X/Z coordinates
    centered around the selected location.
    """

    if geometry is None or geometry.is_empty:
        return None

    if geometry.geom_type == "MultiPolygon":
        geometry = max(
            geometry.geoms,
            key=lambda polygon: polygon.area
        )

    if geometry.geom_type != "Polygon":
        return None

    exterior = geometry.exterior

    coordinates = []

    for x, y in exterior.coords:

        local_x = float(x - center_x)
        local_z = float(-(y - center_y))

        coordinates.append([
            local_x,
            local_z,
        ])

    if len(coordinates) < 3:
        return None

    return coordinates


def line_to_points(geometry, center_x, center_y):
    """
    Convert LineString/MultiLineString into local X/Z points.
    """

    if geometry is None or geometry.is_empty:
        return None

    if geometry.geom_type == "MultiLineString":

        longest = max(
            geometry.geoms,
            key=lambda line: line.length
        )

        geometry = longest

    if geometry.geom_type != "LineString":
        return None

    coordinates = []

    for x, y in geometry.coords:

        local_x = float(x - center_x)
        local_z = float(-(y - center_y))

        coordinates.append([
            local_x,
            local_z,
        ])

    if len(coordinates) < 2:
        return None

    return coordinates


# ============================================================
# LOAD BUILDINGS
# ============================================================

def load_buildings(
    bbox,
    projected_crs,
    center_x,
    center_y,
):
    """
    Load only buildings inside selected bbox.
    """

    try:
        buildings = read_dataframe(
            OSM_PBF_PATH,
            layer="multipolygons",
            bbox=bbox,
        )
    except Exception as exc:
        print(f"Building extraction warning: {exc}")
        return []

    if buildings.empty:
        return []

    building_col = detect_tag_column(
        buildings,
        [
            "building",
        ],
    )

    if building_col is None:
        return []

    buildings = buildings[
        buildings[building_col].notna()
    ].copy()

    if buildings.empty:
        return []

    buildings = buildings.to_crs(projected_crs)

    buildings = buildings[
        buildings.geometry.notna()
    ]

    buildings = buildings[
        ~buildings.geometry.is_empty
    ]

    # Avoid sending enormous amounts of geometry.
    buildings["__area"] = buildings.geometry.area

    buildings = buildings.sort_values(
        "__area",
        ascending=False
    ).head(MAX_BUILDINGS)

    results = []

    for index, row in buildings.iterrows():

        geometry = row.geometry

        # Simplify for browser performance.
        try:
            geometry = geometry.simplify(
                SIMPLIFY_M,
                preserve_topology=True,
            )
        except Exception:
            pass

        points = polygon_to_points(
            geometry,
            center_x,
            center_y,
        )

        if not points:
            continue

        height, height_source = estimate_building_height(row)

        building_type = safe_text(
            row.get(building_col)
        )

        name = safe_text(
            row.get("name")
        )

        results.append(
            {
                "id": f"building_{index}",
                "type": building_type or "building",
                "name": name,
                "height_m": round(height, 2),
                "height_source": height_source,
                "area_m2": round(
                    float(geometry.area),
                    2,
                ),
                "footprint": points,
            }
        )

    return results


# ============================================================
# LOAD ROADS
# ============================================================

def load_roads(
    bbox,
    projected_crs,
    center_x,
    center_y,
):
    """
    Load roads around selected location.
    """

    try:
        lines = read_dataframe(
            OSM_PBF_PATH,
            layer="lines",
            bbox=bbox,
        )
    except Exception as exc:
        print(f"Road extraction warning: {exc}")
        return []

    if lines.empty:
        return []

    highway_col = detect_tag_column(
        lines,
        [
            "highway",
        ],
    )

    if highway_col is None:
        return []

    roads = lines[
        lines[highway_col].notna()
    ].copy()

    if roads.empty:
        return []

    roads = roads.to_crs(projected_crs)

    roads = roads[
        roads.geometry.notna()
    ]

    roads = roads[
        ~roads.geometry.is_empty
    ]

    # Prioritize major roads.
    priority = {
        "motorway": 1,
        "trunk": 2,
        "primary": 3,
        "secondary": 4,
        "tertiary": 5,
        "residential": 6,
        "unclassified": 7,
        "service": 8,
        "track": 9,
        "path": 10,
    }

    roads["__priority"] = roads[
        highway_col
    ].astype(str).str.lower().map(
        priority
    ).fillna(99)

    roads = roads.sort_values(
        "__priority"
    ).head(MAX_ROADS)

    results = []

    for index, row in roads.iterrows():

        geometry = row.geometry

        try:
            geometry = geometry.simplify(
                SIMPLIFY_M,
                preserve_topology=True,
            )
        except Exception:
            pass

        points = line_to_points(
            geometry,
            center_x,
            center_y,
        )

        if not points:
            continue

        highway_type = safe_text(
            row.get(highway_col)
        )

        name = safe_text(
            row.get("name")
        )

        results.append(
            {
                "id": f"road_{index}",
                "highway": highway_type or "road",
                "name": name,
                "points": points,
            }
        )

    return results


# ============================================================
# LOAD WATERWAYS
# ============================================================

def load_waterways(
    bbox,
    projected_crs,
    center_x,
    center_y,
):
    """
    Load rivers, canals and other mapped waterways.
    """

    try:
        lines = read_dataframe(
            OSM_PBF_PATH,
            layer="lines",
            bbox=bbox,
        )
    except Exception as exc:
        print(f"Waterway extraction warning: {exc}")
        return []

    if lines.empty:
        return []

    waterway_col = detect_tag_column(
        lines,
        [
            "waterway",
        ],
    )

    if waterway_col is None:
        return []

    waterways = lines[
        lines[waterway_col].notna()
    ].copy()

    if waterways.empty:
        return []

    waterways["__waterway_type"] = (
        waterways[waterway_col]
        .astype(str)
        .str.lower()
    )

    waterways = waterways[
        waterways["__waterway_type"].isin(
            [
                "river",
                "canal",
                "stream",
                "drain",
                "ditch",
                "watercourse",
            ]
        )
    ]

    if waterways.empty:
        return []

    waterways = waterways.to_crs(
        projected_crs
    )

    waterways = waterways[
        waterways.geometry.notna()
    ]

    waterways = waterways[
        ~waterways.geometry.is_empty
    ]

    # Prioritize larger/important water features.
    priority = {
        "river": 1,
        "canal": 2,
        "watercourse": 3,
        "stream": 4,
        "drain": 5,
        "ditch": 6,
    }

    waterways["__priority"] = (
        waterways["__waterway_type"]
        .map(priority)
        .fillna(99)
    )

    waterways = waterways.sort_values(
        "__priority"
    ).head(MAX_WATERWAYS)

    results = []

    for index, row in waterways.iterrows():

        geometry = row.geometry

        try:
            geometry = geometry.simplify(
                SIMPLIFY_M,
                preserve_topology=True,
            )
        except Exception:
            pass

        points = line_to_points(
            geometry,
            center_x,
            center_y,
        )

        if not points:
            continue

        water_type = safe_text(
            row.get("__waterway_type")
        )

        name = safe_text(
            row.get("name")
        )

        results.append(
            {
                "id": f"water_{index}",
                "waterway": water_type or "waterway",
                "name": name,
                "points": points,
            }
        )

    return results


# ============================================================
# MAIN 3D ENVIRONMENT EXTRACTION
# ============================================================

def extract_osm_3d_environment(
    latitude,
    longitude,
    radius_m=DEFAULT_RADIUS_M,
):
    """
    Extract real OSM surroundings for the Digital Twin.

    The returned coordinates are centered around the selected
    location and measured in meters.

    This function is independent from the ML OSM pipeline.
    """

    latitude = float(latitude)
    longitude = float(longitude)
    radius_m = float(radius_m)

    if not -90 <= latitude <= 90:
        raise ValueError(
            "Latitude must be between -90 and 90."
        )

    if not -180 <= longitude <= 180:
        raise ValueError(
            "Longitude must be between -180 and 180."
        )

    if radius_m <= 0:
        raise ValueError(
            "radius_m must be greater than zero."
        )

    if radius_m > 5000:
        raise ValueError(
            "Maximum supported radius is 5000 meters."
        )

    if not OSM_PBF_PATH.exists():
        raise FileNotFoundError(
            f"OSM file not found: {OSM_PBF_PATH}"
        )

    # --------------------------------------------------------
    # Bounding box in WGS84
    # --------------------------------------------------------

    bbox = make_bbox(
        latitude,
        longitude,
        radius_m,
    )

    # --------------------------------------------------------
    # Dynamic local UTM for accurate metric geometry
    # --------------------------------------------------------

    local_crs = get_local_utm_crs(
        longitude,
        latitude,
    )

    center = gpd.GeoSeries(
        [
            Point(
                longitude,
                latitude
            )
        ],
        crs=WGS84_CRS,
    ).to_crs(local_crs).iloc[0]

    center_x = float(center.x)
    center_y = float(center.y)

    # --------------------------------------------------------
    # Extract real OSM features
    # --------------------------------------------------------

    buildings = load_buildings(
        bbox,
        local_crs,
        center_x,
        center_y,
    )

    roads = load_roads(
        bbox,
        local_crs,
        center_x,
        center_y,
    )

    waterways = load_waterways(
        bbox,
        local_crs,
        center_x,
        center_y,
    )

    # --------------------------------------------------------
    # Return compact JSON-friendly structure
    # --------------------------------------------------------

    return {
        "latitude": latitude,
        "longitude": longitude,
        "radius_m": radius_m,
        "size_m": radius_m * 2,
        "crs": local_crs,

        "center": {
            "x": 0.0,
            "z": 0.0,
        },

        "buildings": buildings,
        "roads": roads,
        "waterways": waterways,

        "counts": {
            "buildings": len(buildings),
            "roads": len(roads),
            "waterways": len(waterways),
        },
    }


# ============================================================
# LOCAL TEST
# ============================================================

if __name__ == "__main__":

    latitude = 32.5742
    longitude = 74.0754

    print("=" * 70)
    print("HydroTwin 3D OSM Environment Test")
    print("=" * 70)

    print(f"Latitude : {latitude}")
    print(f"Longitude: {longitude}")
    print(f"Radius   : {DEFAULT_RADIUS_M} m")

    print()
    print("Extracting real OSM surroundings...")

    result = extract_osm_3d_environment(
        latitude,
        longitude,
        DEFAULT_RADIUS_M,
    )

    print()
    print("CRS:")
    print(result["crs"])

    print()
    print("Feature counts:")
    print(result["counts"])

    print()
    print("First building:")

    if result["buildings"]:
        print(
            result["buildings"][0]
        )
    else:
        print("No buildings found.")

    print()
    print("First road:")

    if result["roads"]:
        print(
            result["roads"][0]
        )
    else:
        print("No roads found.")

    print()
    print("First waterway:")

    if result["waterways"]:
        print(
            result["waterways"][0]
        )
    else:
        print("No waterways found.")

    print()
    print("3D OSM extraction successful.")