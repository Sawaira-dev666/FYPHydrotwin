// ------------------------------------------------------------
// HydroTwin frontend settings
// ------------------------------------------------------------

export const API_BASE =
  import.meta.env?.VITE_API_BASE || "http://127.0.0.1:8000";

// Terrain endpoint returns a 2,000 m window, so the OSM request
// uses a 1,000 m radius to cover exactly the same square.
export const SCENE_SIZE_M = 2000;
export const OSM_RADIUS_M = 1000;

// Rough outline of Punjab, Pakistan as [lat, lon].
// Used for an instant check; a reverse-geocode check (state = Punjab)
// is the final authority when the internet is available.
export const PUNJAB_POLYGON = [
  [33.95, 72.3], [33.95, 73.45], [33.45, 73.7], [32.95, 74.1],
  [32.85, 74.65], [32.6, 75.15], [32.25, 75.3], [31.8, 74.85],
  [31.6, 74.6], [31.15, 74.55], [30.95, 74.95], [30.35, 74.95],
  [30.05, 74.35], [29.7, 73.8], [29.35, 73.1], [29.05, 72.9],
  [28.5, 72.3], [28.2, 71.4], [27.85, 70.7], [27.65, 70.0],
  [28.0, 69.6], [28.8, 69.6], [29.6, 69.8], [30.3, 69.9],
  [30.9, 70.4], [31.5, 70.85], [32.2, 71.0], [32.7, 71.3],
  [33.3, 72.05],
];

export const PUNJAB_BOUNDS = [
  [27.4, 69.2],
  [34.1, 75.6],
];

// ------------------------------------------------------------
// Flood-scenario assumptions (all editable in the app)
// ------------------------------------------------------------
export const ASSUMPTIONS = {
  // Probability bands, the same cut-offs the backend uses
  LOW_BELOW: 0.3,
  HIGH_FROM: 0.6,

  // Rainfall scenarios, as a share of the 2022 monsoon peak
  // stored in the dataset (1.0 = same as the 2022 peak).
  RAIN_MULTIPLIER: { week: 0.4, month: 0.7, year: 1.0 },

  // Water depth drawn on the site when the model says "flood".
  // depth = MAX_DEPTH_M x severity, severity = (p - 0.30) / 0.70
  MAX_DEPTH_M: 2.0,

  // Extra height above the expected water level (standard practice)
  FREEBOARD_M: 0.5,

  // Lowest sensible floor height for a brand-new house
  MIN_NEW_FLOOR_M: 0.45,

  STOREY_HEIGHT_M: 3.0,
};

export const HORIZONS = [
  { key: "week", label: "Next week", days: 7 },
  { key: "month", label: "Next month", days: 30 },
  { key: "year", label: "Next year", days: 365 },
];
