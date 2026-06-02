# Destiny 2 Weapon Exporter

Downloads every Destiny 2 weapon and the full list of perks each one can roll
into a single `weapons.json` file, using the public Bungie Destiny 2 Manifest.

No OAuth / login required — just a Bungie **API key**.

## Setup

1. Get an API key at <https://www.bungie.net/en/Application> (OAuth Client Type
   can be set to *Not Applicable*).
2. Provide the key one of two ways:
   - put it in `apikey.txt` (already done), **or**
   - set the `BUNGIE_API_KEY` environment variable.

Requires Node.js 18+ (uses built-in `fetch`). No npm install needed.

## Usage

```bash
node index.js              # writes weapons.json
node index.js --pretty     # human-readable, indented JSON
node index.js --all-sockets# also include cosmetic sockets (shaders/ornaments)
node index.js --out foo.json
```

The first run downloads the manifest definition tables (~170 MB) into
`manifest-cache/` and reuses them on later runs. Delete that folder to force a
fresh download when Bungie ships a new manifest version.

## Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import `uwud2weaponsmith` from GitHub.
2. Before deploying, add an **Environment Variable** in the Vercel project settings:
   - Name: `BUNGIE_API_KEY`
   - Value: your Bungie API key
3. Deploy — Vercel runs `node index.js && node build-web-data.js` as the build step,
   downloads the live manifest, and serves the `web/` folder as a static site.

Every new push to `master` triggers a fresh deploy with up-to-date weapon data.

## Web UI

A browser UI to explore the data — search/filter weapons and click one to see
every perk it can roll:

```bash
node index.js          # 1. generate weapons.json (if not done yet)
node build-web-data.js # 2. build web/data.json (compact, deduped perks ~20 MB)
node serve.js          # 3. serve it
```

Then open <http://localhost:8080>. (Equivalent npm scripts: `npm start`,
`npm run build-web`, `npm run serve`.)

Features: live search, filter by weapon type / tier / element, and a detail
panel themed to the weapon's damage element. Shows each perk column (intrinsic,
barrel, mag, both trait columns) with perk icons + descriptions, the weapon
screenshot as a blurred hero backdrop, and the season/release watermark.
Random-roll columns are badged, and perks that no longer drop are dimmed.
Weapon mods/masterwork sockets are excluded (pass `--all-sockets` to
`index.js` if you ever want everything).

## Output shape

```jsonc
{
  "generatedAt": "...",
  "manifestVersion": "...",
  "weaponCount": 1837,
  "weapons": [
    {
      "hash": 123,
      "name": "1000 Yard Stare",
      "itemType": "Sniper Rifle",
      "tier": "Legendary",
      "damageType": "Void",
      "ammoType": 1,
      "icon": "https://www.bungie.net/...",
      "screenshot": "https://www.bungie.net/...",
      "sockets": [
        {
          "socketIndex": 1,
          "category": "WEAPON PERKS",
          "randomized": true,
          "perks": [
            {
              "hash": 456,
              "name": "Fluted Barrel",
              "description": "...",
              "itemType": "Barrel",
              "plugCategory": "barrels",
              "icon": "https://www.bungie.net/...",
              "canRoll": true,
              "sources": ["random"]
            }
          ]
        }
      ]
    }
  ]
}
```

- `sockets` covers the intrinsic frame, every perk column (barrel, mag, the two
  trait columns), and mods/masterwork. Cosmetic sockets are skipped unless you
  pass `--all-sockets`.
- `randomized: true` means the column is a real random-roll pool (god-roll data).
- `canRoll` is `false` for perks Bungie has retired from the current loot pool.
- `sources` shows where a perk came from: `default`, `reusable`, `curated`, or
  `random`.
