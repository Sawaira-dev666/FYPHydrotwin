import { API_BASE } from "./config.js";

async function post(path, body, timeoutMs = 300000) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error("The HydroTwin backend took too long to answer.");
    }
    throw new Error(
      `Cannot reach the HydroTwin backend at ${API_BASE}. ` +
        "Start it first (see README) and try again."
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail || j);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Backend error ${res.status} on ${path}. ${detail}`.trim());
  }
  return res.json();
}

export const api = {
  async health() {
    const res = await fetch(`${API_BASE}/`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error("Backend not healthy");
    return res.json();
  },
  terrain: (latitude, longitude) => post("/terrain-3d", { latitude, longitude }),
  osm: (latitude, longitude, radius_m) =>
    post("/osm-3d", { latitude, longitude, radius_m }),
  assess: (latitude, longitude) => post("/assess-location", { latitude, longitude }),
  predict: (features) => post("/predict", features, 60000),
};
