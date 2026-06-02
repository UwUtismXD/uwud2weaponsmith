// ARSENAL — Destiny 2 Weapon Codex
// Loads the compact data.json and renders a searchable list + a detail view
// of every perk each weapon can roll, themed to the weapon's damage element.

let DATA = null;
let filtered = [];
let activeHash = null;

const els = {
  list: document.getElementById("weapon-list"),
  detail: document.getElementById("detail"),
  search: document.getElementById("search"),
  type: document.getElementById("filter-type"),
  tier: document.getElementById("filter-tier"),
  damage: document.getElementById("filter-damage"),
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
}

function elemClass(dmg) {
  return ELEMENTS.includes(dmg) ? `elem-${dmg}` : "elem-Kinetic";
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
  const cats = socket.perks.map((p) => (DATA.perks[p.h] || {}).plugCategory || "");
  const c = (cats.find(Boolean) || "").toLowerCase();
  const map = [
    ["barrel", "Barrel"], ["blade", "Blade"], ["haft", "Haft"], ["scope", "Scope"],
    ["sight", "Sight"], ["bowstring", "String"], ["arrow", "Arrows"], ["tube", "Launch Tube"],
    ["magazine", "Magazine"], ["mag", "Magazine"], ["battery", "Battery"], ["guard", "Guard"],
    ["stock", "Stock"], ["grip", "Grip"], ["origin", "Origin Trait"], ["intrinsic", "Intrinsic"],
    ["frame", "Intrinsic"], ["masterwork", "Masterwork"], ["mod", "Mod"],
  ];
  for (const [needle, label] of map) if (c.includes(needle)) return label;
  if (socket.category === "INTRINSIC TRAITS") return "Intrinsic";
  if (socket.category === "WEAPON MODS") return "Mods";
  return "Trait";
}

let animSeq = 0;

function renderColumn(socket) {
  const title = columnTitle(socket);
  const perks = socket.perks;
  const collapsible = !socket.randomized && perks.length > COLLAPSE_AT;
  const initial = collapsible ? perks.slice(0, COLLAPSE_AT) : perks;

  const perkHtml = (ref, i) => {
    const p = DATA.perks[ref.h] || {};
    const cant = ref.r === false ? " cant" : "";
    const meta = ref.r === false ? "no longer drops" : (p.itemType || "");
    return `
      <div class="perk${cant}" style="animation-delay:${Math.min(i, 14) * 22}ms">
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

function selectWeapon(hash) {
  activeHash = hash;
  renderList();
  const w = DATA.weapons.find((x) => x.hash === hash);
  if (!w) return;

  els.detail.className = elemClass(w.damageType);

  const chip = (label, cls = "") => `<span class="chip ${cls}">${label}</span>`;
  const chips = [
    w.tier ? `<span class="chip"><span class="tier-${w.tier}">${esc(w.tier)}</span></span>` : "",
    chip(esc(w.itemType)),
    w.damageType ? `<span class="chip elem"><span class="swatch"></span>${esc(w.damageType)}</span>` : "",
    AMMO[w.ammoType] ? chip(esc(AMMO[w.ammoType])) : "",
  ].filter(Boolean).join("");

  // group sockets: intrinsic, perks, mods
  const groups = [
    { label: "Intrinsic", test: (s) => s.category === "INTRINSIC TRAITS" },
    { label: "Perks", test: (s) => s.category === "WEAPON PERKS" },
    { label: "Other", test: () => true },
  ];
  const used = new Set();
  const groupHtml = groups
    .map((g) => {
      const socks = w.sockets.filter((s, i) => !used.has(i) && g.test(s) && (used.add(i), true));
      if (!socks.length) return "";
      return `
        <section class="socket-group">
          <h3 class="group-label">${g.label}</h3>
          <div class="columns">${socks.map(renderColumn).join("")}</div>
        </section>`;
    })
    .join("");

  els.detail.innerHTML = `
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
          <div class="chips">${chips}</div>
          ${w.flavorText ? `<div class="flavor">${esc(w.flavorText)}</div>` : ""}
        </div>
      </div>
    </div>
    <div class="sockets">${groupHtml}</div>`;

  // wire up "show more" toggles
  els.detail.querySelectorAll(".col-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rest = btn.previousElementSibling;
      rest.hidden = !rest.hidden;
      btn.textContent = rest.hidden ? `Show ${btn.dataset.n} more` : "Show less";
    });
  });

  els.detail.scrollTop = 0;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
