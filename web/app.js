// ARSENAL — Destiny 2 Weapon Codex
// Loads the compact data.json and renders a searchable list with two views:
//   · Codex — every perk a weapon can roll, themed to its damage element.
//   · Forge — pick one perk per column to assemble (and copy) a custom roll.

let DATA = null;
let filtered = [];
let activeHash = null;
let mode = "codex"; // "codex" | "forge"
let build = null; // { hash, picks: { socketIndex: perkHash } }
let showEnhanced = false; // hide enhanced perks by default in both views

const els = {
  list: document.getElementById("weapon-list"),
  detail: document.getElementById("detail"),
  tabs: document.getElementById("tabs"),
  search: document.getElementById("search"),
  type: document.getElementById("filter-type"),
  tier: document.getElementById("filter-tier"),
  damage: document.getElementById("filter-damage"),
  enhanced: document.getElementById("toggle-enhanced"),
  count: document.getElementById("count"),
  meta: document.getElementById("meta"),
};

const AMMO = { 1: "Primary", 2: "Special", 3: "Heavy" };
const ELEMENTS = ["Solar", "Arc", "Void", "Stasis", "Strand", "Kinetic"];
const ELEM_HEX = {
  Solar: "#ff7a33", Arc: "#7ec8ff", Void: "#b487f5",
  Stasis: "#5b8dff", Strand: "#37e07e", Kinetic: "#e7ebf0",
};
const COLLAPSE_AT = 12; // collapse fixed columns longer than this

// Magnitude/count stats shown as a raw number, not a 0–100 quality bar (their
// values — e.g. RPM 540, draw time in ms — legitimately exceed the bar max).
const NUMBER_STATS = new Set([
  4284893193, // Rounds Per Minute
  2961396640, // Charge Time
  447667954,  // Draw Time
  2837207746, // Swing Speed
  3871231066, // Magazine
  925767036,  // Ammo Capacity
  1842278586, // Shield Duration
]);

init();

async function init() {
  try {
    const res = await fetch("data.json");
    DATA = await res.json();
  } catch (e) {
    els.detail.innerHTML = `<div class="empty"><p>Failed to load data.json — is the server running?<br>${esc(e.message)}</p></div>`;
    return;
  }
  els.meta.textContent = `${DATA.weaponCount.toLocaleString()} weapons · ${DATA.perkCount.toLocaleString()} perks`;
  buildFilters();
  bindEvents();
  applyFilters();
  showEmpty();
}

function uniqueSorted(getter) {
  return [...new Set(DATA.weapons.map(getter).filter(Boolean))].sort();
}

function buildFilters() {
  for (const t of uniqueSorted((w) => w.itemType)) els.type.append(new Option(t, t));
  for (const t of uniqueSorted((w) => w.tier)) els.tier.append(new Option(t, t));
  for (const d of uniqueSorted((w) => w.damageType)) els.damage.append(new Option(d, d));
}

function bindEvents() {
  els.search.addEventListener("input", applyFilters);
  els.type.addEventListener("change", applyFilters);
  els.tier.addEventListener("change", applyFilters);
  els.damage.addEventListener("change", applyFilters);
  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) setMode(btn.dataset.mode);
  });
  els.enhanced.addEventListener("change", () => {
    showEnhanced = els.enhanced.checked;
    if (activeHash) selectWeapon(activeHash); // re-render current view
  });
}

// An "enhanced" perk is the crafted/upgraded variant; its itemType is prefixed
// "Enhanced " (e.g. "Enhanced Trait", "Enhanced Barrel").
function isEnhanced(perkHash) {
  return /^enhanced\b/i.test((DATA.perks[perkHash] || {}).itemType || "");
}

