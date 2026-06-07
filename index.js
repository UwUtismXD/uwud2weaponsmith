// Destiny 2 weapon + perk exporter.
//
// Pulls the public Destiny 2 Manifest (no OAuth needed, just an API key),
// resolves every weapon's socket / plug-set data into the full list of perks
// it can roll, and writes the result to weapons.json.
//
// Usage:  node index.js  [--all-sockets] [--pretty] [--out FILE]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = "https://www.bungie.net";
const MANIFEST_URL = `${BASE}/Platform/Destiny2/Manifest/`;
const LANG = "en";

// Socket category hashes (constant across the game).
const CAT_INTRINSIC = 3956125808; // INTRINSIC TRAITS (frame)
const CAT_WEAPON_PERKS = 4241085061; // WEAPON PERKS (the trait columns)
const CAT_WEAPON_MODS = 2685412949; // WEAPON MODS (mods + masterwork)

const DESTINY_ITEM_TYPE_WEAPON = 3;

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const opts = {
  allSockets: args.includes("--all-sockets"),
  pretty: args.includes("--pretty"),
  out: (() => {
    const i = args.indexOf("--out");
    return i >= 0 && args[i + 1] ? args[i + 1] : path.join(__dirname, "weapons.json");
  })(),
};

// ---- helpers --------------------------------------------------------------
function getApiKey() {
  if (process.env.BUNGIE_API_KEY) return process.env.BUNGIE_API_KEY.trim();
  const keyFile = path.join(__dirname, "apikey.txt");
  if (fs.existsSync(keyFile)) {
    const key = fs.readFileSync(keyFile, "utf8").trim();
    if (key) return key;
  }
  throw new Error(
    "No API key found. Set BUNGIE_API_KEY env var or put the key in apikey.txt"
  );
}

const API_KEY = getApiKey();

