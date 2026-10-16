import { HORIZONS, ASSUMPTIONS } from "./config.js";
import { fmtCoord } from "./geo.js";
import { houseSceneSVG } from "./illustration.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const FEATURE_LABELS = {
  elevation_m: ["Ground elevation", "m"],
  hand_m: ["Height above nearest drainage (HAND)", "m"],
  distance_to_river_m: ["Distance to nearest river", "m"],
  distance_to_canal_m: ["Distance to nearest canal", "m"],
  distance_to_road_m: ["Distance to nearest road", "m"],
  historical_rainfall_mean: ["Mean rainfall (2022 monsoon window)", "mm"],
  maximum_rainfall_mm: ["Maximum daily rainfall", "mm"],
  maximum_3day_rainfall_mm: ["Maximum 3-day rainfall", "mm"],
  maximum_7day_rainfall_mm: ["Maximum 7-day rainfall", "mm"],
};

export function buildReportHTML(s, images) {
  const { site, prop, analysis, rec, after } = s;
  const sc = analysis.scenarios;
  const isHouse = prop.type === "house";
  const newFloor = s.newFloor;

  const horizonRows = HORIZONS.map((h) => {
    const r = sc[h.key];
    const a = after[h.key];
    return `<tr>
      <td>${h.label}<br><span class="cap">to ${fmtDate(r.until)}</span></td>
      <td>${r.percent}%</td>
      <td><span class="tag ${r.riskClass}">${r.riskClass}</span></td>
      <td>${r.depth.toFixed(2)} m</td>
      <td><span class="tag ${r.before.key}">${esc(r.before.text)}</span></td>
      <td><span class="tag ${a.key}">${esc(a.text)}</span></td>
    </tr>`;
  }).join("");

  const featureRows = Object.entries(analysis.assessment.features)
    .map(([k, v]) => {
      const [label, unit] = FEATURE_LABELS[k] || [k, ""];
      const val = v === null || v === undefined ? "not available" : `${Number(v).toFixed(2)} ${unit}`;
      return `<tr><td>${label}</td><td>${val}</td></tr>`;
    })
    .join("");

  const actions = rec.actions.map((a) => `<li><strong>${esc(a.title)}.</strong> ${esc(a.body)}</li>`).join("");

  const forecastNote = analysis.forecast
    ? `The one-week scenario uses the live 7-day rainfall forecast (${analysis.forecast.sum7.toFixed(0)} mm in total).`
    : "A live rainfall forecast could not be loaded, so the one-week scenario uses the preset rainfall share.";

  const mult = analysis.multipliers;

  return `
  <div class="bar">
    <button class="btn" id="rp-print" type="button">Print or save as PDF</button>
    <button class="btn ghost" id="rp-download" type="button">Download as HTML file</button>
    <button class="btn ghost" id="rp-close" type="button">Back to the twin</button>
  </div>
  <article class="sheet" id="rp-sheet">
    <h1>HydroTwin AI: flood risk report</h1>
    <p>Prepared on ${fmtDate(new Date())}</p>

    <h2>1. Selected property</h2>
    <table>
      <tr><th>Site</th><td>${esc(site.label || "Punjab, Pakistan")}</td></tr>
      <tr><th>Site coordinates</th><td>${fmtCoord(site.lat)}, ${fmtCoord(site.lon)}</td></tr>
      <tr><th>Property type</th><td>${isHouse ? "Existing house" : "Empty plot (planned house)"}</td></tr>
      <tr><th>Property centre</th><td>${fmtCoord(prop.centroid.lat)}, ${fmtCoord(prop.centroid.lon)}</td></tr>
      <tr><th>Area</th><td>${Math.round(prop.area).toLocaleString()} m²</td></tr>
      <tr><th>Site checks</th><td>Not on a mapped road, waterway${isHouse ? "" : " or existing building"}.${(prop.warnings || []).map((w) => " Note: " + esc(w)).join("")}</td></tr>
      <tr><th>${isHouse ? "Current floor height above ground" : "Planned floor height above ground"}</th><td>${prop.floorH.toFixed(2)} m</td></tr>
      <tr><th>Storeys</th><td>${prop.storeys}</td></tr>
    </table>

    <h2>2. Result</h2>
    <p><strong>${esc(rec.headline)}</strong></p>
    <table>
      <tr><th>Time frame</th><th>Flood probability</th><th>Risk</th><th>Drawn water depth</th><th>${isHouse ? "Your house now" : "Planned house now"}</th><th>After the changes</th></tr>
      ${horizonRows}
    </table>
    <p class="cap">Time frames are rainfall scenarios, not weather forecasts. ${forecastNote}
    Month and year scenarios use ${Math.round(mult.month * 100)}% and ${Math.round(mult.year * 100)}% of the rainfall measured in the 2022 monsoon.</p>

    <h2>3. Before and after</h2>
    <div class="two">
      <div><img alt="Current situation" src="${images.before}" /><div class="cap">Current situation, ${HORIZONS[2].label.toLowerCase()} scenario</div></div>
      <div><img alt="Improved design" src="${images.after}" /><div class="cap">With the recommended changes, ${HORIZONS[2].label.toLowerCase()} scenario</div></div>
    </div>

    <h3>Condition of the ${isHouse ? "house" : "planned house"}, side view</h3>
    ${HORIZONS.map((h) => `<div class="two">
      <div>${houseSceneSVG({ depth: sc[h.key].depth, floor: prop.floorH, storeys: prop.storeys, caption: h.label })}<div class="cap">Now: ${esc(sc[h.key].before.text)}</div></div>
      <div>${houseSceneSVG({ depth: sc[h.key].depth, floor: newFloor, storeys: prop.storeys, caption: h.label, raised: newFloor > prop.floorH + 0.01 })}<div class="cap">With the changes: ${esc(after[h.key].text)}</div></div>
    </div>`).join("")}
    <p class="cap">Pictures are drawn from the numbers above and are not to scale.</p>

    <h2>4. Recommendations</h2>
    <p>${isHouse
      ? `Recommended finished-floor height: <strong>${rec.requiredFloor.toFixed(1)} m</strong> above ground (now ${prop.floorH.toFixed(1)} m).`
      : `Minimum finished-floor height if you build: <strong>${rec.requiredFloor.toFixed(1)} m</strong> above ground.`}
    Floor level used in the updated design: ${newFloor.toFixed(1)} m.</p>
    <ol>${actions}</ol>

    <h2>5. Environmental inputs used by the model</h2>
    <table><tr><th>Feature</th><th>Value at the property</th></tr>${featureRows}</table>

    <h2>6. How this was calculated</h2>
    <ul>
      <li>A Random Forest model, trained on 10,263 Punjab sample points, estimates the flood probability from nine features: terrain, height above drainage, distance to rivers, canals and roads, and rainfall.</li>
      <li>Training labels come from the UNOSAT satellite flood extent for 1 July to 31 August 2022.</li>
      <li>Probability bands: Low below ${Math.round(ASSUMPTIONS.LOW_BELOW * 100)}%, Moderate to ${Math.round(ASSUMPTIONS.HIGH_FROM * 100)}%, High above.</li>
      <li>Drawn water depth is a simple estimate: 0 m at 30% probability, rising to ${ASSUMPTIONS.MAX_DEPTH_M} m at 100%. It is not a hydraulic simulation.</li>
      <li>Floor height = highest drawn water depth + ${ASSUMPTIONS.FREEBOARD_M} m freeboard. The model itself reacts only weakly to floor height, so this height comes from the freeboard rule, not from the model.</li>
    </ul>

    <h2>7. Limits of this report</h2>
    <ul>
      <li>The model learned from one flood event (2022). A score of "Low" does not mean the place can never flood.</li>
      <li>Rainfall inputs come from the nearest processed sample point, not from a gauge at the property.</li>
      <li>Terrain comes from a 30 m elevation model. Small local differences, such as a raised yard or a blocked drain, are not captured.</li>
      <li>Buildings, roads and waterways come from OpenStreetMap and may be incomplete or out of date.</li>
      <li>The probability has not been calibrated as a real-world chance of flooding.</li>
      <li>Have a licensed civil engineer check the design before you build or renovate.</li>
    </ul>
  </article>`;
}