// Display name with the word "Enhanced" stripped — used to pair a base perk
// with its enhanced variant (e.g. "Golden Tricorn" ↔ "Golden Tricorn Enhanced").
function baseName(perkHash) {
  return ((DATA.perks[perkHash] || {}).name || "")
    .replace(/\benhanced\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Perk references shown for a socket:
//   · toggle OFF → only normal perks (enhanced hidden).
//   · toggle ON  → the enhanced variant replaces its base perk in place; perks
//     with no enhanced variant are left as-is.
function visiblePerks(socket) {
  const perks = socket.perks;
  if (!showEnhanced) return perks.filter((ref) => !isEnhanced(ref.h));

  const enhByName = new Map();
  for (const ref of perks) if (isEnhanced(ref.h)) enhByName.set(baseName(ref.h), ref);

  const out = [];
  const placed = new Set();
  for (const ref of perks) {
    if (isEnhanced(ref.h)) continue; // placed in its base perk's slot below
    const enh = enhByName.get(baseName(ref.h));
    if (enh) { out.push(enh); placed.add(enh.h); }
    else out.push(ref);
  }
  // enhanced perks with no base counterpart (rare) trail at the end
  for (const ref of perks) if (isEnhanced(ref.h) && !placed.has(ref.h)) out.push(ref);
  return out;
}

function elemClass(dmg) {
  return ELEMENTS.includes(dmg) ? `elem-${dmg}` : "elem-Kinetic";
}

function setMode(m) {
  if (mode === m) return;
  mode = m;
  els.tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
  if (activeHash) selectWeapon(activeHash);
  else showEmpty();
}

function showEmpty() {
  els.detail.className = "";
  const msg = mode === "forge"
    ? "Select a weapon to forge a custom roll."
    : "Select a weapon to inspect every perk it can roll.";
  els.detail.innerHTML = `<div class="empty"><span class="empty-mark">◆</span><p>${msg}</p></div>`;
}

function applyFilters() {
  const q = els.search.value.trim().toLowerCase();
  const type = els.type.value, tier = els.tier.value, dmg = els.damage.value;

  filtered = DATA.weapons.filter((w) => {
    if (type && w.itemType !== type) return false;
    if (tier && w.tier !== tier) return false;
    if (dmg && w.damageType !== dmg) return false;
    if (q && !w.name.toLowerCase().includes(q)) return false;
    return true;
  });

  els.count.textContent = `${filtered.length.toLocaleString()} shown`;
  renderList();
}

function renderList() {
  const frag = document.createDocumentFragment();
  for (const w of filtered.slice(0, 400)) {
    const li = document.createElement("li");
    li.className = "weapon-row" + (w.hash === activeHash ? " active" : "");
    const dot = ELEM_HEX[w.damageType] || "transparent";
    li.innerHTML = `
      <div class="wr-frame"><img loading="lazy" src="${w.icon || ""}" alt="" /></div>
      <div class="wr-body">
        <div class="wr-name tier-${w.tier}">${esc(w.name)}</div>
        <div class="wr-sub">
          <span class="wr-dot" style="background:${dot}"></span>${esc(w.itemType)}${w.damageType ? " · " + esc(w.damageType) : ""}
        </div>
      </div>`;
    li.addEventListener("click", () => selectWeapon(w.hash));
    frag.append(li);
  }
  els.list.replaceChildren(frag);
  if (filtered.length > 400) {
    const li = document.createElement("li");
    li.className = "list-more";
    li.textContent = `+ ${(filtered.length - 400).toLocaleString()} more — refine your search`;
    els.list.append(li);
  }
}

// Friendly column title derived from the perks' plug category.
function columnTitle(socket) {
  // The actual intrinsic frame lives in its own socket category. Trait-column
  // perks also carry the "frames" plug category, so resolve by category first
  // to avoid mislabeling the two trait columns as "Intrinsic".
  if (socket.category === "INTRINSIC TRAITS") return "Intrinsic";
  const cats = socket.perks.map((p) => (DATA.perks[p.h] || {}).plugCategory || "");
  const c = (cats.find(Boolean) || "").toLowerCase();
  const map = [
    ["barrel", "Barrel"], ["blade", "Blade"], ["haft", "Haft"], ["scope", "Scope"],
    ["sight", "Sight"], ["bowstring", "String"], ["arrow", "Arrows"], ["tube", "Launch Tube"],
    ["magazine", "Magazine"], ["mag", "Magazine"], ["battery", "Battery"], ["guard", "Guard"],
    ["stock", "Stock"], ["grip", "Grip"], ["origin", "Origin Trait"], ["intrinsic", "Intrinsic"],
    ["masterwork", "Masterwork"], ["mod", "Mod"],
  ];
  for (const [needle, label] of map) if (c.includes(needle)) return label;
  if (socket.category === "WEAPON MODS") return "Mods";
  return "Perk";
}

// ============================ SHARED HERO ============================

function chipsHtml(w) {
  const chip = (label, cls = "") => `<span class="chip ${cls}">${label}</span>`;
  return [
    w.tier ? `<span class="chip"><span class="tier-${w.tier}">${esc(w.tier)}</span></span>` : "",
    chip(esc(w.itemType)),
    w.damageType ? `<span class="chip elem"><span class="swatch"></span>${esc(w.damageType)}</span>` : "",
    AMMO[w.ammoType] ? chip(esc(AMMO[w.ammoType])) : "",
  ].filter(Boolean).join("");
}

function heroHtml(w) {
  return `
    <div class="hero">
      ${w.screenshot ? `<div class="hero-bg" style="background-image:url('${w.screenshot}')"></div>` : ""}
      <div class="hero-veil"></div>
      <div class="hero-inner">
        <div class="hero-icon">
          <img src="${w.icon || ""}" alt="" />
          ${w.watermark ? `<img class="hero-watermark" src="${w.watermark}" alt="" title="season / release watermark" />` : ""}
        </div>
        <div class="hero-text">
          <div class="hero-kicker">${esc(w.itemType)}</div>
          <h2>${esc(w.name)}</h2>
          <div class="chips">${chipsHtml(w)}</div>
          ${w.flavorText ? `<div class="flavor">${esc(w.flavorText)}</div>` : ""}
        </div>
      </div>
    </div>`;
}

// ============================ STATS ============================

// Piecewise-linear investment→display curve from the weapon's stat group.
function interp(points, x) {
  if (!points || !points.length) return x;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i], [bx, by] = points[i + 1];
    if (x <= bx) return ay + ((by - ay) * (x - ax)) / (bx - ax);
  }
  return points[points.length - 1][1];
}

