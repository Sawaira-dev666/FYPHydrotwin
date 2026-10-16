from pathlib import Path

import pandas as pd
import numpy as np
from scipy.spatial import cKDTree


# ============================================================
# CONFIGURATION
# ============================================================

# DATA_DIR = Path(r"D:\dataset")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
RAINFALL_FEATURES_PATH = (
    DATA_DIR / "rainfall_features_jul_aug_2022.csv"
)


# ============================================================
# MODEL FEATURES
# ============================================================

RAINFALL_FEATURES = [
    "historical_rainfall_mean",
    "maximum_rainfall_mm",
    "maximum_3day_rainfall_mm",
    "maximum_7day_rainfall_mm",
]


# ============================================================
# LOAD RAINFALL DATA
# ============================================================

def load_rainfall_data():
    """
    Load the already-processed rainfall features.

    These are the same rainfall features used when
    HydroTwin_MAIN.csv was created.
    """

    if not RAINFALL_FEATURES_PATH.exists():
        raise FileNotFoundError(
            f"Rainfall feature file not found: "
            f"{RAINFALL_FEATURES_PATH}"
        )

    df = pd.read_csv(RAINFALL_FEATURES_PATH)

    required_columns = [
        "latitude",
        "longitude",
        *RAINFALL_FEATURES,
    ]

    missing = [
        col for col in required_columns
        if col not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Missing rainfall columns: {missing}"
        )

    # Remove rows without coordinates
    df = df.dropna(
        subset=["latitude", "longitude"]
    ).copy()

    if df.empty:
        raise RuntimeError(
            "Rainfall feature dataset contains no valid "
            "coordinate records."
        )

    return df


# ============================================================
# BUILD SPATIAL LOOKUP
# ============================================================

def build_rainfall_lookup():
    """
    Build a nearest-location spatial lookup.

    The rainfall dataset contains rainfall features at the
    HydroTwin sample locations. For a new map coordinate,
    the nearest available rainfall sample is selected.
    """

    df = load_rainfall_data()

    coordinates = df[
        ["latitude", "longitude"]
    ].to_numpy()

    tree = cKDTree(coordinates)

    return df, tree


# ============================================================
# RAINFALL FEATURE EXTRACTION
# ============================================================

def extract_rainfall_features(latitude, longitude):
    """
    Get HydroTwin rainfall features for a latitude/longitude.

    The nearest processed rainfall sample is used.

    Returns:
        historical_rainfall_mean
        maximum_rainfall_mm
        maximum_3day_rainfall_mm
        maximum_7day_rainfall_mm
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
    # Load spatial rainfall lookup
    # --------------------------------------------------------

    df, tree = build_rainfall_lookup()

    # --------------------------------------------------------
    # Find nearest rainfall sample
    # --------------------------------------------------------

    distance, index = tree.query(
        [latitude, longitude],
        k=1
    )

    nearest_row = df.iloc[int(index)]

    # --------------------------------------------------------
    # Extract model features
    # --------------------------------------------------------

    result = {
        "historical_rainfall_mean": float(
            nearest_row["historical_rainfall_mean"]
        ),

        "maximum_rainfall_mm": float(
            nearest_row["maximum_rainfall_mm"]
        ),

        "maximum_3day_rainfall_mm": float(
            nearest_row["maximum_3day_rainfall_mm"]
        ),

        "maximum_7day_rainfall_mm": float(
            nearest_row["maximum_7day_rainfall_mm"]
        ),
    }

    return result


# ============================================================
# TEST
# ============================================================

if __name__ == "__main__":

    latitude = 32.1877
    longitude = 74.1945

    print("=" * 60)
    print("HydroTwin Rainfall Feature Extraction Test")
    print("=" * 60)

    print(f"Latitude : {latitude}")
    print(f"Longitude: {longitude}")

    print()
    print("Loading rainfall features...")

    result = extract_rainfall_features(
        latitude,
        longitude
    )

    print()
    print("Rainfall result:")

    for key, value in result.items():
        print(f"{key}: {value}")

    print()
    print("HydroTwin rainfall extraction successful.")