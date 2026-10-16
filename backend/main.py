from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.gis.feature_extractor import extract_all_features

from backend.gis.dem_3d import extract_dem_grid
from backend.gis.osm_3d import extract_osm_3d_environment
# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = (
    BASE_DIR
    / "model"
    / "hydrotwin_rf_model.pkl"
)


# ============================================================
# LOAD MODEL
# ============================================================

model = joblib.load(MODEL_PATH)


# ============================================================
# FINAL MODEL FEATURES
# ============================================================

FEATURES = [
    "elevation_m",
    "hand_m",
    "distance_to_river_m",
    "distance_to_canal_m",
    "distance_to_road_m",
    "historical_rainfall_mean",
    "maximum_rainfall_mm",
    "maximum_3day_rainfall_mm",
    "maximum_7day_rainfall_mm",
]


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="HydroTwin AI API",
    description="AI-powered flood assessment backend",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# REQUEST MODELS
# ============================================================

class LocationRequest(BaseModel):
    latitude: float
    longitude: float

class OSM3DRequest(BaseModel):
    latitude: float
    longitude: float
    radius_m: float = 1000
    
class FloodPredictionRequest(BaseModel):
    elevation_m: float
    hand_m: float | None = None
    distance_to_river_m: float
    distance_to_canal_m: float
    distance_to_road_m: float
    historical_rainfall_mean: float
    maximum_rainfall_mm: float
    maximum_3day_rainfall_mm: float
    maximum_7day_rainfall_mm: float


# ============================================================
# HOME
# ============================================================

@app.get("/")
def home():

    return {
        "project": "HydroTwin AI",
        "status": "running",
        "message": "HydroTwin AI backend is working."
    }


# ============================================================
# ORIGINAL MANUAL PREDICTION ENDPOINT
# ============================================================

@app.post("/predict")
def predict_flood(request: FloodPredictionRequest):

    input_data = pd.DataFrame(
        [[
            request.elevation_m,
            request.hand_m,
            request.distance_to_river_m,
            request.distance_to_canal_m,
            request.distance_to_road_m,
            request.historical_rainfall_mean,
            request.maximum_rainfall_mm,
            request.maximum_3day_rainfall_mm,
            request.maximum_7day_rainfall_mm,
        ]],
        columns=FEATURES
    )

    probability = float(
        model.predict_proba(input_data)[0][1]
    )

    prediction = int(
        model.predict(input_data)[0]
    )

    if probability < 0.30:
        flood_class = "Low"

    elif probability < 0.60:
        flood_class = "Moderate"

    else:
        flood_class = "High"

    return {
        "prediction": prediction,
        "flood_probability": round(
            probability,
            4
        ),
        "flood_percentage": round(
            probability * 100,
            2
        ),
        "flood_class": flood_class
    }


# ============================================================
# REAL LOCATION-BASED ASSESSMENT
# ============================================================

@app.post("/assess-location")
def assess_location(request: LocationRequest):

    # --------------------------------------------------------
    # 1. Extract all 9 GIS features
    # --------------------------------------------------------

    features = extract_all_features(
        request.latitude,
        request.longitude
    )

    # --------------------------------------------------------
    # 2. Convert to DataFrame
    # --------------------------------------------------------

    input_data = pd.DataFrame(
        [[
            features["elevation_m"],
            features["hand_m"],
            features["distance_to_river_m"],
            features["distance_to_canal_m"],
            features["distance_to_road_m"],
            features["historical_rainfall_mean"],
            features["maximum_rainfall_mm"],
            features["maximum_3day_rainfall_mm"],
            features["maximum_7day_rainfall_mm"],
        ]],
        columns=FEATURES
    )

    # --------------------------------------------------------
    # 3. Run Random Forest
    # --------------------------------------------------------

    probability = float(
        model.predict_proba(input_data)[0][1]
    )

    prediction = int(
        model.predict(input_data)[0]
    )

    # --------------------------------------------------------
    # 4. Convert probability to application class
    # --------------------------------------------------------

    if probability < 0.30:
        flood_class = "Low"

    elif probability < 0.60:
        flood_class = "Moderate"

    else:
        flood_class = "High"

    # --------------------------------------------------------
    # 5. Return complete assessment
    # --------------------------------------------------------

    return {
        "location": {
            "latitude": request.latitude,
            "longitude": request.longitude
        },

        "features": features,

        "prediction": prediction,

        "flood_probability": round(
            probability,
            4
        ),

        "flood_percentage": round(
            probability * 100,
            2
        ),

        "flood_class": flood_class
    }


@app.post("/terrain-3d")
def terrain_3d(request: LocationRequest):
    terrain = extract_dem_grid(
        latitude=request.latitude,
        longitude=request.longitude,
        size_m=2000,
        grid_size=80,
    )

    return terrain



@app.post("/osm-3d")
def osm_3d(request: OSM3DRequest):
    environment = extract_osm_3d_environment(
        latitude=request.latitude,
        longitude=request.longitude,
        radius_m=request.radius_m,
    )

    return environment
