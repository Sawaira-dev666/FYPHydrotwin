from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window


DEM_PATH = Path(r"D:\dataset\punjab_filled.tif")


def extract_dem_grid(
    latitude: float,
    longitude: float,
    size_m: float = 2000,
    grid_size: int = 80,
):
    """
    Extract a real terrain elevation grid around a selected location.

    Uses the processed/fill-corrected HydroTwin DEM.
    """

    with rasterio.open(DEM_PATH) as src:

        # Convert selected geographic coordinate to raster pixel
        row, col = src.index(longitude, latitude)

        # Approximate degrees-per-metre at the selected latitude
        lat_deg_per_m = 1 / 111_320
        lon_deg_per_m = 1 / (
            111_320 * max(np.cos(np.radians(latitude)), 0.01)
        )

        # Number of pixels required for the requested physical area
        pixel_width_deg = abs(src.res[0])
        pixel_height_deg = abs(src.res[1])

        half_width_pixels = int(
            (size_m / 2 * lon_deg_per_m) / pixel_width_deg
        )

        half_height_pixels = int(
            (size_m / 2 * lat_deg_per_m) / pixel_height_deg
        )

        # Make sure the window stays inside the raster
        col_start = max(0, col - half_width_pixels)
        row_start = max(0, row - half_height_pixels)

        col_end = min(
            src.width,
            col + half_width_pixels
        )

        row_end = min(
            src.height,
            row + half_height_pixels
        )

        width = col_end - col_start
        height = row_end - row_start

        if width <= 0 or height <= 0:
            raise ValueError(
                "Selected location is outside the DEM coverage."
            )

        window = Window(
            col_start,
            row_start,
            width,
            height
        )

        # Read and resample terrain
        data = src.read(
            1,
            window=window,
            out_shape=(grid_size, grid_size),
            resampling=rasterio.enums.Resampling.bilinear,
        ).astype(float)

        # Handle nodata correctly
        if src.nodata is not None:
            data[data == src.nodata] = np.nan

        if np.isnan(data).all():
            raise ValueError(
                "No valid terrain elevation found at this location."
            )

        # Fill only genuine missing cells with local mean
        mean_elevation = float(np.nanmean(data))
        data = np.nan_to_num(
            data,
            nan=mean_elevation
        )

        return {
            "latitude": latitude,
            "longitude": longitude,
            "size_m": size_m,
            "grid_size": grid_size,
            "min_elevation_m": float(np.min(data)),
            "max_elevation_m": float(np.max(data)),
            "elevations": data.tolist(),
        }