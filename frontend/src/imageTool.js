import { toLocal, isInsidePunjabOutline, polygonArea, polygonCentroid } from "./geo.js";

// ============================================================
// Measure from a picture.
//   mode "levels": a photo or sketch from the side that shows the road
//                  and your house floor  ->  floor height above the road
//   mode "plan"  : a top-down plan or map picture  ->  plot outline
// The picture itself is never uploaded; it stays in your browser.
// You click points on it and give one real length so the tool
// knows the scale. If anything is missing, the tool asks for it.
// ============================================================

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- pure maths (also used by the tests) ----------
export function levelsFromPoints({ road, floor, refTop, refBottom, refMetres }) {
  const refPx = Math.abs(refBottom[1] - refTop[1]);
  if (!(refMetres > 0) || refPx < 3) return null;
  const ppm = refPx / refMetres; // pixels per metre, measured up/down
  const metres = (road[1] - floor[1]) / ppm; // + means floor above road
  return { ppm, floorAboveRoad: metres };
}

// bearing = compass direction the TOP of the picture points to (0 = north)
export function planToLocal({ corners, calibA, calibB, calibMetres, bearingDeg, centre = [0, 0] }) {
  const px = dist(calibA, calibB);
  if (!(calibMetres > 0) || px < 3) return null;
  const ppm = px / calibMetres;
  const th = (bearingDeg * Math.PI) / 180;
  const cx = corners.reduce((s, p) => s + p[0], 0) / corners.length;
  const cy = corners.reduce((s, p) => s + p[1], 0) / corners.length;
  const poly = corners.map(([x, y]) => {
    const u = (x - cx) / ppm; // metres to the right
    const v = (y - cy) / ppm; // metres down
    const east = u * Math.cos(th) - v * Math.sin(th);
    const north = -u * Math.sin(th) - v * Math.cos(th);
    return [centre[0] + east, centre[1] - north]; // local: x east, z south
  });
  const sides = poly.map((p, i) => dist(p, poly[(i + 1) % poly.length]));
  return { poly, area: polygonArea(poly), sides, ppm };
}

