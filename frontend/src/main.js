import "./styles.css";
import { SiteMap } from "./map.js";
import { Twin } from "./twin.js";
import { api } from "./api.js";
import { API_BASE, ASSUMPTIONS, HORIZONS, OSM_RADIUS_M } from "./config.js";
import {
  searchPlaces, checkPunjab, isInsidePunjabOutline, toLocal, toLatLon,
  polygonArea, polygonCentroid, fmtCoord,
} from "./geo.js";
import {
  fetchForecast, runScenarios, buildRecommendation, evaluateAfter, houseStatus,
} from "./analysis.js";
import { buildReportHTML } from "./report.js";
import { checkSiteLimits } from "./limits.js";
import { openImageTool } from "./imageTool.js";
import { houseSceneSVG } from "./illustration.js";
import { narrateRisk, narrateRec, narrateUpdated } from "./narration.js";
import { speak, stopSpeaking, voiceSupported } from "./voice.js";

const STEPS = [
  "Choose location", "Explore the 3D twin", "Mark your property",
  "Flood risk", "Recommendations", "Updated design", "Report",
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// ------------------------------------------------------------
// App state
// ------------------------------------------------------------
const state = {
  step: 1,
  maxStep: 1,
  query: "",
  results: [],
  searchMsg: "",
  pending: null,        // { lat, lon, state: checking|ok|bad, label, msg }
  site: null,           // locked site
  load: null,           // { terrain, osm, error }
  twinReady: false,
  prop: {
    type: "house", storeys: 1, floorH: 0.3, mode: "draw",
    poly: null, area: 0, centroid: null, draftN: 0, drawing: false,
    coords: { lat1: "", lon1: "", lat2: "", lon2: "" },
    note: "", error: "",
  },
  multipliers: { ...ASSUMPTIONS.RAIN_MULTIPLIER },
  analysis: null,       // { status, error, assessment, forecast, scenarios, multipliers }
  horizon: "year",
  rec: null,
  newFloor: 0,
  after: null,
  view: "before",
  voice: { auto: true },
  options: { satellite: true, buildings: true, roads: true, waterways: true, relief: 1 },
};

let siteMap = null;
let twin = null;

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
function toast(msg, ms = 5000) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function goStep(n) {
  stopSpeaking();
  state.step = n;
  state.maxStep = Math.max(state.maxStep, n);
  enterStep(n);
  render();
  autoSpeak(n);
}

// ------------------------------------------------------------
// Voice
// ------------------------------------------------------------
function narrationFor(n) {
  const a = state.analysis;
  if (!a || a.status !== "done") return "";
  if (n === 4) return narrateRisk({ scenarios: a.scenarios, propType: state.prop.type });
  if (n === 5 && state.rec) return narrateRec({ rec: state.rec });
  if (n === 6 && state.rec) {
    return narrateUpdated({ after: state.after, rec: state.rec, newFloor: state.newFloor, scenarios: a.scenarios });
  }
  return "";
}

function say(n, auto) {
  const text = narrationFor(n);
  if (!text) return;
  const res = speak(text);
  if (!res.ok && !auto) {
    toast("This browser cannot read text aloud.");
  }
}

function autoSpeak(n) {
  if (state.voice.auto && [4, 5, 6].includes(n)) say(n, true);
}

function voiceBar() {
  if (!voiceSupported()) return "";
  const v = state.voice;
  return `<div class="card voice">
    <strong>Voice</strong>
    <div class="row" style="margin-top:8px">
      <button type="button" class="btn ghost small" data-act="speak">Read aloud</button>
      <button type="button" class="btn ghost small" data-act="stop-speak">Stop</button>
    </div>
    <label class="check" style="margin-top:6px"><input type="checkbox" data-voice-auto ${v.auto ? "checked" : ""}/> Read results automatically</label>
  </div>`;
}

function sceneFor(h, mode) {
  const s = state.analysis.scenarios[h];
  const p = state.prop;
  return {
    mode,
    depth: s.depth,
    floorHeight: mode === "after" ? state.newFloor : p.floorH,
    storeys: p.storeys,
    type: p.type,
    verdict: state.rec?.verdict,
    outlet: state.rec?.outlet,
    showWater: true,
  };
}

function enterStep(n) {
  if (!twin || !state.twinReady) return;
  if (n !== 3) {
    twin.stopDraw();
    state.prop.drawing = false;
  }
  if (n === 2) twin.overview();
  if (n === 3) {
    if (state.prop.poly) {
      twin.previewProperty();
      twin.focusProperty();
    } else twin.clearScenario();
  }
  if (n === 4 || n === 5) {
    if (state.analysis?.scenarios) {
      twin.setScenario(sceneFor(state.horizon, "before"));
      twin.focusProperty();
    }
  }
  if (n === 6 && state.analysis?.scenarios) {
    twin.setScenario(sceneFor(state.horizon, state.view));
    twin.focusProperty();
  }
}

// ------------------------------------------------------------
// Rail
// ------------------------------------------------------------
function renderRail() {
  $("steps").innerHTML = STEPS.map((label, i) => {
    const n = i + 1;
    const done = n < state.step ? "done" : "";
    return `<li class="${n === state.step ? "current" : done}" data-step="${n}"><span class="n"><span>${n}</span></span><span class="t">${label}</span></li>`;
  }).join("");
}

// ------------------------------------------------------------
// Panel templates
// ------------------------------------------------------------
function viewOptions() {
  const o = state.options;
  const box = (k, t) =>
    `<label class="check"><input type="checkbox" data-layer="${k}" ${o[k] ? "checked" : ""}/> ${t}</label>`;
  return `<details>
    <summary>View options</summary>
    ${box("satellite", "Satellite imagery")}
    ${box("buildings", "Buildings")}
    ${box("roads", "Roads")}
    ${box("waterways", "Rivers, canals and drains")}
    <div class="field" style="margin-top:8px">
      <label for="relief">Terrain relief: ${o.relief}x <small style="display:inline">(Punjab is very flat. Higher values exaggerate the slope, and flood water depth beside buildings looks deeper.)</small></label>
      <input id="relief" type="range" min="1" max="8" step="1" value="${o.relief}" />
    </div>
  </details>`;
}

function panel1() {
  const p = state.pending;
  let status = "";
  if (p) {
    const dot = p.state === "checking" ? "busy" : p.state === "ok" ? "ok" : "bad";
    status = `<div class="card status" style="margin:14px 0">
      <span class="dot ${dot}"></span>
      <div><strong>${esc(p.label || "Selected point")}</strong>
      <small>${fmtCoord(p.lat)}, ${fmtCoord(p.lon)}</small>
      <small>${esc(p.msg)}</small></div></div>`;
  }
  const list = state.results.length
    ? `<ul class="results">${state.results
        .map((r, i) => `<li><button type="button" data-act="pick-result" data-i="${i}">${esc(r.short)}<span class="sub">${esc(r.label)}</span></button></li>`)
        .join("")}</ul>`
    : "";
  return `
    <h1>Choose a site in Punjab</h1>
    <p class="lead">Search for an address, area or city, or click the exact spot on the map.</p>
    <form id="search-form" class="row" autocomplete="off">
      <div class="field" style="flex:1"><label for="q" class="sr" style="position:absolute;left:-9999px">Search a place</label>
      <input id="q" type="search" placeholder="Address, area, coordinates or a Google Maps link" value="${esc(state.query)}" /></div>
      <button class="btn small" type="submit">Search</button>
    </form>
    ${state.searchMsg ? `<small style="margin-top:6px">${esc(state.searchMsg)}</small>` : ""}
    ${list}
    <small style="margin-top:8px">Tip: house numbers are rarely in the map data. If your address is not found, search the area, or in Google Maps right-click your house, copy the coordinates and paste them here.</small>
    ${status}
    <button class="btn full" data-act="lock" ${p?.state === "ok" ? "" : "disabled"}>Lock location and open the 3D twin</button>
    <small style="margin-top:8px">Only Punjab, Pakistan can be selected. Once locked, the location cannot be changed. Use Start over to assess another site.</small>`;
}

function loadRow(label, st) {
  const dot = st === "ok" ? "ok" : st === "bad" ? "bad" : st === "" ? "" : "busy";
  return `<li class="status"><span class="dot ${dot}"></span><div>${label}</div></li>`;
}

function panel2() {
  const s = state.site;
  if (!state.twinReady) {
    const l = state.load || {};
    return `
      <h1>Building your 3D twin</h1>
      <p class="lead">Location locked at ${fmtCoord(s.lat)}, ${fmtCoord(s.lon)}.</p>
      <ul class="load-list">
        ${loadRow("Terrain from the elevation model", l.terrain)}
        ${loadRow("Buildings, roads, rivers and canals", l.osm)}
      </ul>
      ${l.error ? `<div class="verdict avoid"><strong>Could not build the twin</strong><p>${esc(l.error)}</p></div>
        <button class="btn" data-act="retry-twin">Try again</button>` : `<small>This can take a minute the first time.</small>`}`;
  }
  const t = twin.data;
  const c = t.osm?.counts || {};
  return `
    <h1>Explore your site</h1>
    <p class="lead">This is a 2 km by 2 km area around your location, built from real elevation and map data.</p>
    <div class="card">
      <table class="kv">
        <tr><td>Buildings</td><td>${(c.buildings ?? 0).toLocaleString()}</td></tr>
        <tr><td>Roads</td><td>${(c.roads ?? 0).toLocaleString()}</td></tr>
        <tr><td>Rivers, canals and drains</td><td>${(c.waterways ?? 0).toLocaleString()}</td></tr>
        <tr><td>Ground height range</td><td>${t.terrain.min_elevation_m.toFixed(1)} to ${t.terrain.max_elevation_m.toFixed(1)} m</td></tr>
      </table>
    </div>
    <p style="margin-top:12px">Drag to turn the view through 360 degrees, scroll to zoom, and use Street level to stand on the ground. With a VR headset, use the VR button.</p>
    ${viewOptions()}
    <div class="spacer"></div>
    <button class="btn full" data-act="to-property">Mark my property</button>`;
}

function panel3() {
  const p = state.prop;
  const house = p.type === "house";
  const storeys = (v) => [1, 2, 3, 4].map((n) => `<option value="${n}" ${v === n ? "selected" : ""}>${n}</option>`).join("");
  let method;
  if (p.mode === "draw") {
    method = `
      <p>${p.drawing
        ? "Click the corners of your property on the 3D ground, in order. Rotate and zoom as you go."
        : "Draw the outline of your property on the 3D ground."}</p>
      <div class="row">
        ${p.drawing
          ? `<button class="btn small" data-act="finish-draw" ${p.draftN >= 3 ? "" : "disabled"}>Finish outline (${p.draftN} points)</button>
             <button class="btn ghost small" data-act="undo-draw" ${p.draftN ? "" : "disabled"}>Undo point</button>
             <button class="btn ghost small" data-act="cancel-draw">Cancel</button>`
          : `<button class="btn small" data-act="start-draw">${p.poly ? "Draw again" : "Start drawing"}</button>`}
      </div>`;
  } else {
    const c = p.coords;
    method = `
      <p>Enter two opposite corners of your property: from the south-west corner to the north-east corner.</p>
      <div class="grid2">
        <div class="field"><label for="lat1">From: latitude</label><input id="lat1" data-bind="prop.coords.lat1" inputmode="decimal" placeholder="31.5204" value="${esc(c.lat1)}"/></div>
        <div class="field"><label for="lon1">From: longitude</label><input id="lon1" data-bind="prop.coords.lon1" inputmode="decimal" placeholder="74.3587" value="${esc(c.lon1)}"/></div>
        <div class="field"><label for="lat2">To: latitude</label><input id="lat2" data-bind="prop.coords.lat2" inputmode="decimal" placeholder="31.5210" value="${esc(c.lat2)}"/></div>
        <div class="field"><label for="lon2">To: longitude</label><input id="lon2" data-bind="prop.coords.lon2" inputmode="decimal" placeholder="74.3594" value="${esc(c.lon2)}"/></div>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn small" data-act="place-coords">Place on the 3D ground</button></div>
      <small style="margin-top:6px">Your site is at ${fmtCoord(state.site.lat)}, ${fmtCoord(state.site.lon)}. The property must lie within 1 km of it.</small>`;
  }
  const summary = p.poly
    ? `<div class="card status" style="margin-top:14px"><span class="dot ok"></span><div>
        <strong>Property marked</strong>
        <small>${Math.round(p.area).toLocaleString()} m² around ${fmtCoord(p.centroid.lat)}, ${fmtCoord(p.centroid.lon)}</small>
        ${p.note ? `<small>${esc(p.note)}</small>` : ""}
        <small>Not on a road, waterway${p.type === "plot" ? " or existing building" : ""}.</small>
        ${(p.warnings || []).map((w) => `<small style="color:var(--warn)">Careful: ${esc(w)}</small>`).join("")}</div></div>` : "";
  return `
    <h1>Mark your property</h1>
    <p class="lead">Tell us what is on the land, then show us where it is.</p>
    <div class="seg" role="group" aria-label="Property type">
      <button type="button" data-act="ptype" data-v="house" aria-pressed="${house}">I have a house</button>
      <button type="button" data-act="ptype" data-v="plot" aria-pressed="${!house}">Empty plot</button>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div class="field"><label for="storeys">${house ? "Storeys" : "Storeys you plan to build"}</label>
        <select id="storeys" data-bind="prop.storeys" data-num>${storeys(p.storeys)}</select></div>
      <div class="field"><label for="floorH">${house ? "Floor height above ground (m)" : "Planned floor height (m)"}</label>
        <input id="floorH" type="number" min="-0.8" max="3" step="0.05" data-bind="prop.floorH" data-num value="${p.floorH}"/></div>
    </div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn ghost small" data-act="img-levels">Measure floor height from a photo</button></div>
    ${p.floorNote ? `<small style="margin-top:6px">${esc(p.floorNote)}</small>` : ""}
    <h2>Where is it?</h2>
    <div class="seg" role="group" aria-label="How to mark it">
      <button type="button" data-act="pmode" data-v="draw" aria-pressed="${p.mode === "draw"}">Draw on the map</button>
      <button type="button" data-act="pmode" data-v="write" aria-pressed="${p.mode === "write"}">Write coordinates</button>
    </div>
    <div style="margin-top:12px">${method}</div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn ghost small" data-act="img-plan">…or measure the plot from a plan picture</button></div>
    ${p.error ? `<div class="verdict avoid" style="margin-top:10px"><p>${esc(p.error)}</p></div>` : ""}
    ${summary}
    <div class="spacer"></div>
    <button class="btn full" data-act="analyze" ${p.poly ? "" : "disabled"}>Analyze flood risk</button>`;
}

function beforeText(s) {
  return s.before;
}

function overallHeadline() {
  const sc = Object.values(state.analysis.scenarios);
  const house = state.prop.type === "house";
  const worst = sc.reduce((a, b) => (b.probability > a.probability ? b : a));
  const flooded = sc.filter((s) => beforeText(s).key === "flooded");
  const around = sc.filter((s) => beforeText(s).key === "around");
  let key, title;
  if (flooded.length) {
    key = "flooded";
    title = house
      ? `Your house floods in the ${flooded[0].label.toLowerCase()} scenario${flooded.length > 1 ? " and later" : ""}.`
      : `Your planned house floods in the ${flooded[0].label.toLowerCase()} scenario${flooded.length > 1 ? " and later" : ""}.`;
  } else if (around.length) {
    key = "raise";
    title = "Water reaches your property, but stays below the floor.";
  } else {
    key = "safe";
    title = house ? "Your house stays safe in all three scenarios." : "Your planned house stays safe in all three scenarios.";
  }
  return { key, title, worst };
}

function panel4() {
  const a = state.analysis;
  if (!a || a.status === "loading") {
    return `
      <h1>Analyzing flood risk</h1>
      <p class="lead">Reading the terrain, rivers, canals, roads and rainfall at your property, then running the trained model.</p>
      <ul class="load-list">
        ${loadRow("Collecting the nine environmental features", a?.step >= 1 ? "ok" : "busy")}
        ${loadRow("Checking the live rainfall forecast", a?.step >= 2 ? "ok" : a?.step >= 1 ? "busy" : "")}
        ${loadRow("Running the week, month and year scenarios", a?.step >= 3 ? "ok" : a?.step >= 2 ? "busy" : "")}
      </ul>
      <small>Collecting features can take up to a minute.</small>`;
  }
  if (a.status === "error") {
    return `
      <h1>The analysis did not finish</h1>
      <div class="verdict avoid"><strong>What went wrong</strong><p>${esc(a.error)}</p></div>
      <div class="row"><button class="btn" data-act="analyze">Try again</button>
      <button class="btn ghost" data-act="back-property">Edit property</button></div>`;
  }
  const sc = a.scenarios;
  const cur = sc[state.horizon];
  const h = overallHeadline();
  const bt = beforeText(cur);
  const buttons = HORIZONS.map((x) => {
    const s = sc[x.key];
    return `<button type="button" data-act="horizon" data-v="${x.key}" aria-pressed="${state.horizon === x.key}">
      <span class="lab">${x.label}</span><span class="big">${s.percent}%</span><span class="pill ${s.riskClass}">${s.riskClass}</span></button>`;
  }).join("");
  const mult = (k, t) =>
    `<div class="field"><label for="m-${k}">${t}</label><input id="m-${k}" type="number" min="0" max="2" step="0.05" data-bind="multipliers.${k}" data-num value="${state.multipliers[k]}"/></div>`;
  const feats = Object.entries(a.assessment.features)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v == null ? "n/a" : Number(v).toFixed(2)}</td></tr>`)
    .join("");
  return `
    <h1>Flood risk at your property</h1>
    <div class="verdict ${h.key}"><strong>${esc(h.title)}</strong>
      <p>Highest risk: ${h.worst.label.toLowerCase()}, ${h.worst.percent}% (${h.worst.riskClass}).</p></div>
    <div class="hz" role="group" aria-label="Time frame">${buttons}</div>
    <div class="meter" aria-hidden="true"><b style="left:${Math.min(98, Math.max(2, cur.percent))}%">${cur.percent}%</b><i style="left:${cur.percent}%"></i></div>
    <div class="scale"><span>Low</span><span>Moderate</span><span>High</span></div>
    <div class="card" style="margin-top:14px">
      <table class="kv">
        <tr><td>${cur.label} until</td><td>${fmtDate(cur.until)}</td></tr>
        <tr><td>Risk class</td><td><span class="pill ${cur.riskClass}">${cur.riskClass}</span></td></tr>
        <tr><td>Drawn water depth</td><td>${cur.depth.toFixed(2)} m</td></tr>
        <tr><td>${state.prop.type === "house" ? "Your house" : "Your planned house"}</td><td><span class="pill ${bt.key}">${esc(bt.text)}</span></td></tr>
        <tr><td>Rainfall input</td><td>${cur.source === "forecast" ? "Live 7-day forecast" : Math.round(state.multipliers[cur.key] * 100) + "% of the 2022 peak"}</td></tr>
      </table>
    </div>
    <figure class="scene">${houseSceneSVG({ depth: cur.depth, floor: state.prop.floorH, storeys: state.prop.storeys, caption: cur.label })}</figure>
    ${voiceBar()}
    <small style="margin-top:10px">These are rainfall scenarios from the trained model, not a weather forecast. The blue water in 3D is an estimate, not a flood simulation.</small>
    <details><summary>Rainfall assumptions</summary>
      <div class="grid2" style="margin-top:8px">${mult("month", "Month: share of 2022 peak")}${mult("year", "Year: share of 2022 peak")}</div>
      ${mult("week", "Week: share of 2022 peak, used only if no live forecast")}
      <div class="row" style="margin-top:8px"><button class="btn ghost small" data-act="rerun">Run again</button></div>
      <small style="margin-top:6px">${a.forecast ? `Live forecast loaded: ${a.forecast.sum7.toFixed(0)} mm over 7 days.` : "No live forecast could be loaded (needs internet)."}</small>
    </details>
    <details><summary>The nine model inputs at your property</summary><table class="kv">${feats}</table></details>
    ${viewOptions()}
    <div class="spacer"></div>
    <button class="btn full" data-act="to-rec">See recommendations</button>`;
}

function panel5() {
  const r = state.rec;
  const house = state.prop.type === "house";
  const figs = `<div class="card"><table class="kv">
      <tr><td>Highest drawn water depth</td><td>${r.maxDepth.toFixed(2)} m</td></tr>
      <tr><td>${house ? "Recommended floor height" : "Minimum floor height if you build"}</td><td>${r.requiredFloor.toFixed(1)} m</td></tr>
      <tr><td>${house ? "Your floor now" : "Your planned floor"}</td><td>${state.prop.floorH.toFixed(1)} m</td></tr><tr><td>Raise by</td><td>${r.raiseBy.toFixed(1)} m</td></tr>
    </table></div>`;
  const acts = r.actions.map((a) => `<li><strong>${esc(a.title)}</strong><span>${esc(a.body)}</span></li>`).join("");
  return `
    <h1>What to do</h1>
    <div class="verdict ${r.verdict}"><strong>${esc(r.headline)}</strong>
      <p>${house ? "Based on the highest water depth across the three scenarios." : "Based on the one-year scenario and the highest water depth."}</p></div>
    ${figs}
    <h2>Recommended changes</h2>
    <ol class="acts">${acts}</ol>
    <small style="margin-top:12px">Floor height = highest water depth + ${ASSUMPTIONS.FREEBOARD_M} m freeboard. The model itself changes very little with floor height, so this part uses a standard safety margin instead of the model.</small>
    <div class="spacer"></div>
    ${voiceBar()}
    <div class="spacer"></div>
    <button class="btn full" data-act="view-updated">View updated design</button>`;
}

function panel6() {
  const a = state.analysis;
  const sc = a.scenarios;
  const house = state.prop.type === "house";
  const buttons = HORIZONS.map((x) => {
    const s = sc[x.key];
    const st = state.view === "after" ? state.after[x.key] : beforeText(s);
    return `<button type="button" data-act="horizon" data-v="${x.key}" aria-pressed="${state.horizon === x.key}">
      <span class="lab">${x.label}</span><span class="big">${s.depth.toFixed(1)} m</span><span class="pill ${st.key}">${st.key === "dry" ? "Dry" : st.key === "around" ? "Dry floor" : "Flooded"}</span></button>`;
  }).join("");
  const allSafe = Object.values(state.after).every((s) => s.key !== "flooded");
  const year = sc.year;
  const r = state.rec;
  let msg;
  if (r.verdict === "avoid") {
    msg = `We still advise against building here. If you do, a floor at ${state.newFloor.toFixed(1)} m keeps the house above the drawn water in all three scenarios.`;
  } else if (allSafe) {
    msg = `With the floor at ${state.newFloor.toFixed(1)} m, water stays below the floor in all three scenarios, through ${fmtDate(year.until)}.`;
  } else {
    msg = "Water still reaches the floor in one scenario. Raise the floor further.";
  }
  return `
    <h1>Updated design</h1>
    <div class="seg" role="group" aria-label="Design version">
      <button type="button" data-act="view" data-v="before" aria-pressed="${state.view === "before"}">${house ? "Current house" : "Planned house"}</button>
      <button type="button" data-act="view" data-v="after" aria-pressed="${state.view === "after"}">With changes</button>
    </div>
    <div class="spacer"></div>
    <div class="hz" role="group" aria-label="Time frame">${buttons}</div>
    <div class="verdict ${allSafe && r.verdict !== "avoid" ? "safe" : "raise"}" style="margin-top:14px"><strong>${state.view === "after" ? "With the changes" : "Today"}</strong><p>${state.view === "after" ? esc(msg) : "Switch to With changes to see the raised floor and the perimeter drain."}</p></div>
    <div class="card"><table class="kv">
      <tr><td>Floor height ${state.view === "after" ? "(new)" : "(now)"}</td><td>${(state.view === "after" ? state.newFloor : state.prop.floorH).toFixed(1)} m</td></tr>
      <tr><td>Drawn water depth, ${sc[state.horizon].label.toLowerCase()}</td><td>${sc[state.horizon].depth.toFixed(2)} m</td></tr>
    </table></div>
    <figure class="scene">${houseSceneSVG({
      depth: sc[state.horizon].depth,
      floor: state.view === "after" ? state.newFloor : state.prop.floorH,
      storeys: state.prop.storeys,
      caption: sc[state.horizon].label,
      raised: state.view === "after" && state.newFloor > state.prop.floorH + 0.01,
    })}</figure>
    ${voiceBar()}
    <small style="margin-top:10px">The cyan line is the perimeter drain${r.outlet ? ", with an outlet toward the nearest mapped waterway" : ""}.</small>
    ${viewOptions()}
    <div class="spacer"></div>
    <button class="btn full" data-act="report">Generate report</button>`;
}

function panel7() {
  return `
    <h1>Report</h1>
    <p class="lead">${state.reportBusy ? "Preparing the before and after pictures…" : "Your report is ready."}</p>
    ${state.reportBusy ? '<div class="ring" style="margin:10px 0"></div>' : `
    <div class="row"><button class="btn" data-act="open-report">Open report</button>
    <button class="btn ghost" data-act="back-updated">Back to design</button></div>`}`;
}

function renderPanel() {
  const html = [panel1, panel2, panel3, panel4, panel5, panel6, panel7][state.step - 1]();
  const keep = $("panel").scrollTop;
  $("panel").innerHTML = html;
  $("panel").scrollTop = keep;
}

function render() {
  renderRail();
  renderPanel();
  const showTwin = state.twinReady && state.step >= 2;
  $("toolbar").hidden = !showTwin;
  $("hud").hidden = !showTwin;
}

// ------------------------------------------------------------
// Step 1: choose the site
// ------------------------------------------------------------
async function pickPoint(lat, lon, label = "") {
  if (state.site) return;
  const token = (pickPoint.token = (pickPoint.token || 0) + 1);
  siteMap.setMarker(lat, lon);
  state.pending = { lat, lon, label, state: "checking", msg: "Checking that this spot is in Punjab…" };
  render();
  const res = await checkPunjab(lat, lon);
  if (token !== pickPoint.token) return;
  const p = state.pending;
  if (res.ok === false) {
    p.state = "bad";
    p.label = res.label || label;
    p.msg =
      res.reason === "state"
        ? `This spot is in ${res.state}, not Punjab. Choose a place inside the dashed outline.`
        : "This spot is outside Punjab, Pakistan. Choose a place inside the dashed outline.";
  } else {
    p.state = "ok";
    p.label = res.label || label || "Selected point";
    p.msg = res.ok === null ? "Inside Punjab (checked with the map outline; the online check was unavailable)." : "Inside Punjab.";
  }
  render();
}

async function doSearch(q) {
  state.query = q;
  state.results = [];
  if (q.trim().length < 2) {
    state.searchMsg = "Type at least two letters.";
    return render();
  }
  state.searchMsg = "Searching…";
  render();
  try {
    const out = await searchPlaces(q.trim(), (v) => {
      state.searchMsg = `Searching for "${v}"…`;
      render();
    });
    state.results = out.results;
    if (out.results.length) state.searchMsg = out.note;
    else if (out.note) state.searchMsg = out.note;
    else {
      state.searchMsg =
        "Nothing in Punjab matches that, even after shortening the address. " +
        "Try the area or city name, click the map, or paste coordinates from Google Maps.";
    }
    // a single coordinate result is picked straight away
    if (out.results.length === 1 && out.results[0].short === "Your coordinates") {
      const r = out.results[0];
      state.results = [];
      siteMap.flyTo(r.lat, r.lon, 17);
      render();
      return pickPoint(r.lat, r.lon, "Your coordinates");
    }
  } catch {
    state.searchMsg = "Search is unavailable right now (it needs internet). Click the map, or paste coordinates.";
  }
  render();
  $("q")?.focus();
}

async function lockLocation() {
  const p = state.pending;
  if (!p || p.state !== "ok") return;
  state.site = { lat: p.lat, lon: p.lon, label: p.label };
  siteMap.lock();
  $("stage").classList.add("locked");
  $("lock-coords").textContent = `${fmtCoord(p.lat)}, ${fmtCoord(p.lon)}`;
  $("lockmark").hidden = false;
  state.step = 2;
  state.maxStep = 2;
  openTwin();
}

async function openTwin() {
  state.load = { terrain: "busy", osm: "busy", error: "" };
  render();
  const { lat, lon } = state.site;
  const t = api.terrain(lat, lon).then(
    (r) => { state.load.terrain = "ok"; render(); return r; },
    (e) => { state.load.terrain = "bad"; throw e; }
  );
  const o = api.osm(lat, lon, OSM_RADIUS_M).then(
    (r) => { state.load.osm = "ok"; render(); return r; },
    (e) => { state.load.osm = "bad"; throw e; }
  );
  try {
    const [terrain, osm] = await Promise.all([t, o]);
    if (!twin) {
      twin = new Twin($("twin"));
      twin.enableVR($("vr-slot"), (msg) => toast(msg, 12000));
    }
    twin.load({ terrain, osm, lat, lon });
    state.twinReady = true;
    $("stage").dataset.view = "twin";
    twin.intro();
    watchSatellite();
    render();
  } catch (e) {
    await Promise.allSettled([t, o]);
    state.load.error = e.message;
    render();
  }
}

function watchSatellite() {
  const note = $("sat-note");
  const tick = () => {
    const s = twin.satStatus;
    note.textContent =
      s === "ready" ? " · Imagery © Esri" : s === "unavailable" ? " · Satellite imagery unavailable, showing ground colours" : " · Loading imagery…";
    if (s === "loading" || !s) setTimeout(tick, 1500);
  };
  tick();
}

// ------------------------------------------------------------
// Step 3: property
// ------------------------------------------------------------
function applyPolygon(poly) {
  const area = polygonArea(poly);
  if (area < 20) return (state.prop.error = "That outline is too small. Mark at least 20 m².");
  if (area > 100000) return (state.prop.error = "That outline is larger than 10 hectares. Mark just your property.");
  const p = state.prop;
  const lim = checkSiteLimits(poly, p.type, twin.data.osm);
  if (lim.blocked.length) {
    // refuse the area: remove the outline so the user can try again
    twin.stopDraw();
    twin.clearDraft();
    p.drawing = false;
    p.poly = null;
    p.warnings = [];
    twin.clearProperty();
    state.analysis = null;
    state.rec = null;
    return (p.error = "You can't build here. " + lim.blocked.join(" "));
  }
  p.warnings = lim.warnings;
  const [cx, cz] = polygonCentroid(poly);
  const ll = toLatLon(state.site.lat, state.site.lon, cx, cz);
  p.poly = poly;
  p.area = area;
  p.centroid = { lat: ll.lat, lon: ll.lon, x: cx, z: cz };
  p.error = "";
  p.drawing = false;
  twin.stopDraw();
  const info = twin.setProperty(poly, { type: p.type, storeys: p.storeys, floorHeight: p.floorH });
  p.note =
    p.type === "house"
      ? info.proxy ? "No mapped building was found here, so a model house is built in the middle of the plot." : `Found ${info.count} mapped building${info.count > 1 ? "s" : ""} on the property.`
      : "A model house is built on your plot so you can see how water would reach it.";
  twin.focusProperty();
  state.analysis = null;
  state.rec = null;
  return null;
}

function placeCoords() {
  const c = state.prop.coords;
  const v = ["lat1", "lon1", "lat2", "lon2"].map((k) => parseFloat(c[k]));
  if (v.some((n) => Number.isNaN(n))) return (state.prop.error = "Fill in all four numbers.");
  const [la1, lo1, la2, lo2] = v;
  if (![[la1, lo1], [la2, lo2]].every(([a, b]) => isInsidePunjabOutline(a, b))) {
    return (state.prop.error = "Both corners must be inside Punjab, Pakistan.");
  }
  const a = toLocal(state.site.lat, state.site.lon, Math.min(la1, la2), Math.min(lo1, lo2));
  const b = toLocal(state.site.lat, state.site.lon, Math.max(la1, la2), Math.max(lo1, lo2));
  const lim = 1000;
  if ([a.x, a.z, b.x, b.z].some((n) => Math.abs(n) > lim)) {
    return (state.prop.error = "A corner is outside the 2 km area shown. Use coordinates within 1 km of your site.");
  }
  const poly = [[a.x, a.z], [b.x, a.z], [b.x, b.z], [a.x, b.z]];
  return applyPolygon(poly);
}

// ------------------------------------------------------------
// Step 4: analysis
// ------------------------------------------------------------
async function runAnalysis(reuse = false) {
  const p = state.prop;
  state.step = 4;
  state.maxStep = Math.max(state.maxStep, 4);
  const prev = state.analysis;
  state.analysis = { status: "loading", step: reuse ? 2 : 0 };
  twin.clearScenario();
  render();
  try {
    let assessment, forecast;
    if (reuse && prev?.assessment) {
      assessment = prev.assessment;
      forecast = prev.forecast;
    } else {
      assessment = await api.assess(p.centroid.lat, p.centroid.lon);
      const f = { ...assessment.features };
      if (f.elevation_m == null) f.elevation_m = twin.elevAt(p.centroid.x, p.centroid.z);
      const missing = Object.entries(f).filter(([k, v]) => v == null && k !== "hand_m").map(([k]) => k);
      if (missing.length) {
        throw new Error(`The backend could not read these values for this spot: ${missing.join(", ")}. Try a point closer to a road or river.`);
      }
      assessment.features = f;
      state.analysis.step = 1;
      render();
      forecast = await fetchForecast(p.centroid.lat, p.centroid.lon);
      state.analysis.step = 2;
      render();
    }
    const scenarios = await runScenarios({
      assessment,
      multipliers: state.multipliers,
      forecast,
      floorHeight: p.floorH,
    });
    state.analysis = { status: "done", assessment, forecast, scenarios, multipliers: { ...state.multipliers } };
    computeRecommendation();
    twin.setScenario(sceneFor(state.horizon, "before"));
    twin.focusProperty();
    render();
    autoSpeak(4);
  } catch (e) {
    state.analysis = { status: "error", error: e.message };
    render();
  }
}

function computeRecommendation() {
  const p = state.prop;
  const a = state.analysis;
  // fix labels for empty plots
  const rec = buildRecommendation({
    propertyType: p.type,
    floorHeight: p.floorH,
    scenarios: a.scenarios,
    osm: twin.data.osm,
    centroid: p.centroid,
  });
  state.rec = rec;
  state.newFloor = Math.max(p.floorH, rec.requiredFloor);
  state.after = evaluateAfter(a.scenarios, state.newFloor);
}

// ------------------------------------------------------------
// Step 7: report
// ------------------------------------------------------------
async function makeReport() {
  state.step = 7;
  state.maxStep = 7;
  state.reportBusy = true;
  render();
  await new Promise((r) => setTimeout(r, 400));
  try {
    const keepH = state.horizon, keepV = state.view;
    twin.setScenario(sceneFor("year", "before"));
    await new Promise((r) => setTimeout(r, 250));
    const before = await twin.snapshot();
    twin.setScenario(sceneFor("year", "after"));
    await new Promise((r) => setTimeout(r, 250));
    const after = await twin.snapshot();
    state.horizon = keepH;
    state.view = keepV;
    twin.setScenario(sceneFor(keepH, keepV));
    state.images = { before, after };
  } catch (e) {
    state.images = { before: "", after: "" };
    toast("Could not capture the 3D pictures: " + e.message);
  }
  state.reportBusy = false;
  render();
  openReport();
}

function openReport() {
  const r = $("report");
  const s = {
    site: state.site, prop: state.prop, analysis: state.analysis,
    rec: state.rec, after: state.after, newFloor: state.newFloor,
  };
  r.innerHTML = buildReportHTML(s, state.images);
  r.hidden = false;
  $("rp-print").onclick = () => window.print();
  $("rp-close").onclick = () => (r.hidden = true);
  $("rp-download").onclick = downloadReport;
}

function downloadReport() {
  let css = "";
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.cssText.includes("#report") || rule.cssText.startsWith(":root")) css += rule.cssText + "\n";
      }
    } catch { /* cross-origin sheet */ }
  }
  const sheet = $("rp-sheet").outerHTML;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>HydroTwin AI report</title><style>body{margin:0;background:#d9e1de;font-family:system-ui,sans-serif}${css}#report{position:static!important}</style></head><body><div id="report">${sheet}</div></body></html>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = "hydrotwin-flood-report.html";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------
const actions = {
  "pick-result"(el) {
    const r = state.results[+el.dataset.i];
    state.results = [];
    siteMap.flyTo(r.lat, r.lon, 15);
    pickPoint(r.lat, r.lon, r.short);
  },
  lock: lockLocation,
  "retry-twin": openTwin,
  "to-property": () => goStep(3),
  ptype(el) {
    const p = state.prop;
    p.type = el.dataset.v;
    // sensible starting floor height for each case
    if (p.type === "plot" && p.floorH === 0.3) p.floorH = 0.45;
    if (p.type === "house" && p.floorH === 0.45) p.floorH = 0.3;
    refreshProperty();
  },
  pmode(el) {
    if (state.prop.drawing) { twin.stopDraw(); twin.clearDraft(); state.prop.drawing = false; }
    state.prop.mode = el.dataset.v;
    state.prop.error = "";
    render();
  },
  "start-draw"() {
    const p = state.prop;
    p.error = "";
    p.drawing = true;
    p.draftN = 0;
    twin.clearDraft();
    twin.startDraw((pts) => { state.prop.draftN = pts.length; render(); });
    twin.clearScenario();
    render();
  },
  "undo-draw": () => twin.undoPoint(),
  "cancel-draw"() { twin.stopDraw(); twin.clearDraft(); state.prop.drawing = false; render(); },
  "finish-draw"() {
    const pts = twin.draft.slice();
    if (pts.length < 3) return toast("Add at least three corner points.");
    applyPolygon(pts);
    render();
  },
  "place-coords"() { placeCoords(); render(); },
  analyze: () => runAnalysis(false),
  rerun: () => runAnalysis(true),
  "back-property": () => goStep(3),
  horizon(el) {
    state.horizon = el.dataset.v;
    const mode = state.step === 6 ? state.view : "before";
    twin.setScenario(sceneFor(state.horizon, mode));
    render();
  },
  "to-rec": () => goStep(5),
  "view-updated"() { state.view = "after"; goStep(6); },
  view(el) {
    state.view = el.dataset.v;
    twin.setScenario(sceneFor(state.horizon, state.view));
    render();
  },
  report: makeReport,
  "open-report": openReport,
  "back-updated": () => goStep(6),
  "img-levels"() {
    openImageTool({
      mode: "levels", site: state.site,
      onDone(res) {
        const p = state.prop;
        p.floorH = Math.max(-0.8, Math.min(3, res.floorH));
        p.floorNote = `Floor height ${p.floorH.toFixed(2)} m ${p.floorH >= 0 ? "above" : "below"} the road, measured from your picture.`;
        if (res.floorH !== p.floorH) toast("The measured height was outside -0.8 to 3 m, so it was limited to that range.");
        refreshProperty();
      },
    });
  },
  "img-plan"() {
    openImageTool({
      mode: "plan", site: state.site,
      onDone(res) {
        state.prop.mode = "write";
        applyPolygon(res.poly);
        render();
      },
    });
  },
  speak: () => say(state.step, false),
  "stop-speak": () => stopSpeaking(),
};

function refreshProperty() {
  const p = state.prop;
  if (p.poly && twin) {
    const lim = checkSiteLimits(p.poly, p.type, twin.data.osm);
    if (lim.blocked.length) {
      p.poly = null;
      p.warnings = [];
      p.error = "You can't build here. " + lim.blocked.join(" ");
      twin.clearProperty();
      state.analysis = null;
      state.rec = null;
      state.maxStep = Math.min(state.maxStep, 3);
      return render();
    }
    p.warnings = lim.warnings;
    const info = twin.setProperty(p.poly, { type: p.type, storeys: p.storeys, floorHeight: p.floorH });
    p.note = p.type === "plot"
      ? "A model house is built on your plot so you can see how water would reach it."
      : info.proxy ? "No mapped building was found here, so a model house is built in the middle of the plot." : `Found ${info.count} mapped building${info.count > 1 ? "s" : ""} on the property.`;
    state.analysis = null;
    state.rec = null;
    state.maxStep = Math.min(state.maxStep, 3);
  }
  render();
}

function wire() {
  $("panel").addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el, e);
  });
  $("panel").addEventListener("submit", (e) => {
    if (e.target.id === "search-form") {
      e.preventDefault();
      doSearch($("q").value);
    }
  });
  $("panel").addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "q") state.query = t.value;
    if (t.dataset.bind) {
      const v = t.hasAttribute("data-num") ? parseFloat(t.value) : t.value;
      if (!(t.hasAttribute("data-num") && Number.isNaN(v))) setPath(state, t.dataset.bind, v);
    }
  });
  $("panel").addEventListener("change", (e) => {
    const t = e.target;
    if (t.hasAttribute("data-voice-auto")) {
      state.voice.auto = t.checked;
      if (!t.checked) stopSpeaking();
      return;
    }
    if (t.dataset.layer) {
      state.options[t.dataset.layer] = t.checked;
      twin.setLayer(t.dataset.layer, t.checked);
    } else if (t.id === "relief") {
      state.options.relief = +t.value;
      twin.setRelief(+t.value);
      render();
    } else if (t.id === "storeys" || t.id === "floorH") {
      if (t.id === "floorH") {
        state.prop.floorH = Math.max(-0.8, Math.min(3, state.prop.floorH || 0));
        state.prop.floorNote = "";
      }
      refreshProperty();
    }
  });
  $("steps").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-step]");
    if (!li || !state.twinReady) return;
    const n = +li.dataset.step;
    if (n >= 2 && n <= state.maxStep && n !== 7) goStep(n);
  });
  $("toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cam]");
    if (!b || !twin) return;
    if (b.dataset.cam === "overview") twin.overview();
    if (b.dataset.cam === "property") state.prop.poly ? twin.focusProperty() : toast("Mark your property first.");
    if (b.dataset.cam === "street") twin.streetLevel();
  });
  $("restart").addEventListener("click", () => location.reload());
}

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------
siteMap = new SiteMap($("map"), (lat, lon) => pickPoint(lat, lon));
wire();
render();
api.health().catch(() => {
  const b = $("banner");
  b.hidden = false;
  b.innerHTML = `The HydroTwin backend is not running at <strong>${esc(API_BASE)}</strong>. Start it first (see the README), then reload this page.`;
});
