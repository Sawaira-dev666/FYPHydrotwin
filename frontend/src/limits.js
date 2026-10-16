import { polygonToPolylineDistance, polygonsOverlap } from "./geo.js";

// ------------------------------------------------------------
// Where can a house stand? These are starting values for the app,
// NOT legal rules. Change them to match the local authority's
// by-laws (LDA, GDA, etc.).
// ------------------------------------------------------------
export const SITE_LIMITS = {
  // Width of the road / channel itself. Building on it is blocked.
  ROAD_WIDTH_M: {
    motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7,
    residential: 5, unclassified: 5, service: 3.5, track: 3, path: 1.5,
  },
  WATER_WIDTH_M: { river: 40, canal: 14, watercourse: 8, stream: 5, drain: 3.5, ditch: 2.5 },

  // A warning (not a block) appears when the property is closer than this
  // to the edge of the road / channel.
  ROAD_WARN_M: 3,
  WATER_WARN_M: { river: 30, canal: 15, watercourse: 8, stream: 5, drain: 3, ditch: 2 },
};

const label = (o, kind) => (o.name ? `${kind} "${o.name}"` : kind);

// poly: [[x,z],...] in local metres. Returns { blocked: [...], warnings: [...] }
export function checkSiteLimits(poly, type, osm, L = SITE_LIMITS) {
  const blocked = [];
  const warnings = [];
  const seen = new Set();
  const add = (list, msg) => {
    if (!seen.has(msg)) { seen.add(msg); list.push(msg); }
  };

  for (const r of osm?.roads || []) {
    const half = (L.ROAD_WIDTH_M[r.highway] || 5) / 2;
    const d = polygonToPolylineDistance(poly, r.points);
    if (d <= half) add(blocked, `It overlaps a road (${label(r, r.highway || "road")}).`);
    else if (d <= half + L.ROAD_WARN_M) add(warnings, `It is within ${L.ROAD_WARN_M} m of a road edge (${label(r, r.highway || "road")}).`);
  }

  for (const w of osm?.waterways || []) {
    const half = (L.WATER_WIDTH_M[w.waterway] || 5) / 2;
    const warn = L.WATER_WARN_M[w.waterway] ?? 5;
    const d = polygonToPolylineDistance(poly, w.points);
    const kind = w.waterway || "waterway";
    if (d <= half) add(blocked, `It overlaps a ${label(w, kind)}.`);
    else if (d <= half + warn) add(warnings, `It is within ${warn} m of a ${label(w, kind)}. Check the local setback rules.`);
  }

  // an empty plot cannot sit on top of an existing building
  if (type === "plot") {
    const hit = (osm?.buildings || []).filter((b) => polygonsOverlap(poly, b.footprint));
    if (hit.length) {
      add(blocked, `It overlaps ${hit.length} existing building${hit.length > 1 ? "s" : ""}. Choose "I have a house" or move the outline.`);
    }
  }
  return { blocked, warnings };
}
