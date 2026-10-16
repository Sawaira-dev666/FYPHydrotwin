import { PUNJAB_POLYGON } from "./config.js";

const M_PER_DEG_LAT = 111320;

// ---------- Punjab check ----------
export function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    const hit =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export const isInsidePunjabOutline = (lat, lon) =>
  pointInPolygon(lat, lon, PUNJAB_POLYGON);

// ---------- Search (OpenStreetMap Nominatim) ----------

// Accepts "31.5204, 74.3587", "31.5204N 74.3587E", or a Google Maps link
// that contains the coordinates. Returns { lat, lon } or null.
export function parseCoordinates(text) {
  const t = String(text || "").trim();
  let m =
    t.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) ||
    t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
    t.match(/[?&](?:q|ll|query)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/);
  if (!m) {
    m = t.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*N?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*E?\s*$/i);
  }
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Shorter and shorter versions of an address, longest first.
// "House 12, Street 3, Block B, Gulberg, Lahore" ->
//   the full text, then without "House 12", then without "Street 3", ...
export function addressVariants(query) {
  const q = String(query).replace(/\s+/g, " ").trim();
  const out = [];
  const add = (v) => {
    const t = v.trim();
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  const parts = q.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (let i = 0; i < parts.length; i++) add(parts.slice(i).join(", "));
  } else {
    const words = q.split(" ");
    for (let i = 0; i < words.length; i++) add(words.slice(i).join(" "));
  }
  return out.length > 6 ? [...out.slice(0, 3), ...out.slice(-3)] : out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function nominatim(q, bounded) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=pk&limit=8" +
    (bounded ? "&bounded=1&viewbox=69.2,34.1,75.6,27.4" : "") +
    "&q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Search service is not responding.");
  const rows = await res.json();
  return rows
    .map((r) => ({
      label: r.display_name,
      short: r.name || r.display_name.split(",")[0],
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      state: r.address?.state || "",
    }))
    .filter(
      (r) =>
        isInsidePunjabOutline(r.lat, r.lon) &&
        (!r.state || r.state.toLowerCase().includes("punjab"))
    );
}

// Returns { results, note, tried }.
//  - coordinates or a Google Maps link are used directly
//  - otherwise the full address is tried first, then shorter versions,
//    because house numbers and street names are rarely in the map data
export async function searchPlaces(query, onProgress = () => {}) {
  const coords = parseCoordinates(query);
  if (coords) {
    if (!isInsidePunjabOutline(coords.lat, coords.lon)) {
      return { results: [], note: "Those coordinates are outside Punjab, Pakistan.", tried: [] };
    }
    return {
      results: [{ short: "Your coordinates", label: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, lat: coords.lat, lon: coords.lon }],
      note: "Using the coordinates you typed.",
      tried: [],
    };
  }
  const variants = addressVariants(query);
  const tried = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    tried.push(v);
    onProgress(v);
    const found = await nominatim(v, true);
    if (found.length) {
      const note =
        i === 0
          ? ""
          : `The exact address is not in the map data, so these are the closest matches for "${v}". Pick one, then click the exact spot of your house on the map.`;
      return { results: found, note, tried };
    }
    if (i < variants.length - 1) await sleep(1100); // be polite to the free search service
  }
  return {
    results: [],
    note: "",
    tried,
  };
}

// Returns { ok: true|false|null, label } — null means "could not check".
export async function checkPunjab(lat, lon) {
  if (!isInsidePunjabOutline(lat, lon)) {
    return { ok: false, label: "", reason: "outline" };
  }
  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1" +
      `&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error("reverse failed");
    const data = await res.json();
    const a = data.address || {};
    const label =
      [a.city || a.town || a.village || a.suburb || a.county, a.state_district]
        .filter(Boolean)
        .join(", ") || (data.display_name || "").split(",").slice(0, 2).join(",");
    if (a.country_code && a.country_code !== "pk") {
      return { ok: false, label, reason: "country" };
    }
    if (a.state && !a.state.toLowerCase().includes("punjab")) {
      return { ok: false, label, reason: "state", state: a.state };
    }
    return { ok: true, label };
  } catch {
    return { ok: null, label: "" };
  }
}

// ---------- Local metre grid around the site ----------
// x = east (m), z = south (m). Same convention as the backend /osm-3d.
export function toLocal(lat0, lon0, lat, lon) {
  return {
    x: (lon - lon0) * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180),
    z: -(lat - lat0) * M_PER_DEG_LAT,
  };
}

export function toLatLon(lat0, lon0, x, z) {
  return {
    lat: lat0 - z / M_PER_DEG_LAT,
    lon: lon0 + x / (M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)),
  };
}

export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s) / 2;
}

export function polygonCentroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const f = x1 * z2 - x2 * z1;
    a += f;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = pts.length;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function pointInLocalPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distancePointToPolyline(x, z, line) {
  let best = { d: Infinity, x: 0, z: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, pz = az + t * dz;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, x: px, z: pz };
  }
  return best;
}

export function fmtCoord(v) {
  return Number(v).toFixed(5);
}

// ---------- Geometry used by the buildable-area checks ----------
function orient(ax, az, bx, bz, cx, cz) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

export function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function pointToSegment(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

export function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b));
}

// Smallest distance from a polygon (area) to a polyline. 0 = they touch or overlap.
export function polygonToPolylineDistance(poly, line) {
  if (line.some((p) => pointInLocalPolygon(p[0], p[1], poly))) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    for (let j = 0; j < line.length - 1; j++) {
      best = Math.min(best, segmentDistance(a, b, line[j], line[j + 1]));
      if (best === 0) return 0;
    }
  }
  return best;
}

// Do two polygons overlap?
export function polygonsOverlap(a, b) {
  if (a.some((p) => pointInLocalPolygon(p[0], p[1], b))) return true;
  if (b.some((p) => pointInLocalPolygon(p[0], p[1], a))) return true;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

// Best-fit rectangle for a property outline: it follows the longest edge.
// Returns { cx, cz, angle, w, d }  (w runs along the longest edge, in metres)
export function orientedRect(poly) {
  let best = 0, angle = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > best) { best = len; angle = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  const c = Math.cos(-angle), s = Math.sin(-angle);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    const rx = x * c - z * s, rz = x * s + z * c;
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
    minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
  }
  const mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
  // rotate the centre back to world space
  const cx = mx * Math.cos(angle) - mz * Math.sin(angle);
  const cz = mx * Math.sin(angle) + mz * Math.cos(angle);
  return { cx, cz, angle, w: maxX - minX, d: maxZ - minZ };
}
