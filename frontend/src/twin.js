import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SCENE_SIZE_M, ASSUMPTIONS } from "./config.js";
import { toLatLon, polygonCentroid, pointInLocalPolygon, orientedRect } from "./geo.js";
import { makeDummyHouse, makeBoundaryWall, houseSize } from "./house.js";

// ============================================================
// The 3D digital twin.
// World axes:  x = east (m), z = south (m), y = up.
// This is the same convention the backend /osm-3d uses.
// ============================================================

const COLORS = {
  sky: 0xbfd6dc,
  building: 0xd9c9a8,
  buildingPublic: 0xb9c4cc,
  road: 0x3b4146,
  roadMajor: 0x2c3135,
  river: 0x3d8fb0,
  canal: 0x4aa6b8,
  drain: 0x5bb0c0,
  plot: 0xf0a92e,
  plinth: 0xa9a49a,
  house: 0xe9e2d0,
  houseAfter: 0xf3efe2,
  houseAvoid: 0xd2563b,
  drainage: 0x38c6d9,
  water: 0x2f86b8,
};

const PUBLIC_TYPES = ["mosque", "school", "hospital", "church", "temple", "commercial", "industrial", "retail", "public"];
const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7,
  residential: 5, unclassified: 5, service: 3.5, track: 3, path: 1.5,
};
const WATER_WIDTH = { river: 40, canal: 14, watercourse: 8, stream: 5, drain: 3.5, ditch: 2.5 };

