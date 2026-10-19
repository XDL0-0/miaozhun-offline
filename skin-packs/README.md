# Vandal / Phantom skin-pack catalog + ORA by OneTap

This branch extends `performance-improvements` with a **source-verified catalog and local-only, permission-aware media staging workflow**. No third-party original audio or kill-banner binaries are included, licensed, or embedded into the game by this change.

## Selection

The September 2026 VALSTATS report used 60,024 equipped-player inventories. Its top-ten tables include the default skin. Filtering each weapon's top ten to the orange **Exclusive** edition gives:

- **Vandal:** Prelude to Chaos, Kuronami, Primordium, Rogue, RGX 11z Pro.
- **Phantom:** Primordium, Ayakashi, Kuronami, Nocturnum, Mystbloom.
- **Additional user request:** ORA by OneTap (Ultra, not orange). Include Vandal, Phantom, Sheriff, Operator, and **all five** themes: base, watch, renegade, raja, ignition.

The full ordered top-ten lists and authoritative collection reference pages are recorded in [catalog.json](./catalog.json). These are *equipped usage* rankings, not universal popularity or purchase rankings.

## Ownership and distribution

Riot's current terms and third-party game/app policies do **not** grant blanket redistribution or in-game reuse rights for original skin effects merely because a project is noncommercial or its repository is private. See:

- https://www.riotgames.com/en/legal
- https://developer.riotgames.com/policies/general
- https://www.riotgames.com/en/terms-of-service

The source references in the catalog are provided so an authorized developer can identify specific assets. **Do not treat a wiki's audio download link as a license.** When permitted/created/original media files are available, place them into ignored `skin-packs/local/`; verify your rights before distributing or committing.

## Local asset layout

For each collection ID in `catalog.json`, supply the following files:

```text
skin-packs/local/<collection-id>/
  weapons/<weapon>/fire.ogg
  themes/<theme>/
    kill-1.ogg
    kill-2.ogg
    kill-3.ogg
    kill-4.ogg
    kill-5.ogg
    successive.ogg
    emblem.png
    frame.png
    ring.png
    pip.png
    headshot.png
```

For ordinary Exclusive collections, theme is `default`. For ORA, each of the five themes above has independent kill audio and banner layers; weapon gunfire is initially modeled as one file per weapon, so **theme-specific ORA gunfire requires a later runtime extension**, not a false claim of parity.

The banner layer shape follows the existing `DVK7uRSu.js` data model (`frame`, `ring`, `emblem`, `pip`, `headshot`). This is a source organization format rather than an assertion that extracted Riot assets have those exact separate files.

## Commands

Run with system Node.js on Ubuntu or Windows:

```bash
node scripts/skin-packs.mjs --scaffold
node scripts/skin-packs.mjs --audit
node scripts/skin-packs.mjs --stage
node --test tests/skin-packs.test.mjs
```

- `--scaffold` creates ignored folder structure and a `REQUIRED_ASSETS.txt` inventory.
- `--audit` reports missing and present files without downloading anything.
- `--stage` copies **complete, locally supplied** collection folders into `dist/skin-packs/`, generating a manifest of staged packs. If a collection is incomplete, it is skipped rather than falsely reported as available.
- The tools perform **no online download, asset extraction or rights bypass**. Staging does not modify the original offline client, install a theme-selection menu or activate skins; those tasks remain separate integration work once cleared media is supplied.

## Integration pointers

- `dist/js/CymPR-fm.js`: `fireKit`, `hitKit`, `killKit`, `playFire`, `playKill`.
- `dist/js/DVK7uRSu.js`: existing three kill-banner themes and composite layers.
- `prepare-offline.mjs`: reproducible build entry point; any future client patches should go in `patches/`, not be applied directly to only `dist/`.

## Data sources

- https://reports.valstats.site/skin-popularity-v2/
- https://wiki.playvalorant.com/en-us/Weapon_Skins
- https://wiki.playvalorant.com/en-us/Kill_Banners
- See per-collection `referencePage` fields in `catalog.json`.