async function bungieJson(url) {
  const res = await fetch(url, { headers: { "X-API-Key": API_KEY } });
  if (!res.ok) {
    throw new Error(`Request failed ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

// Download a manifest table, caching it on disk so re-runs are fast.
async function getTable(relativePath, name) {
  const cacheDir = path.join(__dirname, "manifest-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  // The manifest path includes a version hash, so cache file == that hash.
  const cacheFile = path.join(cacheDir, path.basename(relativePath));
  if (fs.existsSync(cacheFile)) {
    process.stdout.write(`  ${name}: cached\n`);
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }
  process.stdout.write(`  ${name}: downloading...`);
  const res = await fetch(`${BASE}${relativePath}`, {
    headers: { "X-API-Key": API_KEY },
  });
  if (!res.ok) throw new Error(`Failed to download ${name}: ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(cacheFile, text);
  process.stdout.write(` done (${(text.length / 1e6).toFixed(1)} MB)\n`);
  return JSON.parse(text);
}

const iconUrl = (dp) => (dp && dp.hasIcon && dp.icon ? `${BASE}${dp.icon}` : null);

// ---- main -----------------------------------------------------------------
async function main() {
  console.log("Fetching manifest...");
  const manifest = await bungieJson(MANIFEST_URL);
  const paths = manifest.Response.jsonWorldComponentContentPaths[LANG];
  console.log(`Manifest version: ${manifest.Response.version}`);

  console.log("Loading definition tables:");
  const [items, plugSets, socketCategories, damageTypes, statDefs, statGroupDefs] =
    await Promise.all([
      getTable(paths.DestinyInventoryItemDefinition, "InventoryItem"),
      getTable(paths.DestinyPlugSetDefinition, "PlugSet"),
      getTable(paths.DestinySocketCategoryDefinition, "SocketCategory"),
      getTable(paths.DestinyDamageTypeDefinition, "DamageType"),
      getTable(paths.DestinyStatDefinition, "Stat"),
      getTable(paths.DestinyStatGroupDefinition, "StatGroup"),
    ]);

  // Stat plumbing. A weapon's displayed stats come from its stat group's
  // `scaledStats` (which stats, their order, max, and the investment→display
  // interpolation curve). Perks shift the underlying investment value, which is
  // then re-interpolated — matching what the game shows.
  const statName = (h) =>
    (statDefs[h] && statDefs[h].displayProperties && statDefs[h].displayProperties.name) || "";
  const usedStatGroups = new Map(); // groupHash -> { order, stats } (built once)
  const statNamesUsed = new Set();

  function exportStatGroup(groupHash) {
    if (usedStatGroups.has(groupHash)) return usedStatGroups.get(groupHash);
    const g = statGroupDefs[groupHash];
    if (!g || !g.scaledStats) return null;
    const order = [];
    const stats = {};
    for (const ss of g.scaledStats) {
      order.push(ss.statHash);
      statNamesUsed.add(ss.statHash);
      stats[ss.statHash] = {
        max: ss.maximumValue || 100,
        interp: (ss.displayInterpolation || []).map((p) => [p.value, p.weight]),
      };
    }
    const out = { order, stats };
    usedStatGroups.set(groupHash, out);
    return out;
  }

  // Resolve a single plug (perk) hash into a compact descriptor.
  function resolvePlug(hash, extra = {}) {
    const def = items[hash];
    if (!def) return null;
    const dp = def.displayProperties || {};
    // Unconditional stat modifiers this perk applies to the weapon's investment.
    const stats = {};
    for (const s of def.investmentStats || []) {
      if (!s.isConditionallyActive && s.value) stats[s.statTypeHash] = s.value;
    }
    return {
      hash: Number(hash),
      name: dp.name || "",
      description: dp.description || "",
      itemType: def.itemTypeDisplayName || "",
      plugCategory: def.plug ? def.plug.plugCategoryIdentifier : null,
      icon: iconUrl(dp),
      ...(Object.keys(stats).length ? { stats } : {}),
      ...extra,
    };
  }

  // Pull every plug hash a socket can hold (curated + random-roll).
  function resolveSocket(entry) {
    const perks = new Map(); // hash -> descriptor (deduped)

    const add = (hash, source, canRoll) => {
      if (!hash) return;
      const existing = perks.get(hash);
      if (existing) {
        existing.sources.add(source);
        if (canRoll) existing.canRoll = true;
        return;
      }
      const p = resolvePlug(hash, { canRoll: !!canRoll });
      if (!p) return;
      p.sources = new Set([source]);
      perks.set(hash, p);
    };

    // Curated / default plug shown on a freshly previewed item.
    add(entry.singleInitialItemHash, "default", true);

    // Fixed reusable plugs listed inline on the socket.
    for (const r of entry.reusablePlugItems || []) add(r.plugItemHash, "reusable", true);

    // Curated reusable pool referenced by hash.
    if (entry.reusablePlugSetHash && plugSets[entry.reusablePlugSetHash]) {
      for (const p of plugSets[entry.reusablePlugSetHash].reusablePlugItems || [])
        add(p.plugItemHash, "curated", p.currentlyCanRoll !== false);
    }

    // Randomized roll pool (the real "what can this drop with").
    if (entry.randomizedPlugSetHash && plugSets[entry.randomizedPlugSetHash]) {
      for (const p of plugSets[entry.randomizedPlugSetHash].reusablePlugItems || [])
        add(p.plugItemHash, "random", p.currentlyCanRoll !== false);
    }

    return [...perks.values()].map((p) => ({ ...p, sources: [...p.sources] }));
  }

  console.log("Processing weapons...");
  const weapons = [];
  let scanned = 0;

  for (const [hash, item] of Object.entries(items)) {
    if (item.itemType !== DESTINY_ITEM_TYPE_WEAPON) continue;
    if (item.redacted || !item.displayProperties || !item.displayProperties.name) continue;
    if (!item.sockets || !item.sockets.socketEntries) continue;
    scanned++;

    // Map each socket index -> its category hash.
    const indexToCategory = new Map();
    for (const cat of item.sockets.socketCategories || []) {
      for (const idx of cat.socketIndexes || []) {
        indexToCategory.set(idx, cat.socketCategoryHash);
      }
    }

    const sockets = [];
    item.sockets.socketEntries.forEach((entry, idx) => {
      const catHash = indexToCategory.get(idx);
      const isPerkish =
        catHash === CAT_INTRINSIC ||
        catHash === CAT_WEAPON_PERKS;
      // Skip mods/masterwork + cosmetic sockets (shaders/ornaments) unless --all-sockets.
      if (!isPerkish && !opts.allSockets) return;

      const catDef = catHash ? socketCategories[catHash] : null;
      const perks = resolveSocket(entry);
      if (perks.length === 0) return;

      sockets.push({
        socketIndex: idx,
        category: catDef && catDef.displayProperties ? catDef.displayProperties.name : "Unknown",
        categoryHash: catHash ?? null,
        randomized: !!entry.randomizedPlugSetHash,
        perks,
      });
    });

    const dt =
      item.defaultDamageTypeHash && damageTypes[item.defaultDamageTypeHash]
        ? damageTypes[item.defaultDamageTypeHash].displayProperties.name
        : null;

    // Base (investment) stat values for the stats this weapon's group displays.
    const groupHash = item.stats ? item.stats.statGroupHash : null;
    const group = groupHash ? exportStatGroup(groupHash) : null;
    let baseStats = null;
    if (group) {
      const inv = {};
      for (const s of item.investmentStats || []) {
        if (!s.isConditionallyActive) inv[s.statTypeHash] = s.value;
      }
      baseStats = {};
      for (const sh of group.order) baseStats[sh] = inv[sh] || 0;
    }

    weapons.push({
      hash: Number(hash),
      name: item.displayProperties.name,
      flavorText: item.flavorText || "",
      itemType: item.itemTypeDisplayName || "",
      tier: item.inventory ? item.inventory.tierTypeName : null,
      equipmentSlot: item.equippingBlock ? item.equippingBlock.uniqueLabel : null,
      damageType: dt,
      ammoType: item.equippingBlock ? item.equippingBlock.ammoType : null,
      icon: iconUrl(item.displayProperties),
      screenshot: item.screenshot ? `${BASE}${item.screenshot}` : null,
      watermark: item.iconWatermark ? `${BASE}${item.iconWatermark}` : null,
      statGroup: group ? groupHash : null,
      baseStats,
      sockets,
    });
  }

  weapons.sort((a, b) => a.name.localeCompare(b.name));

  const statNames = {};
  for (const sh of statNamesUsed) statNames[sh] = statName(sh);
  const statGroups = {};
  for (const [gh, g] of usedStatGroups) statGroups[gh] = g;

  const output = {
    generatedAt: new Date().toISOString(),
    manifestVersion: manifest.Response.version,
    weaponCount: weapons.length,
    statNames,
    statGroups,
    weapons,
  };

  fs.writeFileSync(opts.out, JSON.stringify(output, null, opts.pretty ? 2 : 0));
  const bytes = fs.statSync(opts.out).size;
  console.log(
    `\nDone. ${weapons.length} weapons written to ${opts.out} (${(bytes / 1e6).toFixed(1)} MB)`
  );
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
