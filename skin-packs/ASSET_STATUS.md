# Skin media status — 2026-10-19

Downloaded, reviewed, staged and integrated describe different steps. The source inventory contains many screenshots, icons and non-firing sounds; those do not become playable skin effects merely by being downloaded.

| Step | Evidence / current result |
|---|---|
| Downloaded inventory | `skin-packs/local/wiki-downloads/`: 1,100 files — 978 PNG, 10 GIF and 112 MP3. This ignored acquisition directory is unnecessary for rebuilding. |
| Reviewed build inputs | `skin-packs/media/` plus `asset-review.json`: 79 kill MP3 and 37 transparent composite banner PNG, with source URLs and SHA-256 hashes. |
| Staged runtime media | Schema-2 `dist/skin-packs/index.json`: 79 Vorbis OGG and 37 transparent 300 × 300 PNG. All nine collections and thirteen themes are retained with explicit missing entries. |
| Client integration | Settings selection, per-gun persistence, audition, asynchronous preload, decoded-cache playback, native fallback and composite HUD bridges are implemented in versioned patches. All 86 tests passed, including the actual client audio, round readiness and Kill Banner functions. Browser settings, theme switching, Watch 1–5 audition and training-scene loading were checked. |
| Still missing | Authenticated standalone firing sounds: **0 / 30 weapon/theme combinations supplied**. All firing uses the current original client effect. Separate banner animation layers were not supplied. |

## Reviewed coverage

| Collection | Kill MP3 | Composite banners | Missing fire combinations |
|---|---:|---:|---:|
| Prelude to Chaos | 6 | 4 | 1 |
| Kuronami | 6 | 4 | 2 |
| Primordium | 6 | 4 | 2 |
| Rogue | 6 | 4 | 1 |
| RGX 11z Pro | 6 | 4 | 1 |
| Ayakashi | 7 | 4 | 1 |
| Nocturnum | 6 | 4 | 1 |
| Mystbloom | 6 | 4 | 1 |
| ORA by OneTap, all five themes | 30 | 5 | 20 |
| **Total** | **79** | **37** | **30** |

Each theme includes kill clips 1–5 and one Successive recording. Ayakashi additionally includes kill 6. ORA's Base, Watch, RENEGADE, RAJA and Ignition are selectable for all four requested guns: Vandal, Phantom, Sheriff and Operator. Its 20 fire mappings are independently missing; another theme or weapon's sound is not substituted.

The 79 tracked kill clips duplicate the corresponding wiki download's decoded audio; they are **79 unique kill clips**, not 158. The other 33 downloaded MP3s comprise 32 inspect clips and one finisher clip. None is a confirmed standalone firing sample. Downloaded weapon screenshots, page icons and GIFs are also excluded from the skin runtime.

The 37 reviewed PNGs are complete transparent banner composites: four variants for each of eight ordinary collections and one for each ORA theme. They cannot establish separate frame, ring, emblem, pip or headshot layers. The HUD adds count/headshot feedback to the composite.

## Build and verification

- Build from repository inputs with `node prepare-offline.mjs`; start on Linux with `node server.mjs`. Rebuilding requires Node.js and `ffmpeg` on `PATH`, and needs no network download.
- `node scripts/skin-packs.mjs --audit` reports reviewed source presence, SHA-256 mismatches and real missing capabilities. `--stage` runs the schema-2 builder; neither command claims browser acceptance.
- [build-validation.json](./audit/build-validation.json) records 79 valid Vorbis outputs, 37 transparent 300 × 300 PNGs and byte-identical repeated builds across 117 output files including the manifest.
- Linux local serving and offline-resource verification have passed. Runtime validation is recorded separately in [runtime-validation.json](./audit/runtime-validation.json). The settings panel shows each asset's live loading/readiness/failure state.

The in-app browser lost pointer lock during manual shooting, so live manual kill playback was not accepted as browser evidence. The actual patched playback and HUD functions passed automated tests, including the first kill with the native banner disabled, pause, expiry and round reset. Firing-switch tests use synthetic media fixtures because no real skin firing sample is supplied.

Live kill playback follows the original 1–5 cycle and wraps after five. Successive recordings and Ayakashi kill 6 are available for audition only. Playback events read predecoded caches; missing or failed media retains the original effect.

## Source records

Source review: [asset-review.json](./asset-review.json), [source-media-audit.json](./audit/source-media-audit.json), and [banner contact sheet](./audit/banners-contact-sheet.jpg). Kill-audio provenance also references the wiki-linked [Cosmetic SFX Drive folder](https://drive.google.com/drive/folders/1PkJyMg_Kj7-rJHoptMudeT5VorBwM8jG).

Original game media remains Riot Games property. The project owner reports official authorization for this use; this status report records technical evidence and provenance.
