// ============================================================
// What the voice says (English). Plain functions of the results.
// ============================================================

const EN_H = { week: "next week", month: "next month", year: "next year" };
const ORDER = ["week", "month", "year"];
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function overall(scenarios) {
  const list = ORDER.map((k) => scenarios[k]);
  const flooded = list.find((s) => s.before.key === "flooded");
  if (flooded) return { key: "flooded", first: flooded.key };
  if (list.some((s) => s.before.key === "around")) return { key: "around" };
  return { key: "safe" };
}

export function narrateRisk({ scenarios, propType }) {
  const o = overall(scenarios);
  const who = propType === "house" ? "Your house" : "Your planned house";
  const head =
    o.key === "flooded" ? `${who} floods in the ${EN_H[o.first]} scenario.`
    : o.key === "around" ? "Water reaches your property, but stays below the floor."
    : `${who} stays safe in all three scenarios.`;
  const parts = ORDER.map((k) => `${cap(EN_H[k])}: ${scenarios[k].percent} percent, ${scenarios[k].riskClass.toLowerCase()} risk.`);
  return `Flood risk at your property. ${head} ${parts.join(" ")} These are rainfall scenarios, not a weather forecast.`;
}

export function narrateRec({ rec }) {
  const f = rec.requiredFloor.toFixed(1);
  const r = rec.raiseBy.toFixed(1);
  const v = rec.verdict;
  const head =
    v === "safe" ? "Your house is not expected to flood in these scenarios."
    : v === "ok" ? "Your floor is already high enough."
    : v === "raise" ? `Raise the floor by about ${r} metres, to ${f} metres above ground.`
    : v === "avoid" ? `Do not build on this plot. If you must build, keep the floor at least ${f} metres above ground.`
    : v === "conditional" ? `Build only with a raised, flood-resilient design. Keep the floor at least ${f} metres above ground.`
    : `This plot is suitable for building. Keep the floor at least ${f} metres above ground.`;
  return `Recommendations. ${head} Also dig a drain around the plot and lead it to the nearest waterway.`;
}

export function narrateUpdated({ after, rec, newFloor, scenarios }) {
  const allSafe = Object.values(after).every((s) => s.key !== "flooded");
  const until = scenarios.year.until.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const head = allSafe
    ? `With the floor at ${newFloor.toFixed(1)} metres, water stays below the floor in all three scenarios, through ${until}.`
    : "Water still reaches the floor in one scenario. Raise the floor further.";
  const warn = rec.verdict === "avoid" ? " We still advise against building on this plot." : "";
  return `Updated design. ${head}${warn}`;
}