// ---------- the pop-up ----------
export function openImageTool({ mode, site, onDone }) {
  const root = document.createElement("div");
  root.className = "modal";
  root.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${mode === "levels" ? "Measure house level from a picture" : "Measure plot from a picture"}">
      <div class="modal-head">
        <h2>${mode === "levels" ? "House level from a photo" : "Plot from a plan picture"}</h2>
        <button type="button" class="btn ghost small" data-it="close">Close</button>
      </div>
      <div class="modal-body">
        <div class="it-left">
          <div class="it-drop" id="it-drop">
            <label class="btn small" for="it-file">Choose a picture</label>
            <input id="it-file" type="file" accept="image/*" />
            <small>JPG or PNG. It stays on your computer.</small>
          </div>
          <canvas id="it-canvas" hidden></canvas>
        </div>
        <div class="it-right" id="it-side"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#it-canvas");
  const ctx = canvas.getContext("2d");
  let img = null;
  let scale = 1;

  // state
  const S = {
    cornerCount: 0,
    pts: [],               // clicked points in IMAGE pixels
    cornersDone: false,    // plan: finished outlining
    refMetres: 2.1, refPreset: "2.1",
    calibMetres: "",
    up: "0", upCustom: "",
    where: "site", lat: "", lon: "",
    error: "",
  };

  // what each click means
  const LEVEL_STEPS = [
    ["road", "Click the road surface at your gate."],
    ["floor", "Click the floor level of your house (the door threshold)."],
    ["refTop", "Click the TOP of something with a known height, for example the door."],
    ["refBottom", "Click the BOTTOM of the same thing, straight below the top."],
  ];

  function nextPrompt() {
    if (!img) return "Choose a picture first.";
    if (mode === "levels") {
      return S.pts.length < 4 ? LEVEL_STEPS[S.pts.length][1] : "All four points are set. Check the numbers on the right.";
    }
    if (!S.cornersDone) return S.pts.length < 3 ? "Click the corners of your plot, one after another." : "Click more corners, or press Corners done.";
    const n = S.pts.length - S.cornerCount;
    if (n < 2) return n === 0 ? "Click the START of one edge whose real length you know." : "Click the END of that edge.";
    return "Scale is set. Answer the questions on the right.";
  }

  // ---------- drawing ----------
  function draw() {
    if (!img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const P = (p) => [p[0] * scale, p[1] * scale];
    const dot = (p, color, label) => {
      const [x, y] = P(p);
      ctx.fillStyle = color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.stroke();
      if (label) { ctx.font = "bold 13px sans-serif"; ctx.fillStyle = "#000"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.strokeText(label, x + 9, y - 8); ctx.fillText(label, x + 9, y - 8); }
    };
    const hline = (p, color, label) => {
      const [, y] = P(p);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); ctx.setLineDash([]);
      dot(p, color, label);
    };
    if (mode === "levels") {
      const [road, floor, top, bottom] = S.pts;
      if (road) hline(road, "#8a5a00", "Road");
      if (floor) hline(floor, "#d98a00", "Floor");
      if (top) dot(top, "#1aa7c9", "top");
      if (bottom) { dot(bottom, "#1aa7c9", "bottom"); const a = P(top), b = P(bottom); ctx.strokeStyle = "#1aa7c9"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    } else {
      const corners = S.pts.slice(0, S.cornersDone ? S.cornerCount : S.pts.length);
      if (corners.length) {
        ctx.strokeStyle = "#f0a92e"; ctx.lineWidth = 3; ctx.fillStyle = "rgba(240,169,46,.25)";
        ctx.beginPath(); corners.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        if (S.cornersDone) ctx.closePath();
        ctx.stroke(); if (S.cornersDone) ctx.fill();
        corners.forEach((p, i) => dot(p, "#f0a92e", String(i + 1)));
      }
      if (S.cornersDone) {
        const cal = S.pts.slice(S.cornerCount);
        cal.forEach((p, i) => dot(p, "#1aa7c9", i ? "B" : "A"));
        if (cal.length === 2) { const a = P(cal[0]), b = P(cal[1]); ctx.strokeStyle = "#1aa7c9"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      }
    }
  }

  // ---------- results ----------
  function compute() {
    S.error = "";
    const need = [];
    let result = null;

    if (mode === "levels") {
      const labels = ["the road level", "your floor level", "the top of the known-height object", "the bottom of the known-height object"];
      for (let i = S.pts.length; i < 4; i++) need.push(`Click ${labels[i]}.`);
      if (!(S.refMetres > 0)) need.push("Type the real height of that object in metres (a standard door is about 2.1 m).");
      if (!need.length) {
        const [road, floor, refTop, refBottom] = S.pts;
        const r = levelsFromPoints({ road, floor, refTop, refBottom, refMetres: S.refMetres });
        if (!r) need.push("The top and bottom of the known object are too close together. Click them further apart.");
        else {
          const v = Math.round(r.floorAboveRoad * 100) / 100;
          result = { floorH: v, text: v >= 0
            ? `Your floor is about ${v.toFixed(2)} m above the road.`
            : `Your floor is about ${Math.abs(v).toFixed(2)} m BELOW the road. Water on the road would run towards your house.` };
          if (Math.abs(v) > 2.5) result.warn = "That is a very large difference. Check that you clicked the right points.";
        }
      }
    } else {
      if (!S.cornersDone) need.push(S.pts.length < 3 ? "Click at least 3 corners of the plot, then press Corners done." : "Press Corners done when you have clicked every corner.");
      else {
        const cal = S.pts.slice(S.cornerCount);
        if (cal.length < 2) need.push("Click the two ends of an edge whose real length you know.");
        if (!(parseFloat(S.calibMetres) > 0)) need.push("Type the real length of that edge in metres.");
        const bearing = S.up === "custom" ? parseFloat(S.upCustom) : parseFloat(S.up);
        if (S.up === "custom" && Number.isNaN(bearing)) need.push("Type which compass angle the top of the picture points to (0 = north, 90 = east).");
        let centre = [0, 0];
        if (S.where === "coords") {
          const lat = parseFloat(S.lat), lon = parseFloat(S.lon);
          if (Number.isNaN(lat) || Number.isNaN(lon)) need.push("Type both latitude and longitude of the plot centre, or choose the centre of your site.");
          else if (!isInsidePunjabOutline(lat, lon)) need.push("Those coordinates are outside Punjab.");
          else { const l = toLocal(site.lat, site.lon, lat, lon); centre = [l.x, l.z]; }
        }
        if (!need.length) {
          const r = planToLocal({
            corners: S.pts.slice(0, S.cornerCount), calibA: cal[0], calibB: cal[1],
            calibMetres: parseFloat(S.calibMetres), bearingDeg: bearing, centre,
          });
          if (!r) need.push("The two scale points are too close together. Click them further apart.");
          else if (r.area < 20) need.push(`The plot comes out at only ${r.area.toFixed(0)} m². Check the length you typed.`);
          else if (r.area > 100000) need.push(`The plot comes out at ${Math.round(r.area).toLocaleString()} m², more than 10 hectares. Check the length you typed.`);
          else if (r.poly.some((p) => Math.abs(p[0]) > 990 || Math.abs(p[1]) > 990)) need.push("The plot would fall outside the 2 km area of your 3D twin. Use coordinates closer to your site.");
          else result = { poly: r.poly, area: r.area, sides: r.sides };
        }
      }
    }
    return { need, result };
  }

  function renderResult() {
    const { need, result } = compute();
    const box = $("#it-result");
    if (!box) return;
    let html = "";
    if (need.length) {
      html += `<div class="verdict raise"><strong>Still needed</strong><p>${need.map((n) => `${n}`).join("<br>")}</p></div>`;
    }
    if (result && mode === "levels") {
      html += `<div class="verdict ${result.floorH >= 0 ? "safe" : "avoid"}"><strong>${result.text}</strong>${result.warn ? `<p>${result.warn}</p>` : ""}</div>
        <small>Measured up and down on the picture. Photos taken straight-on, at the gate, with the camera held level, give the best result.</small>`;
    }
    if (result && mode === "plan") {
      html += `<div class="verdict safe"><strong>Plot area about ${Math.round(result.area).toLocaleString()} m²</strong>
        <p>${result.sides.length} sides: ${result.sides.map((s) => s.toFixed(1) + " m").join(", ")}.</p></div>`;
    }
    box.innerHTML = html;
    const use = $("[data-it=use]");
    if (use) use.disabled = !result;
    box._result = result;
  }

  function side() {
    const s = $("#it-side");
    const undoable = S.pts.length > 0;
    let form = "";
    if (img && mode === "levels") {
      form = `<div class="field"><label for="it-ref">What known-height thing did you click?</label>
        <select id="it-ref">
          <option value="2.1" ${S.refPreset === "2.1" ? "selected" : ""}>A standard door (2.1 m)</option>
          <option value="1.7" ${S.refPreset === "1.7" ? "selected" : ""}>A standing person (about 1.7 m, less exact)</option>
          <option value="custom" ${S.refPreset === "custom" ? "selected" : ""}>Something else (I will type its height)</option>
        </select></div>
        <div class="field"><label for="it-refm">Its real height (m)</label>
        <input id="it-refm" type="number" min="0.1" step="0.05" value="${S.refMetres}" /></div>`;
    }
    if (img && mode === "plan" && S.cornersDone) {
      form = `<div class="field"><label for="it-len">Real length of the edge you clicked (m)</label>
        <input id="it-len" type="number" min="0.5" step="0.1" value="${S.calibMetres}" placeholder="for example 10.5" /></div>
        <div class="field"><label for="it-up">Which direction is the TOP of the picture?</label>
        <select id="it-up">
          <option value="0" ${S.up === "0" ? "selected" : ""}>North (Google Maps screenshots)</option>
          <option value="90" ${S.up === "90" ? "selected" : ""}>East</option>
          <option value="180" ${S.up === "180" ? "selected" : ""}>South</option>
          <option value="270" ${S.up === "270" ? "selected" : ""}>West</option>
          <option value="custom" ${S.up === "custom" ? "selected" : ""}>Another angle (I will type it)</option>
        </select></div>
        ${S.up === "custom" ? `<div class="field"><label for="it-upc">Angle clockwise from north (degrees)</label><input id="it-upc" type="number" value="${S.upCustom}" /></div>` : ""}
        <div class="field"><label for="it-where">Where is this plot?</label>
        <select id="it-where">
          <option value="site" ${S.where === "site" ? "selected" : ""}>At the centre of my selected site</option>
          <option value="coords" ${S.where === "coords" ? "selected" : ""}>At coordinates I will type</option>
        </select></div>
        ${S.where === "coords" ? `<div class="grid2"><div class="field"><label for="it-lat">Latitude</label><input id="it-lat" value="${S.lat}" inputmode="decimal"/></div><div class="field"><label for="it-lon">Longitude</label><input id="it-lon" value="${S.lon}" inputmode="decimal"/></div></div>` : ""}`;
    }
    s.innerHTML = `
      <p class="lead" id="it-prompt">${nextPrompt()}</p>
      ${img ? `<div class="row">
        <button type="button" class="btn ghost small" data-it="undo" ${undoable ? "" : "disabled"}>Undo last click</button>
        <button type="button" class="btn ghost small" data-it="reset" ${undoable ? "" : "disabled"}>Start again</button>
        ${mode === "plan" && !S.cornersDone ? `<button type="button" class="btn small" data-it="corners" ${S.pts.length >= 3 ? "" : "disabled"}>Corners done</button>` : ""}
      </div>` : ""}
      ${form ? `<div class="stack" style="margin-top:12px">${form}</div>` : ""}
      <div id="it-result" style="margin-top:12px"></div>
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn" data-it="use" disabled>${mode === "levels" ? "Use this floor height" : "Place this plot"}</button>
      </div>
      ${mode === "levels" ? '<small style="margin-top:10px">Tip: a photo from the street, level with the gate, showing the road surface and the door, works best. A drawn cross-section works too if you know one real height on it.</small>' : '<small style="margin-top:10px">Tip: a Google Maps satellite screenshot works well. Click the plot corners, then use any edge you can measure, such as a plot side from your registry papers.</small>'}`;
    renderResult();
  }

  // ---------- events ----------
  function close() { root.remove(); document.removeEventListener("keydown", onKey); }
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = () => {
        img = im;
        const maxW = 640, maxH = 480;
        scale = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight, 1.5);
        canvas.width = Math.round(im.naturalWidth * scale);
        canvas.height = Math.round(im.naturalHeight * scale);
        canvas.hidden = false;
        $("#it-drop").hidden = true;
        S.pts = []; S.cornersDone = false; S.cornerCount = 0;
        draw(); side();
      };
      im.onerror = () => {
        $("#it-prompt").textContent = "This picture could not be opened. Use a JPG or PNG file.";
      };
      im.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "it-file" && t.files[0]) return loadFile(t.files[0]);
    if (t.id === "it-ref") {
      S.refPreset = t.value;
      if (t.value !== "custom") S.refMetres = parseFloat(t.value);
      return side();
    }
    if (t.id === "it-up") { S.up = t.value; return side(); }
    if (t.id === "it-where") { S.where = t.value; return side(); }
  });

  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "it-refm") { S.refMetres = parseFloat(t.value); S.refPreset = "custom"; }
    else if (t.id === "it-len") S.calibMetres = t.value;
    else if (t.id === "it-upc") S.upCustom = t.value;
    else if (t.id === "it-lat") S.lat = t.value;
    else if (t.id === "it-lon") S.lon = t.value;
    else return;
    renderResult();
  });

  canvas.addEventListener("click", (e) => {
    if (!img) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width / scale;
    const y = ((e.clientY - r.top) / r.height) * canvas.height / scale;
    if (mode === "levels") { if (S.pts.length >= 4) return; }
    else if (S.cornersDone && S.pts.length - S.cornerCount >= 2) return;
    S.pts.push([x, y]);
    draw(); side();
  });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-it]");
    if (!b) { if (e.target === root) close(); return; }
    const act = b.dataset.it;
    if (act === "close") close();
    else if (act === "undo") { S.pts.pop(); if (mode === "plan" && S.cornersDone && S.pts.length < S.cornerCount) { S.cornersDone = false; } draw(); side(); }
    else if (act === "reset") { S.pts = []; S.cornersDone = false; S.cornerCount = 0; draw(); side(); }
    else if (act === "corners") { S.cornersDone = true; S.cornerCount = S.pts.length; draw(); side(); }
    else if (act === "use") {
      const res = $("#it-result")._result;
      if (!res) return;
      close();
      onDone(res);
    }
  });

  side();
}
