// ============================================================
// A picture of the house and the flood water, drawn in code.
// Side view: ground, house on its plinth, a dashed floor line,
// and the water level at the chosen depth.
// ============================================================

export function houseStatusKey(depth, floor) {
  if (depth <= 0) return "dry";
  if (depth <= floor) return "around";
  return "flooded";
}

const TEXT = {
  dry: "No flood water reaches the house.",
  around: "Water around the house. The floor stays dry.",
  flooded: "Water enters the house.",
};

export function houseSceneSVG({ depth, floor, storeys, caption = "", raised = false }) {
  const W = 360, H = 218, groundY = 168;
  const bodyM = storeys * 3;
  const totalM = floor + bodyM + 1.3;
  const s = Math.min(44, 128 / Math.max(totalM, depth + 0.6, 2.2)); // pixels per metre
  const hw = 120, hx = (W - hw) / 2;
  const floorY = groundY - floor * s;
  const topY = floorY - bodyM * s;
  const waterY = groundY - depth * s;
  const key = houseStatusKey(depth, floor);
  const wet = depth > 0;

  const sky = wet ? "#c3d3da" : "#d9ebf2";
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${sky}"/>`);

  // clouds and rain when there is flood water
  if (wet) {
    parts.push(`<g fill="#8fa3ad"><ellipse cx="70" cy="34" rx="34" ry="14"/><ellipse cx="98" cy="28" rx="26" ry="13"/><ellipse cx="270" cy="30" rx="36" ry="14"/><ellipse cx="300" cy="36" rx="24" ry="11"/></g>`);
    let drops = "";
    for (let i = 0; i < 26; i++) {
      const x = 14 + ((i * 53) % 330), y = 50 + ((i * 37) % 70);
      drops += `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 11}"/>`;
    }
    parts.push(`<g stroke="#5d8aa3" stroke-width="1.6" stroke-linecap="round" opacity=".75">${drops}</g>`);
  } else {
    parts.push(`<circle cx="300" cy="40" r="17" fill="#f6c453"/>`);
  }

  // ground
  parts.push(`<rect x="0" y="${groundY}" width="${W}" height="${H - groundY}" fill="#a99870"/>`);
  parts.push(`<rect x="0" y="${groundY}" width="${W}" height="3" fill="#8b7c58"/>`);

  // boundary wall pieces
  parts.push(`<rect x="8" y="${groundY - 1.3 * s}" width="${hx - 40}" height="${1.3 * s}" fill="#cdbf9b"/>`);
  parts.push(`<rect x="${hx + hw + 90}" y="${groundY - 1.3 * s}" width="${Math.max(0, W - hx - hw - 98)}" height="${1.3 * s}" fill="#cdbf9b"/>`);

  // plinth (+ steps)
  if (floor > 0.02) {
    parts.push(`<rect x="${hx - 6}" y="${floorY}" width="${hw + 12}" height="${groundY - floorY}" fill="#a9a49a"/>`);
    const n = Math.max(1, Math.round(floor / 0.18));
    for (let i = 0; i < n; i++) {
      const h = (floor * (n - i)) / n * s;
      parts.push(`<rect x="${hx + hw + 6 + i * 7}" y="${groundY - h}" width="7" height="${h}" fill="#b4afa4"/>`);
    }
  }

  // body, bands, roof, tank
  parts.push(`<rect x="${hx}" y="${topY}" width="${hw}" height="${bodyM * s}" fill="#efe6cf" stroke="#bdb8ad"/>`);
  for (let k = 1; k < storeys; k++) {
    parts.push(`<rect x="${hx - 2}" y="${floorY - k * 3 * s - 2}" width="${hw + 4}" height="4" fill="#bdb8ad"/>`);
  }
  parts.push(`<rect x="${hx - 5}" y="${topY - 5}" width="${hw + 10}" height="7" fill="#8f8b82"/>`);
  parts.push(`<rect x="${hx - 5}" y="${topY - 0.9 * s - 3}" width="${hw + 10}" height="${0.9 * s}" fill="#d6d1c5" opacity=".9"/>`);
  parts.push(`<rect x="${hx + 10}" y="${topY - 5 - 1.0 * s}" width="${0.9 * s}" height="${1.0 * s}" rx="${0.3 * s}" fill="#23282c"/>`);

  // door and windows
  const doorW = 0.95 * s, doorH = 2.1 * s;
  parts.push(`<rect x="${hx + hw / 2 - doorW / 2}" y="${floorY - doorH}" width="${doorW}" height="${doorH}" fill="#5a3b22"/>`);
  for (let k = 0; k < storeys; k++) {
    const wy = floorY - (k * 3 + 2.35) * s, wh = 1.2 * s, ww = 1.15 * s;
    const xs = k === 0 ? [hx + hw * 0.2, hx + hw * 0.8 - ww] : [hx + hw * 0.18, hx + hw / 2 - ww / 2, hx + hw * 0.82 - ww];
    xs.forEach((x) => parts.push(`<rect x="${x}" y="${wy}" width="${ww}" height="${wh}" fill="#7fb3d1" stroke="#5a7f94"/>`));
  }

  // floor level line
  parts.push(`<line x1="${hx - 30}" y1="${floorY}" x2="${hx + hw + 30}" y2="${floorY}" stroke="#d98a00" stroke-width="1.8" stroke-dasharray="6 4"/>`);
  parts.push(`<text x="${hx + hw + 34}" y="${floorY - 5}" font-size="11" font-weight="700" fill="#7a4f00">Floor ${floor.toFixed(1)} m</text>`);

  // water, in front of the house
  if (wet) {
    let wave = `M0 ${waterY}`;
    for (let x = 0; x <= W; x += 20) wave += ` Q${x + 5} ${waterY - 3} ${x + 10} ${waterY} T${x + 20} ${waterY}`;
    wave += ` L${W} ${groundY + 4} L0 ${groundY + 4} Z`;
    parts.push(`<path d="${wave}" fill="#2f86b8" opacity=".62"/>`);
    parts.push(`<line x1="8" y1="${waterY}" x2="8" y2="${groundY}" stroke="#12506f" stroke-width="2"/>`);
    parts.push(`<text x="14" y="${Math.min(groundY - 4, waterY + 14)}" font-size="11" font-weight="700" fill="#08283a">Water ${depth.toFixed(2)} m</text>`);
  } else {
    parts.push(`<text x="14" y="${groundY - 8}" font-size="11" font-weight="700" fill="#17623d">No flood water</text>`);
  }

  const badgeFill = key === "dry" ? "#d7f0e2" : key === "around" ? "#fbe9c2" : "#fbd9d0";
  const badgeText = key === "dry" ? "#17623d" : key === "around" ? "#7a4f00" : "#8a2a14";
  const label = key === "dry" ? "Safe" : key === "around" ? "Floor stays dry" : "Flooded";
  parts.push(`<rect x="10" y="8" width="${label.length * 7.4 + 18}" height="22" rx="11" fill="${badgeFill}"/>`);
  parts.push(`<text x="19" y="23" font-size="12.5" font-weight="700" fill="${badgeText}">${label}</text>`);
  if (raised) parts.push(`<text x="${W - 10}" y="22" text-anchor="end" font-size="11" font-weight="700" fill="#17623d">Raised floor</text>`);
  if (caption) parts.push(`<text x="${W - 10}" y="${raised ? 36 : 22}" text-anchor="end" font-size="11" fill="#33474d">${caption}</text>`);

  const desc = `${TEXT[key]} Water depth ${depth.toFixed(2)} metres, floor ${floor.toFixed(1)} metres.`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${desc}"><title>${desc}</title>${parts.join("")}</svg>`;
}