// Displayed stats for a weapon given a list of socketed perk hashes. Perks shift
// the underlying investment value, which is then re-interpolated per stat.
function computeStats(w, pickedHashes) {
  const g = w.statGroup && DATA.statGroups[w.statGroup];
  if (!g || !w.baseStats) return [];
  const totals = { ...w.baseStats };
  for (const h of pickedHashes || []) {
    const ps = (DATA.perks[h] || {}).stats;
    if (!ps) continue;
    for (const k in ps) if (k in totals) totals[k] += ps[k];
  }
  return g.order.map((sh) => {
    const def = g.stats[sh];
    const raw = Math.round(interp(def.interp, totals[sh] ?? 0));
    // Don't clamp to the bar max — number stats (RPM, etc.) exceed it on purpose.
    return { hash: sh, name: DATA.statNames[sh] || "", value: Math.max(0, raw), max: def.max };
  });
}

function statRows(stats, base) {
  return stats.map((s, i) => {
    const b = base ? base[i].value : s.value;
    const d = s.value - b;
    const isNum = NUMBER_STATS.has(Number(s.hash));
    const pct = !isNum && s.max ? Math.max(0, Math.min(100, (s.value / s.max) * 100)) : 0;
    const delta = d > 0 ? `+${d}` : d < 0 ? `${d}` : "";
    const fill = isNum ? "" : `<span class="stat-fill${d ? (d > 0 ? " up" : " down") : ""}" style="width:${pct}%"></span>`;
    return `
      <div class="stat-row${isNum ? " num" : ""}">
        <span class="stat-name">${esc(s.name)}</span>
        <span class="stat-bar">${fill}</span>
        <span class="stat-val">${s.value}${delta ? `<span class="stat-delta ${d > 0 ? "up" : "down"}">${delta}</span>` : ""}</span>
      </div>`;
  }).join("");
}