// ---------- Web-Mercator tile helpers ----------
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export class Twin {
  constructor(container) {
    this.container = container;
    this.data = null;
    this.relief = 1;
    this.layers = { satellite: true, buildings: true, roads: true, waterways: true };
    this.draft = [];
    this.drawing = false;
    this.onDraftChange = null;
    this.waterTarget = -50;
    this.waterCurrent = -50;
    this.waterVisible = false;
    this.rainOn = false;
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 1800, 5200);

    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 12000);
    this.camera.position.set(0, 1500, 1200);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 3200;
    this.controls.screenSpacePanning = false;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f78, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3dc, 1.35);
    sun.position.set(-600, 900, 500);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -1100; sc.right = 1100; sc.top = 1100; sc.bottom = -1100;
    sc.near = 10; sc.far = 3000;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.sun = sun;

    this.world = new THREE.Group();   // rebuilt on relief change
    this.dynamic = new THREE.Group(); // property, house, drainage
    this.scene.add(this.world, this.dynamic);

    // water plane
    const wg = new THREE.PlaneGeometry(SCENE_SIZE_M, SCENE_SIZE_M);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(
      wg,
      new THREE.MeshPhongMaterial({
        color: COLORS.water, transparent: true, opacity: 0.72,
        shininess: 90, specular: 0x99ccee, depthWrite: false,
      })
    );
    this.water.visible = false;
    this.water.renderOrder = 5;
    this.scene.add(this.water);

    this.raycaster = new THREE.Raycaster();
    this.pointerDown = null;
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => (this.pointerDown = [e.clientX, e.clientY]));
    el.addEventListener("pointerup", (e) => this.handleClick(e));

    this.tween = null;
    this.resize = this.resize.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();

    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------
  // VR
  // ---------------------------------------------------------
  // The VR button only works with a VR headset. If VR is not possible the
  // button still shows, and clicking it explains exactly why.
  enableVR(slot, onInfo = () => {}) {
    this.renderer.xr.enabled = true;
    const why = async () => {
      if (!window.isSecureContext) {
        return "VR needs a secure page (https:// or localhost). This page was opened from an address that is not secure.";
      }
      if (!navigator.xr) {
        return "This browser has no WebXR support, which VR needs. Use Chrome or Edge on a computer, or the Meta Quest browser.";
      }
      let ok = false;
      try { ok = await navigator.xr.isSessionSupported("immersive-vr"); } catch { ok = false; }
      return ok ? "" : "No VR headset was found. VR needs a headset, for example a Meta Quest connected to this computer (Quest Link or Air Link) or opening this page in the Quest browser. A normal computer screen cannot enter VR.";
    };
    why().then((reason) => {
      if (!reason) {
        const btn = VRButton.createButton(this.renderer);
        btn.classList.add("vr-btn");
        slot.appendChild(btn);
      } else {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "vr-btn vr-off";
        b.textContent = "VR: why not available?";
        b.addEventListener("click", () => onInfo(reason));
        slot.appendChild(b);
      }
    });
  }

  resize() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------
  // Load data from the backend
  // ---------------------------------------------------------
  load({ terrain, osm, lat, lon }) {
    this.data = { terrain, osm, lat, lon };
    this.N = terrain.grid_size;
    this.elev = terrain.elevations; // [row][col], row 0 = north
    this.minE = terrain.min_elevation_m;
    this.maxE = terrain.max_elevation_m;
    this.size = terrain.size_m || SCENE_SIZE_M;
    this.lat0 = lat;
    this.lon0 = lon;
    this.rebuildWorld();
    this.loadSatellite().catch(() => {});
  }

  // real elevation (m) at local x,z — bilinear
  elevAt(x, z) {
    const N = this.N, s = this.size;
    const fx = Math.min(N - 1.001, Math.max(0, (x / s + 0.5) * (N - 1)));
    const fz = Math.min(N - 1.001, Math.max(0, (z / s + 0.5) * (N - 1)));
    const j = Math.floor(fx), i = Math.floor(fz);
    const tx = fx - j, tz = fz - i;
    const e = this.elev;
    const a = e[i][j] * (1 - tx) + e[i][j + 1] * tx;
    const b = e[i + 1][j] * (1 - tx) + e[i + 1][j + 1] * tx;
    return a * (1 - tz) + b * tz;
  }

  // world height (y) at x,z, with relief applied
  heightAt(x, z) {
    return (this.elevAt(x, z) - this.minE) * this.relief;
  }

  yFromElevation(elevM) {
    return (elevM - this.minE) * this.relief;
  }

  dispose(group) {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.userData?.keep) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    group.clear();
  }

  setRelief(v) {
    this.relief = v;
    if (!this.data) return;
    this.rebuildWorld();
    if (this.property) this.setProperty(this.property.poly, this.property.opts);
    if (this.scenario) this.setScenario(this.scenario);
  }

  setLayer(name, on) {
    this.layers[name] = on;
    if (name === "satellite") this.applyTerrainMaterial();
    if (name === "buildings" && this.buildingsMesh) this.buildingsMesh.visible = on;
    if (name === "roads" && this.roadsMesh) this.roadsMesh.visible = on;
    if (name === "waterways" && this.waterwaysMesh) this.waterwaysMesh.visible = on;
  }

  // ---------------------------------------------------------
  // Terrain + OSM meshes
  // ---------------------------------------------------------
  rebuildWorld() {
    this.dispose(this.world);
    this.buildTerrain();
    this.buildOverlays(new Set());
  }

  buildTerrain() {
    const N = this.N, s = this.size;
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const uv = new Float32Array(N * N * 2);
    const span = Math.max(0.5, this.maxE - this.minE);
    const c1 = new THREE.Color(0x8a9a62), c2 = new THREE.Color(0xc9b583), c = new THREE.Color();

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const k = i * N + j;
        const x = (j / (N - 1) - 0.5) * s;
        const z = (i / (N - 1) - 0.5) * s;
        const e = this.elev[i][j];
        pos[k * 3] = x;
        pos[k * 3 + 1] = (e - this.minE) * this.relief;
        pos[k * 3 + 2] = z;
        c.copy(c1).lerp(c2, (e - this.minE) / span);
        col.set([c.r, c.g, c.b], k * 3);
        if (this.satInfo) {
          const { lat, lon } = toLatLon(this.lat0, this.lon0, x, z);
          const fx = lon2x(lon, this.satInfo.z), fy = lat2y(lat, this.satInfo.z);
          uv[k * 2] = (fx - this.satInfo.x0) / this.satInfo.nx;
          uv[k * 2 + 1] = 1 - (fy - this.satInfo.y0) / this.satInfo.ny;
        }
      }
    }
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < N - 1; j++) {
        const a = i * N + j, b = a + 1, c2i = a + N, d = c2i + 1;
        idx.push(a, c2i, b, b, c2i, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();

    this.terrainGeo = g;
    this.terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.world.add(this.terrain);
    this.applyTerrainMaterial();
  }

  applyTerrainMaterial() {
    if (!this.terrain) return;
    const useSat = this.layers.satellite && this.satTexture;
    this.terrain.material.dispose();
    this.terrain.material = useSat
      ? new THREE.MeshLambertMaterial({ map: this.satTexture })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  // Drape Esri World Imagery over the terrain. If the tiles cannot be
  // loaded the app keeps working with the elevation colours.
  async loadSatellite() {
    this.satTexture = null;
    this.satStatus = "loading";
    const s = this.size;
    const corners = [
      toLatLon(this.lat0, this.lon0, -s / 2, -s / 2),
      toLatLon(this.lat0, this.lon0, s / 2, s / 2),
    ];
    let z = 17;
    let x0, x1, y0, y1;
    const calc = () => {
      x0 = Math.floor(lon2x(corners[0].lon, z));
      x1 = Math.floor(lon2x(corners[1].lon, z));
      y0 = Math.floor(lat2y(corners[0].lat, z));
      y1 = Math.floor(lat2y(corners[1].lat, z));
    };
    calc();
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 100) { z = 16; calc(); }
    const nx = x1 - x0 + 1, ny = y1 - y0 + 1;

    const canvas = document.createElement("canvas");
    canvas.width = nx * 256;
    canvas.height = ny * 256;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#8a9a62";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let ok = 0;
    const jobs = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
        jobs.push(
          loadImage(url).then((img) => {
            ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256);
            ok++;
          }).catch(() => {})
        );
      }
    }
    await Promise.all(jobs);
    if (ok < jobs.length * 0.5) {
      this.satStatus = "unavailable";
      return;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.satTexture = tex;
    this.satInfo = { z, x0, y0, nx, ny };
    this.satStatus = "ready";
    this.rebuildWorld();
    if (this.property) this.setProperty(this.property.poly, this.property.opts);
    if (this.scenario) this.setScenario(this.scenario);
  }

  // ----- ribbons draped on terrain -----
  ribbonGeometry(points, width, lift, color) {
    // densify so the ribbon follows the ground
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / 15));
      for (let k = 0; k < steps; k++) {
        pts.push([ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps]);
      }
    }
    pts.push(points[points.length - 1]);
    if (pts.length < 2) return null;

    const pos = [], idx = [];
    const hw = width / 2;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
      let dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      const [x, z] = pts[i];
      const y = this.heightAt(x, z) + lift;
      pos.push(x + nx * hw, y, z + nz * hw, x - nx * hw, y, z - nz * hw);
      if (i < pts.length - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const c = new THREE.Color(color);
    const colors = new Float32Array((pos.length / 3) * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  mergeRibbons(items, lift) {
    const geos = items.map((it) => this.ribbonGeometry(it.points, it.width, lift, it.color)).filter(Boolean);
    if (!geos.length) return null;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    return merged || null;
  }

  buildingGeometry(footprint, baseY, bottom, top, color) {
    try {
      const shape = new THREE.Shape(footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.2, top - bottom), bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, baseY + bottom, 0);
      const c = new THREE.Color(color);
      const n = g.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return g.index ? g.toNonIndexed() : g;
    } catch {
      return null;
    }
  }

  footprintCentroid(fp) {
    let x = 0, z = 0;
    fp.forEach((p) => { x += p[0]; z += p[1]; });
    return [x / fp.length, z / fp.length];
  }

  buildOverlays(excludeIds) {
    const osm = this.data.osm || {};

    // roads
    const roads = (osm.roads || []).map((r) => ({
      points: r.points,
      width: ROAD_WIDTH[r.highway] || 5,
      color: ["motorway", "trunk", "primary"].includes(r.highway) ? COLORS.roadMajor : COLORS.road,
    }));
    const rg = this.mergeRibbons(roads, 0.25);
    if (rg) {
      const m = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.receiveShadow = true;
      m.visible = this.layers.roads;
      this.roadsMesh = m;
      this.world.add(m);
    } else this.roadsMesh = null;

    // waterways
    const waters = (osm.waterways || []).map((w) => ({
      points: w.points,
      width: WATER_WIDTH[w.waterway] || 5,
      color: COLORS[w.waterway] || COLORS.river,
    }));
    const wg = this.mergeRibbons(waters, 0.35);
    if (wg) {
      const m = new THREE.Mesh(wg, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.visible = this.layers.waterways;
      this.waterwaysMesh = m;
      this.world.add(m);
    } else this.waterwaysMesh = null;

    // buildings
    this.buildingIndex = (osm.buildings || []).map((b) => {
      const [cx, cz] = this.footprintCentroid(b.footprint);
      return { id: b.id, type: b.type, cx, cz, footprint: b.footprint, height: b.height_m };
    });
    this.buildBuildingsOnly(excludeIds);
  }

  // ---------------------------------------------------------
  // Camera
  // ---------------------------------------------------------
  flyTo(position, target, ms = 1600) {
    this.tween = {
      t0: performance.now(), ms,
      p0: this.camera.position.clone(), p1: new THREE.Vector3(...position),
      c0: this.controls.target.clone(), c1: new THREE.Vector3(...target),
    };
  }

  overview() {
    this.flyTo([0, 780, 980], [0, 0, 0]);
  }

  intro() {
    this.camera.position.set(0, 2600, 1600);
    this.controls.target.set(0, 0, 0);
    this.flyTo([0, 780, 980], [0, 0, 0], 3200);
  }

  streetLevel() {
    const p = this.property ? this.property.center : [0, 0];
    const y = this.heightAt(p[0], p[1]);
    this.flyTo([p[0] + 28, y + 3.2, p[1] + 38], [p[0], y + 2, p[1]], 1800);
  }

  focusProperty(distance = 110, height = 70) {
    const p = this.property ? this.property.center : [0, 0];
    const y = this.heightAt(p[0], p[1]);
    this.flyTo([p[0] + distance * 0.55, y + height, p[1] + distance], [p[0], y + 2, p[1]], 1400);
  }

  frame() {
    const dt = this.clock.getDelta();
    if (this.tween) {
      const k = Math.min(1, (performance.now() - this.tween.t0) / this.tween.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e);
      this.controls.target.lerpVectors(this.tween.c0, this.tween.c1, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();

    // water rises smoothly
    if (this.waterVisible) {
      this.waterCurrent += (this.waterTarget - this.waterCurrent) * Math.min(1, dt * 2.2);
      this.water.position.y = this.waterCurrent + Math.sin(performance.now() / 900) * 0.04;
    }
    this.water.visible = this.waterVisible;

    // keep drawing markers readable at any zoom
    const camPos = this.camera.position;
    this.dynamic.traverse((o) => {
      if (o.userData.marker) {
        const d = camPos.distanceTo(o.position);
        const s = Math.max(0.6, d * 0.012);
        o.scale.setScalar(s);
      }
    });

    if (this.rain && this.rainOn) this.stepRain(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------
  // Drawing the property on the terrain
  // ---------------------------------------------------------
  handleClick(e) {
    if (!this.pointerDown) return;
    const moved = Math.hypot(e.clientX - this.pointerDown[0], e.clientY - this.pointerDown[1]);
    this.pointerDown = null;
    if (!this.drawing || moved > 5 || !this.terrain) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (!hit) return;
    this.draft.push([hit.point.x, hit.point.z]);
    this.drawDraft();
    this.onDraftChange?.(this.draft.slice());
  }

  startDraw(cb) {
    this.drawing = true;
    this.onDraftChange = cb;
    this.renderer.domElement.style.cursor = "crosshair";
  }

  stopDraw() {
    this.drawing = false;
    this.renderer.domElement.style.cursor = "";
  }

  undoPoint() {
    this.draft.pop();
    this.drawDraft();
    this.onDraftChange?.(this.draft.slice());
  }

  clearDraft() {
    this.draft = [];
    this.drawDraft();
    this.onDraftChange?.([]);
  }

  setDraft(points) {
    this.draft = points.slice();
    this.drawDraft();
  }

  drawDraft() {
    if (this.draftGroup) {
      this.dynamic.remove(this.draftGroup);
      this.dispose(this.draftGroup);
    }
    const g = new THREE.Group();
    this.draftGroup = g;
    const pts = this.draft;
    pts.forEach(([x, z]) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 14, 10),
        new THREE.MeshBasicMaterial({ color: COLORS.plot, depthTest: false })
      );
      m.position.set(x, this.heightAt(x, z) + 1, z);
      m.renderOrder = 20;
      m.userData.marker = true;
      g.add(m);
    });
    if (pts.length >= 2) {
      const lp = pts.map(([x, z]) => new THREE.Vector3(x, this.heightAt(x, z) + 0.6, z));
      if (pts.length >= 3) lp.push(lp[0].clone());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(lp),
        new THREE.LineBasicMaterial({ color: COLORS.plot, depthTest: false })
      );
      line.renderOrder = 19;
      g.add(line);
    }
    this.dynamic.add(g);
  }

  // ---------------------------------------------------------
  // The property: outline, fill, user house, drainage
  // poly: [[x,z],...]   opts: { type, storeys, floorHeight }
  // ---------------------------------------------------------
  findBuildings(poly) {
    const [pcx, pcz] = polygonCentroid(poly);
    const found = this.buildingIndex.filter(
      (b) =>
        pointInLocalPolygon(b.cx, b.cz, poly) ||
        pointInLocalPolygon(pcx, pcz, b.footprint)
    );
    return found;
  }

  setProperty(poly, opts) {
    this.property = { poly, opts, center: polygonCentroid(poly) };
    this.draft = [];
    this.drawDraft();
    if (this.propGroup) {
      this.dynamic.remove(this.propGroup);
      this.dispose(this.propGroup);
    }
    const g = new THREE.Group();
    this.propGroup = g;

    // outline + translucent fill
    const lp = poly.map(([x, z]) => new THREE.Vector3(x, this.heightAt(x, z) + 0.5, z));
    lp.push(lp[0].clone());
    g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(lp),
      new THREE.LineBasicMaterial({ color: COLORS.plot })
    ));
    const tri = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    if (tri.length) {
      const fp = new Float32Array(poly.length * 3);
      poly.forEach(([x, z], i) => { fp[i * 3] = x; fp[i * 3 + 1] = this.heightAt(x, z) + 0.45; fp[i * 3 + 2] = z; });
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
      fg.setIndex(tri.flat());
      fg.computeVertexNormals();
      const fm = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
        color: COLORS.plot, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
      }));
      fm.renderOrder = 6;
      g.add(fm);
    }
    this.dynamic.add(g);

    // existing OSM buildings that sit on the property
    this.userBuildings = opts.type === "house" ? this.findBuildings(poly) : [];
    this.usedProxy = false;
    this.property.rect = orientedRect(poly);
    if (!this.userBuildings.length) {
      // nothing mapped here (or an empty plot): the model house is built in the middle of the plot
      const [cx, cz] = this.property.center;
      const fp = poly.map(([x, z]) => [cx + (x - cx) * 0.6, cz + (z - cz) * 0.6]);
      this.userBuildings = [{ id: "proxy", cx, cz, footprint: fp, height: opts.storeys * ASSUMPTIONS.STOREY_HEIGHT_M }];
      this.usedProxy = true;
      // low boundary wall around the plot, like a real Punjab house
      g.add(makeBoundaryWall(poly, (x, z) => this.heightAt(x, z)));
    }
    // rebuild OSM buildings without the user's own house
    if (this.buildingsMesh) {
      this.world.remove(this.buildingsMesh);
      this.buildingsMesh.geometry.dispose();
      this.buildingsMesh.material.dispose();
      this.buildingsMesh = null;
    }
    this.buildBuildingsOnly(new Set(this.userBuildings.map((b) => b.id)));
    this.previewProperty();
    return { count: this.userBuildings.length, proxy: this.usedProxy };
  }

  // show the house on the plot before any flood analysis
  previewProperty() {
    if (!this.property) return;
    const o = this.property.opts;
    this.setScenario({
      mode: "before", depth: 0, floorHeight: o.floorHeight, storeys: o.storeys,
      type: o.type, showWater: false,
    });
  }

  clearProperty() {
    this.clearScenario();
    if (this.propGroup) {
      this.dynamic.remove(this.propGroup);
      this.dispose(this.propGroup);
      this.propGroup = null;
    }
    this.property = null;
    this.userBuildings = [];
    if (this.buildingsMesh) {
      this.world.remove(this.buildingsMesh);
      this.buildingsMesh.geometry.dispose();
      this.buildingsMesh.material.dispose();
      this.buildingsMesh = null;
    }
    this.buildBuildingsOnly(new Set());
  }

  buildBuildingsOnly(exclude) {
    const geos = [];
    for (const b of this.buildingIndex) {
      if (exclude.has(b.id)) continue;
      const base = this.heightAt(b.cx, b.cz);
      const pub = PUBLIC_TYPES.includes(b.type);
      const g = this.buildingGeometry(b.footprint, base, -1, b.height, pub ? COLORS.buildingPublic : COLORS.building);
      if (g) geos.push(g);
    }
    this.buildingsMesh = null;
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    if (!merged) return;
    merged.computeVertexNormals();
    const m = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = true;
    m.receiveShadow = true;
    m.visible = this.layers.buildings;
    this.buildingsMesh = m;
    this.world.add(m);
  }

  // ---------------------------------------------------------
  // Scenario: flood water + the property's house
  // s = { mode: 'before'|'after', depth, floorHeight, storeys,
  //       type: 'house'|'plot', verdict, showWater }
  // ---------------------------------------------------------
  setScenario(s) {
    this.scenario = s;
    if (!this.property) return;
    if (this.houseGroup) {
      this.dynamic.remove(this.houseGroup);
      this.dispose(this.houseGroup);
    }
    if (this.mitGroup) {
      this.dynamic.remove(this.mitGroup);
      this.dispose(this.mitGroup);
      this.mitGroup = null;
    }
    const g = new THREE.Group();
    this.houseGroup = g;
    const [cx, cz] = this.property.center;
    const groundE = this.elevAt(cx, cz);
    const base = this.yFromElevation(groundE);

    // water surface = ground elevation at the property + depth
    this.waterVisible = s.showWater !== false && s.depth > 0;
    this.waterTarget = this.yFromElevation(groundE + s.depth);
    if (this.waterCurrent < -40) this.waterCurrent = this.waterTarget - 1;
    this.setRain(this.waterVisible);

    const floor = s.floorHeight;
    const tone = s.mode === "after" ? (s.verdict === "avoid" ? "avoid" : "after") : "normal";
    for (const b of this.userBuildings) {
      if (b.id === "proxy") {
        // our own model house, sized and turned to fit the plot
        const r = this.property.rect;
        const size = houseSize(r.w, r.d);
        const house = makeDummyHouse({
          w: size.w, d: size.d, storeys: s.storeys, floor, storeyH: ASSUMPTIONS.STOREY_HEIGHT_M, tone,
        });
        house.position.set(r.cx, this.heightAt(r.cx, r.cz), r.cz);
        house.rotation.y = -r.angle;
        g.add(house);
        continue;
      }
      // a real mapped building: keep its true footprint
      const color = s.mode === "after" ? (s.verdict === "avoid" ? COLORS.houseAvoid : COLORS.houseAfter) : COLORS.house;
      const bb = this.heightAt(b.cx, b.cz);
      const bodyH = s.storeys * ASSUMPTIONS.STOREY_HEIGHT_M;
      const plinth = this.buildingGeometry(b.footprint, bb, -1, floor, COLORS.plinth);
      const body = this.buildingGeometry(b.footprint, bb, floor, floor + bodyH, color);
      [plinth, body].forEach((geo) => {
        if (!geo) return;
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      });
    }
    this.dynamic.add(g);

    // drainage works (after only)
    if (s.mode === "after") {
      const mg = new THREE.Group();
      this.mitGroup = mg;
      const poly = this.property.poly;
      const loop = poly.concat([poly[0]]);
      const geo = this.ribbonGeometry(loop, 1.6, 0.7, COLORS.drainage);
      if (geo) mg.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true })));
      if (s.outlet && s.outlet.distance < 1500) {
        let nearest = poly[0], bd = Infinity;
        poly.forEach((p) => {
          const d = Math.hypot(p[0] - s.outlet.x, p[1] - s.outlet.z);
          if (d < bd) { bd = d; nearest = p; }
        });
        const og = this.ribbonGeometry([nearest, [s.outlet.x, s.outlet.z]], 1.6, 0.7, COLORS.drainage);
        if (og) mg.add(new THREE.Mesh(og, new THREE.MeshBasicMaterial({ vertexColors: true })));
      }
      this.dynamic.add(mg);
    }
  }

  clearScenario() {
    this.scenario = null;
    this.waterVisible = false;
    this.setRain(false);
    if (this.houseGroup) { this.dynamic.remove(this.houseGroup); this.dispose(this.houseGroup); this.houseGroup = null; }
    if (this.mitGroup) { this.dynamic.remove(this.mitGroup); this.dispose(this.mitGroup); this.mitGroup = null; }
  }

  // ---------------------------------------------------------
  // Rain
  // ---------------------------------------------------------
  setRain(on) {
    this.rainOn = on;
    if (on && !this.rain) {
      const n = 1800;
      const pos = new Float32Array(n * 6);
      this.rainSeed = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        this.rainSeed[i * 3] = (Math.random() - 0.5) * 500;
        this.rainSeed[i * 3 + 1] = Math.random() * 220;
        this.rainSeed[i * 3 + 2] = (Math.random() - 0.5) * 500;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.45 }));
      this.rain.frustumCulled = false;
      this.scene.add(this.rain);
    }
    if (this.rain) this.rain.visible = on;
  }

  stepRain(dt) {
    const c = this.property ? this.property.center : [0, 0];
    const pos = this.rain.geometry.attributes.position.array;
    const n = this.rainSeed.length / 3;
    for (let i = 0; i < n; i++) {
      this.rainSeed[i * 3 + 1] -= 140 * dt;
      if (this.rainSeed[i * 3 + 1] < 0) this.rainSeed[i * 3 + 1] += 220;
      const x = c[0] + this.rainSeed[i * 3], z = c[1] + this.rainSeed[i * 3 + 2];
      const y = this.heightAt(Math.max(-990, Math.min(990, x)), Math.max(-990, Math.min(990, z))) + this.rainSeed[i * 3 + 1];
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x; pos[i * 6 + 4] = y - 3.2; pos[i * 6 + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------
  // Screenshot for the report (close-up of the property)
  // ---------------------------------------------------------
  async snapshot(w = 960, h = 540) {
    const prev = {
      pos: this.camera.position.clone(), tgt: this.controls.target.clone(),
      size: this.renderer.getSize(new THREE.Vector2()), aspect: this.camera.aspect,
    };
    const c = this.property ? this.property.center : [0, 0];
    const y = this.heightAt(c[0], c[1]);
    this.tween = null;
    this.camera.position.set(c[0] + 65, y + 42, c[1] + 95);
    this.controls.target.set(c[0], y + 2, c[1]);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
    const wasCur = this.waterCurrent;
    this.waterCurrent = this.waterTarget; // show the final water level
    if (this.waterVisible) this.water.position.y = this.waterTarget;
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/jpeg", 0.88);
    this.renderer.setSize(prev.size.x, prev.size.y, false);
    this.renderer.domElement.style.width = "";
    this.renderer.domElement.style.height = "";
    this.camera.aspect = prev.aspect;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(prev.pos);
    this.controls.target.copy(prev.tgt);
    this.waterCurrent = wasCur;
    this.resize();
    return url;
  }
}
