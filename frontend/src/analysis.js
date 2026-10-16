import { ASSUMPTIONS, HORIZONS } from "./config.js";
import { api } from "./api.js";
import { distancePointToPolyline } from "./geo.js";

// ------------------------------------------------------------
// Risk classes — same cut-offs the backend uses
// ------------------------------------------------------------
export function classify(p, A = ASSUMPTIONS) {
  if (p < A.LOW_BELOW) return "Low";
  if (p < A.HIGH_FROM) return "Moderate";
  return "High";
}

// Illustrative water depth for the 3D view and for sizing the floor.
// The model returns a probability, not a depth, so this is a
// transparent rule: 0 m at p<=0.30, MAX_DEPTH_M at p=1.0.
export function depthFromProbability(p, A = ASSUMPTIONS) {
  const severity = Math.min(1, Math.max(0, (p - A.LOW_BELOW) / (1 - A.LOW_BELOW)));
  return +(A.MAX_DEPTH_M * severity).toFixed(2);
}

// ------------------------------------------------------------
// Live weather forecast (Open-Meteo, free, no key). Optional.
// ------------------------------------------------------------
export async function fetchForecast(lat, lon) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&daily=precipitation_sum&forecast_days=7&timezone=auto";
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const j = await res.json();
    const d = (j.daily?.precipitation_sum || []).map((v) => Number(v) || 0);
    if (d.length < 7) return null;
    let max3 = 0;
    for (let i = 0; i + 3 <= d.length; i++) {
      max3 = Math.max(max3, d[i] + d[i + 1] + d[i + 2]);
    }
    return {
      daily: d,
      sum7: d.reduce((a, b) => a + b, 0),
      max1: Math.max(...d),
      max3,
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Build the 9 model inputs for each horizon
// ------------------------------------------------------------
const RAIN_KEYS = [
  "historical_rainfall_mean",
  "maximum_rainfall_mm",
  "maximum_3day_rainfall_mm",
  "maximum_7day_rainfall_mm",
];

function scaleRain(features, m) {
  const out = { ...features };
  RAIN_KEYS.forEach((k) => (out[k] = +(features[k] * m).toFixed(3)));
  return out;
}

export function buildScenarioFeatures(base, horizonKey, multipliers, forecast) {
  if (horizonKey === "week" && forecast) {
    const peak7 = base.maximum_7day_rainfall_mm || 1;
    const out = { ...base };
    out.maximum_rainfall_mm = +forecast.max1.toFixed(3);
    out.maximum_3day_rainfall_mm = +forecast.max3.toFixed(3);
    out.maximum_7day_rainfall_mm = +forecast.sum7.toFixed(3);
    out.historical_rainfall_mean = +(
      base.historical_rainfall_mean * Math.min(1.5, forecast.sum7 / peak7)
    ).toFixed(3);
    return { features: out, source: "forecast" };
  }
  return {
    features: scaleRain(base, multipliers[horizonKey]),
    source: "scenario",
  };
}

export function houseStatus(depth, floorHeight) {
  if (depth <= 0) return { key: "dry", text: "Stays dry", inside: 0 };
  if (depth <= floorHeight) {
    return { key: "around", text: "Water around the house, floor stays dry", inside: 0 };
  }
  return {
    key: "flooded",
    text: "Water enters the house",
    inside: +(depth - floorHeight).toFixed(2),
  };
}

function endDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ------------------------------------------------------------
// Run all three horizons through the trained Random Forest
// ------------------------------------------------------------
export async function runScenarios({ assessment, multipliers, forecast, floorHeight }) {
  const base = { ...assessment.features };
  const results = {};

  await Promise.all(
    HORIZONS.map(async (h) => {
      const { features, source } = buildScenarioFeatures(base, h.key, multipliers, forecast);
      const out = await api.predict(features);
      const p = out.flood_probability;
      const depth = depthFromProbability(p);
      results[h.key] = {
        key: h.key,
        label: h.label,
        days: h.days,
        until: endDate(h.days),
        features,
        source,
        probability: p,
        percent: +(p * 100).toFixed(1),
        riskClass: classify(p),
        modelClass: out.prediction,
        depth,
        before: houseStatus(depth, floorHeight),
      };
    })
  );
  return results;
}

// ------------------------------------------------------------
// Recommendations
// ------------------------------------------------------------
const ceil10 = (v) => Math.ceil(v * 10 - 1e-9) / 10;

export function buildRecommendation({ propertyType, floorHeight, scenarios, osm, centroid, A = ASSUMPTIONS }) {
  const list = Object.values(scenarios);
  const maxDepth = Math.max(...list.map((s) => s.depth));
  const yearClass = scenarios.year.riskClass;

  let requiredFloor = maxDepth > 0 ? ceil10(maxDepth + A.FREEBOARD_M) : 0;
  if (propertyType === "plot") {
    requiredFloor = Math.max(requiredFloor, A.MIN_NEW_FLOOR_M);
  }
  const raiseBy = Math.max(0, +(requiredFloor - floorHeight).toFixed(2));

  // nearest mapped waterway, for the drainage outlet
  let outlet = null;
  for (const w of osm?.waterways || []) {
    const r = distancePointToPolyline(centroid.x, centroid.z, w.points);
    if (!outlet || r.d < outlet.distance) {
      outlet = { distance: r.d, x: r.x, z: r.z, name: w.name || "", type: w.waterway };
    }
  }

  let verdict, headline;
  if (propertyType === "house") {
    if (maxDepth <= 0) {
      verdict = "safe";
      headline = "Your house is not expected to flood in these scenarios.";
    } else if (raiseBy > 0) {
      verdict = "raise";
      headline = `Raise the floor by about ${raiseBy.toFixed(1)} m.`;
    } else {
      verdict = "ok";
      headline = "Your floor is already high enough for these scenarios.";
    }
  } else if (yearClass === "High") {
    verdict = "avoid";
    headline = "Do not build on this plot.";
  } else if (yearClass === "Moderate") {
    verdict = "conditional";
    headline = "Build only with a raised, flood-resilient design.";
  } else {
    verdict = "suitable";
    headline = "This plot is suitable for building.";
  }

  const actions = [];
  if (propertyType === "house" && raiseBy > 0) {
    actions.push({
      title: `Raise the finished floor to ${requiredFloor.toFixed(1)} m above ground`,
      body:
        `Highest expected water depth is ${maxDepth.toFixed(2)} m. ` +
        `Adding ${A.FREEBOARD_M} m of freeboard gives ${requiredFloor.toFixed(1)} m. ` +
        `Your floor is ${floorHeight.toFixed(1)} m now, so raise it by ${raiseBy.toFixed(1)} m.`,
    });
  }
  if (propertyType === "plot") {
    actions.push({
      title:
        verdict === "avoid"
          ? `If you must build, set the floor at least ${requiredFloor.toFixed(1)} m above ground`
          : `Set the finished floor at least ${requiredFloor.toFixed(1)} m above ground`,
      body:
        `Highest expected water depth is ${maxDepth.toFixed(2)} m, plus ${A.FREEBOARD_M} m freeboard. ` +
        (verdict === "avoid"
          ? "The model rates this site High risk for a 2022-scale monsoon, so a safer plot is the better choice."
          : "Build on a solid plinth or stilts and keep services above this level."),
    });
  }
  actions.push({
    title: "Dig a perimeter drain and give it an outlet",
    body: outlet
      ? `Run a drain around the plot and lead it about ${Math.round(outlet.distance)} m to the nearest mapped ${outlet.type}${outlet.name ? " (" + outlet.name + ")" : ""}. Check with the local authority before connecting.`
      : "No waterway is mapped nearby. Lead the drain to a low point away from neighbouring houses, or to a soak pit.",
  });
  actions.push({
    title: "Use flood-resilient materials below the flood line",
    body: "Use waterproof damp-proof course, concrete or brick below the flood level, and keep electrical boards and meters above it.",
  });

  return { verdict, headline, maxDepth, requiredFloor, raiseBy, outlet, actions, yearClass };
}

// After following the recommendation
export function evaluateAfter(scenarios, newFloor) {
  const out = {};
  for (const [k, s] of Object.entries(scenarios)) {
    out[k] = { ...houseStatus(s.depth, newFloor), margin: +(newFloor - s.depth).toFixed(2) };
  }
  return out;
}