// Stat panel. In the Forge, pass the current picks so values update live and
// show their delta against the bare-weapon base.
function statPanelHtml(w, picks) {
  const stats = computeStats(w, picks);
  if (!stats.length) return "";
  const base = picks && picks.length ? computeStats(w, []) : null;
  return `
    <section class="socket-group stats-section">
      <h3 class="group-label">Stats</h3>
      <div class="stat-list" id="stat-list">${statRows(stats, base)}</div>
    </section>`;
}

// ============================ ROUTING ============================

function selectWeapon(hash) {
  activeHash = hash;
  renderList();
  const w = DATA.weapons.find((x) => x.hash === hash);
  if (!w) return;
  els.detail.className = elemClass(w.damageType);
  if (mode === "forge") {
    if (!build || build.hash !== hash) startBuild(w);
    renderForge(w);
  } else {
    renderCodex(w);
  }
  els.detail.scrollTop = 0;
}

// ============================ CODEX VIEW ============================

function renderColumn(socket) {
  const title = columnTitle(socket);
  const perks = visiblePerks(socket);
  if (!perks.length) return "";
  const collapsible = !socket.randomized && perks.length > COLLAPSE_AT;
  const initial = collapsible ? perks.slice(0, COLLAPSE_AT) : perks;

  const perkHtml = (ref, i) => {
    const p = DATA.perks[ref.h] || {};
    const cant = ref.r === false ? " cant" : "";
    const enh = isEnhanced(ref.h) ? " enhanced" : "";
    const meta = ref.r === false ? "no longer drops" : (p.itemType || "");
    return `
      <div class="perk${cant}${enh}" style="animation-delay:${Math.min(i, 14) * 22}ms">
        <div class="perk-node"><img loading="lazy" src="${p.icon || ""}" alt="" /></div>
        <div class="perk-info">
          <div class="perk-name">${esc(p.name || "Unknown")}</div>
          ${p.description ? `<div class="perk-desc">${esc(p.description)}</div>` : ""}
          ${meta ? `<div class="perk-meta">${esc(meta)}</div>` : ""}
        </div>
      </div>`;
  };

  const hidden = collapsible
    ? `<div class="col-rest" hidden>${perks.slice(COLLAPSE_AT).map(perkHtml).join("")}</div>
       <button class="col-toggle" data-n="${perks.length - COLLAPSE_AT}">Show ${perks.length - COLLAPSE_AT} more</button>`
    : "";

  return `
    <div class="column ${socket.randomized ? "random" : ""}">
      <div class="col-head">
        <span class="col-title">${esc(title)}</span>
        <span class="tag ${socket.randomized ? "random" : "fixed"}">${socket.randomized ? "Random" : "Fixed"}</span>
      </div>
      ${initial.map(perkHtml).join("")}
      ${hidden}
    </div>`;
}

function renderCodex(w) {
  // group sockets: intrinsic, perks, mods
  const groups = [
    { label: "Intrinsic", test: (s) => s.category === "INTRINSIC TRAITS" },
    { label: "Perks", test: (s) => s.category === "WEAPON PERKS" },
    { label: "Other", test: () => true },
  ];
  const used = new Set();
  const groupHtml = groups
    .map((g) => {
      const socks = w.sockets
        .filter((s, i) => !used.has(i) && g.test(s) && (used.add(i), true))
        .filter((s) => visiblePerks(s).length);
      if (!socks.length) return "";
      return `
        <section class="socket-group">
          <h3 class="group-label">${g.label}</h3>
          <div class="columns">${socks.map(renderColumn).join("")}</div>
        </section>`;
    })
    .join("");

  els.detail.innerHTML = `${heroHtml(w)}<div class="sockets">${statPanelHtml(w, [])}${groupHtml}</div>`;

  // wire up "show more" toggles
  els.detail.querySelectorAll(".col-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rest = btn.previousElementSibling;
      rest.hidden = !rest.hidden;
      btn.textContent = rest.hidden ? `Show ${btn.dataset.n} more` : "Show less";
    });
  });
}

