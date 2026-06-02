// Transforms the big weapons.json into a compact file for the web UI.
// Perks are deduped into a dictionary so descriptions aren't repeated across
// every weapon, shrinking ~124 MB down to a few MB the browser can load fast.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const src = path.join(__dirname, "weapons.json");
const outDir = path.join(__dirname, "web");
const out = path.join(outDir, "data.json");

if (!fs.existsSync(src)) {
  console.error("weapons.json not found. Run `node index.js` first.");
  process.exit(1);
}

console.log("Reading weapons.json...");
const data = JSON.parse(fs.readFileSync(src, "utf8"));

const perks = {}; // hash -> static perk info (stored once)

function registerPerk(p) {
  if (!perks[p.hash]) {
    perks[p.hash] = {
      name: p.name,
      description: p.description,
      itemType: p.itemType,
      plugCategory: p.plugCategory,
      icon: p.icon,
    };
  }
}

const weapons = data.weapons.map((w) => ({
  hash: w.hash,
  name: w.name,
  flavorText: w.flavorText,
  itemType: w.itemType,
  tier: w.tier,
  damageType: w.damageType,
  ammoType: w.ammoType,
  icon: w.icon,
  screenshot: w.screenshot,
  watermark: w.watermark,
  sockets: w.sockets.map((s) => {
    s.perks.forEach(registerPerk);
    return {
      category: s.category,
      randomized: s.randomized,
      // keep only references + roll info per weapon
      perks: s.perks.map((p) => ({ h: p.hash, r: p.canRoll, s: p.sources })),
    };
  }),
}));

const output = {
  generatedAt: data.generatedAt,
  manifestVersion: data.manifestVersion,
  weaponCount: weapons.length,
  perkCount: Object.keys(perks).length,
  perks,
  weapons,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, JSON.stringify(output));
const mb = (fs.statSync(out).size / 1e6).toFixed(1);
console.log(
  `Wrote ${out}: ${weapons.length} weapons, ${output.perkCount} unique perks (${mb} MB)`
);
