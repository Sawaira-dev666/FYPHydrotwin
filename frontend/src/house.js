import * as THREE from "three";

// ============================================================
// The HydroTwin model house, built from plain boxes and cylinders.
// Typical Punjab house: concrete plinth with steps, cream walls,
// flat roof with a parapet and a water tank, door and windows.
//
// Local axes: x = width, z = depth, y = up. Origin = middle of the
// house at ground level. The door is on the +z side.
// ============================================================

const C = {
  plinth: 0xa9a49a,
  wall: 0xefe6cf,
  wallAfter: 0xf6f2e6,
  wallAvoid: 0xd9806b,
  band: 0xbdb8ad,
  roof: 0x8f8b82,
  door: 0x5a3b22,
  glass: 0x7fb3d1,
  tank: 0x23282c,
  step: 0xb4afa4,
  fence: 0xcdbf9b,
};

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// size of the house inside a plot of w x d metres
export function houseSize(plotW, plotD) {
  const w = Math.max(6, Math.min(plotW * 0.85, Math.min(16, plotW * 0.62)));
  const d = Math.max(7, Math.min(plotD * 0.85, Math.min(18, plotD * 0.62)));
  return { w: Math.min(w, plotW * 0.9), d: Math.min(d, plotD * 0.9) };
}

export function makeDummyHouse({ w, d, storeys, floor, storeyH = 3, tone = "normal" }) {
  const g = new THREE.Group();
  const wallColor = tone === "after" ? C.wallAfter : tone === "avoid" ? C.wallAvoid : C.wall;
  const bodyH = storeys * storeyH;
  const top = floor + bodyH;

  // plinth (goes 1 m underground so it never floats)
  g.add(box(w + 0.5, floor + 1, d + 0.5, C.plinth, 0, (floor - 1) / 2, 0));

  // steps up to the door when the floor is raised
  if (floor > 0.25) {
    const n = Math.max(1, Math.round(floor / 0.18));
    for (let i = 0; i < n; i++) {
      const h = (floor * (n - i)) / n;
      g.add(box(1.8, h, 0.32, C.step, 0, h / 2, d / 2 + 0.25 + 0.32 * (i + 0.5)));
    }
  }

  // walls
  g.add(box(w, bodyH, d, wallColor, 0, floor + bodyH / 2, 0));

  // slab bands between storeys
  for (let s = 1; s < storeys; s++) {
    g.add(box(w + 0.2, 0.22, d + 0.2, C.band, 0, floor + s * storeyH, 0));
  }

  // roof slab and parapet
  g.add(box(w + 0.3, 0.25, d + 0.3, C.roof, 0, top + 0.12, 0));
  const pH = 0.9, pT = 0.22, py = top + 0.25 + pH / 2;
  g.add(box(w + 0.3, pH, pT, C.band, 0, py, d / 2 + 0.04));
  g.add(box(w + 0.3, pH, pT, C.band, 0, py, -d / 2 - 0.04));
  g.add(box(pT, pH, d + 0.3, C.band, w / 2 + 0.04, py, 0));
  g.add(box(pT, pH, d + 0.3, C.band, -w / 2 - 0.04, py, 0));

  // roof water tank on a small stand
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, 1.25, 18),
    new THREE.MeshLambertMaterial({ color: C.tank })
  );
  tank.position.set(-w / 2 + 1.3, top + 0.25 + 0.55 + 0.62, -d / 2 + 1.3);
  tank.castShadow = true;
  g.add(tank);
  g.add(box(1.3, 0.55, 1.3, C.band, -w / 2 + 1.3, top + 0.25 + 0.27, -d / 2 + 1.3));

  // door
  g.add(box(1.1, 2.1, 0.14, C.door, 0, floor + 1.05, d / 2 + 0.07));

  // windows: front, back and both sides, on every storey
  for (let s = 0; s < storeys; s++) {
    const y = floor + s * storeyH + 1.75;
    const frontXs = s === 0 ? [-w * 0.3, w * 0.3] : [-w * 0.3, 0, w * 0.3];
    frontXs.forEach((x) => g.add(box(1.2, 1.2, 0.12, C.glass, x, y, d / 2 + 0.06)));
    [-w * 0.25, w * 0.25].forEach((x) => g.add(box(1.2, 1.2, 0.12, C.glass, x, y, -d / 2 - 0.06)));
    [-d * 0.25, d * 0.25].forEach((z) => {
      g.add(box(0.12, 1.2, 1.2, C.glass, w / 2 + 0.06, y, z));
      g.add(box(0.12, 1.2, 1.2, C.glass, -w / 2 - 0.06, y, z));
    });
  }
  return g;
}

// Low boundary wall along the plot outline, in world coordinates.
export function makeBoundaryWall(poly, heightAt, height = 1.3) {
  const g = new THREE.Group();
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const seg = box(len, height + 1, 0.22, C.fence, 0, 0, 0);
    seg.position.set(mx, heightAt(mx, mz) + height / 2 - 0.5, mz);
    seg.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    g.add(seg);
  }
  return g;
}