// ============================ FORGE VIEW ============================

// The build slots shown in the Forge, in a fixed canonical order:
//   Barrel · Mag · Perk 1 · Perk 2 · Origin Trait · Masterwork
// The fixed intrinsic frame is excluded — you don't pick it. The two trait
// (frames) columns become Perk 1 / Perk 2; the tracker socket is the Masterwork.
function forgeSlots(w) {
  const slots = [];
  w.sockets.forEach((s, i) => {
    if (s.category === "INTRINSIC TRAITS") return; // frame is fixed, not chosen
    if (!visiblePerks(s).length) return;
    const pc = ((DATA.perks[s.perks[0].h] || {}).plugCategory || "").toLowerCase();
    let label, group;
    if (pc === "frames") { label = "Perk"; group = 1; }          // numbered below
    else if (pc.includes("origin")) { label = "Origin Trait"; group = 2; }
    else if (pc.includes("masterwork")) { label = "Masterwork"; group = 3; }
    else { const t = columnTitle(s); label = t === "Magazine" ? "Mag" : t; group = 0; }
    slots.push({ s, i, label, group });
  });
  slots.sort((a, b) => a.group - b.group); // stable: keeps socket order within a group
  let perkN = 0;
  for (const slot of slots) if (slot.group === 1) slot.label = `Perk ${++perkN}`;
  return slots;
}

function startBuild(w) {
  build = { hash: w.hash, picks: {} };
  for (const { s, i } of forgeSlots(w)) build.picks[i] = visiblePerks(s)[0].h; // default/curated roll
}

// Drop any picks that are no longer visible (e.g. an enhanced perk after the
// toggle is turned off), falling back to the column's first visible perk.
function validateBuild(w) {
  for (const { s, i } of forgeSlots(w)) {
    const perks = visiblePerks(s);
    if (perks.some((ref) => ref.h === build.picks[i])) continue;
    // keep the same perk across a toggle by mapping base ↔ enhanced by name
    const want = baseName(build.picks[i]);
    const match = want && perks.find((ref) => baseName(ref.h) === want);
    build.picks[i] = (match || perks[0]).h;
  }
}

function forgeColumnHtml({ s, i, label }) {
  const perks0 = visiblePerks(s);
  const single = perks0.length === 1;
  const perks = perks0.map((ref) => {
    const p = DATA.perks[ref.h] || {};
    const sel = build.picks[i] === ref.h ? " selected" : "";
    const cant = ref.r === false ? " cant" : "";
    const enh = isEnhanced(ref.h) ? " enhanced" : "";
    return `
      <button class="forge-perk${sel}${cant}${enh}" type="button" data-col="${i}" data-perk="${ref.h}"
              title="${esc(p.description || "")}">
        <span class="fp-node"><img loading="lazy" src="${p.icon || ""}" alt="" /></span>
        <span class="fp-text">
          <span class="fp-name">${esc(p.name || "Unknown")}</span>
          ${ref.r === false ? `<span class="fp-meta">retired</span>` : ""}
        </span>
      </button>`;
  }).join("");

  return `
    <div class="forge-col${single ? " single" : ""}">
      <div class="col-head">
        <span class="col-title">${esc(label)}</span>
        <span class="tag ${s.randomized ? "random" : "fixed"}">${s.randomized ? "Random" : "Fixed"}</span>
      </div>
      <div class="forge-perks">${perks}</div>
    </div>`;
}

