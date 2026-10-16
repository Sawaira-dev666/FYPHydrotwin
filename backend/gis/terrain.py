from pathlib import Path

import rasterio
from rasterio.warp import transform


# DATA_DIR = Path(r"D:\dataset")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

DEM_PATH = DATA_DIR / "punjab_copernicus_dem_30m.tif"
HAND_PATH = DATA_DIR / "punjab_hand.tif"


def sample_raster(path: Path, latitude: float, longitude: float):
    """
    Extract the raster value at a latitude/longitude.
    Input coordinates are WGS84 (EPSG:4326).
    """

    with rasterio.open(path) as src:

        # Convert WGS84 coordinates into the raster CRS
        x, y = transform(
            "EPSG:4326",
            src.crs,
            [longitude],
            [latitude]
        )

        row, col = src.index(x[0], y[0])

        # Check whether the requested point is inside the raster
        if (
            row < 0
            or row >= src.height
            or col < 0
            or col >= src.width
        ):
            return None

        value = src.read(1)[row, col]

        # Handle NoData
        if src.nodata is not None and value == src.nodata:
            return None

        return float(value)


def extract_terrain_features(latitude: float, longitude: float):

    elevation = sample_raster(
        DEM_PATH,
        latitude,
        longitude
    )

    hand = sample_raster(
        HAND_PATH,
        latitude,
        longitude
    )

    return {
        "elevation_m": elevation,
        "hand_m": hand
    }