function rollGridHtml(w) {
  return forgeSlots(w).map(({ s, i, label }) => {
    const ref = visiblePerks(s).find((p) => p.h === build.picks[i]);
    const p = ref ? DATA.perks[ref.h] : null;
    const enh = ref && isEnhanced(ref.h) ? " enhanced" : "";
    return `
      <div class="roll-item${p ? "" : " empty"}${enh}">
        <span class="ri-node">${p ? `<img src="${p.icon || ""}" alt="" />` : "?"}</span>
        <span class="ri-text">
          <span class="ri-col">${esc(label)}</span>
          <span class="ri-name">${p ? esc(p.name || "Unknown") : "—"}</span>
        </span>
      </div>`;
  }).join("");
}

function renderForge(w) {
  validateBuild(w);
  const cols = forgeSlots(w);
  els.detail.classList.add("forge-view");
  els.detail.innerHTML = `
    ${heroHtml(w)}
    <div class="forge">
      <section class="roll">
        <div class="roll-head">
          <h3>Your Roll</h3>
          <div class="roll-actions">
            <button class="rbtn" type="button" id="forge-random">⟳ Random</button>
            <button class="rbtn" type="button" id="forge-reset">Reset</button>
            <button class="rbtn primary" type="button" id="forge-copy">⧉ Copy</button>
          </div>
        </div>
        <div class="roll-grid" id="roll-grid">${rollGridHtml(w)}</div>
      </section>
      ${statPanelHtml(w, buildPicks())}
      <section class="socket-group">
        <h3 class="group-label">Choose Perks</h3>
        <div class="forge-cols">${cols.map(forgeColumnHtml).join("")}</div>
      </section>
    </div>`;

  // pick a perk
  els.detail.querySelectorAll(".forge-perk").forEach((btn) => {
    btn.addEventListener("click", () => {
      const col = Number(btn.dataset.col);
      build.picks[col] = Number(btn.dataset.perk);
      els.detail.querySelectorAll(`.forge-perk[data-col="${col}"]`)
        .forEach((b) => b.classList.toggle("selected", b === btn));
      refreshRoll(w);
    });
  });

  els.detail.querySelector("#forge-random").addEventListener("click", () => {
    for (const { s, i } of cols) {
      const vis = visiblePerks(s);
      const pool = vis.filter((p) => p.r !== false);
      const from = pool.length ? pool : vis;
      build.picks[i] = from[Math.floor(Math.random() * from.length)].h;
    }
    repaintSelections();
    refreshRoll(w);
  });

  els.detail.querySelector("#forge-reset").addEventListener("click", () => {
    startBuild(w);
    repaintSelections();
    refreshRoll(w);
  });

  els.detail.querySelector("#forge-copy").addEventListener("click", (e) => copyBuild(w, e.currentTarget));
}

function repaintSelections() {
  els.detail.querySelectorAll(".forge-perk").forEach((b) => {
    const col = Number(b.dataset.col);
    b.classList.toggle("selected", build.picks[col] === Number(b.dataset.perk));
  });
}

function buildPicks() {
  return build ? Object.values(build.picks) : [];
}

function refreshRoll(w) {
  const grid = els.detail.querySelector("#roll-grid");
  if (grid) grid.innerHTML = rollGridHtml(w);
  const stats = els.detail.querySelector("#stat-list");
  if (stats) stats.innerHTML = statRows(computeStats(w, buildPicks()), computeStats(w, []));
}

function buildText(w) {
  const lines = [`${w.name} — ${[w.damageType, w.itemType].filter(Boolean).join(" ")}`];
  for (const { i, label } of forgeSlots(w)) {
    const p = DATA.perks[build.picks[i]];
    if (p) lines.push(`${label}: ${p.name}`);
  }
  return lines.join("\n");
}

function copyBuild(w, btn) {
  const text = buildText(w);
  const done = (ok) => {
    const old = btn.textContent;
    btn.textContent = ok ? "✓ Copied" : "✗ Failed";
    setTimeout(() => (btn.textContent = old), 1400);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  } else {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done(true);
    } catch {
      done(false);
    }
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
