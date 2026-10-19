# Skin media status — 2026-10-19

Downloaded, reviewed, staged and integrated describe different steps. The original wiki inventory contains screenshots, icons and non-firing sounds; those do not become playable effects merely by being downloaded. The follow-up firing acquisition and its acceptance are recorded separately below.

| Step | Evidence / current result |
|---|---|
| Original downloaded wiki inventory | `skin-packs/local/wiki-downloads/`: 1,100 files — 978 PNG, 10 GIF and 112 MP3. This ignored acquisition directory is unnecessary for rebuilding. |
| Downloaded firing sources | Fourteen used official Riot CDN MP4 previews were downloaded into ignored `local/fire-research/`. Their complete AAC streams were copied without encoding into fourteen tracked M4A files; full decoded PCM equality was verified. Extra research videos are excluded from the runtime inputs. |
| Reviewed build inputs | `media/` and `asset-review.json`: 79 kill MP3, 37 composite previews, 93 native-size banner-layer PNGs and 30 reviewed single-shot ranges in fourteen original AAC tracks. Source URLs, hashes, geometry, exact ranges and frame evidence are retained. |
| Built runtime media | Schema-2 `dist/skin-packs/index.json`: 109 Vorbis OGG (30 firing + 79 kill recordings), 37 composite previews and 89 deduplicated PNG layers used by all 37 gameplay banner variants. Ayakashi samples the real flame fragments from four original transparent images. Required weapon/theme fire coverage is **30 / 30**. |
| Client integration | Versioned client patches provide per-gun selection, audition, asynchronous preload, decoded-cache playback and native fallback. Layered banners reuse the native HUD's radial pip placement and animation. Regression tests exercise all 37 variants through that actual HUD for kills 1–5, 6, 7 and 10. |
| Browser acceptance | All 30 gun/skin/theme selections reached ready state and started fire audition through the settings UI. No console warning or error occurred in that check. The previous theme, kill-audition and training-load checks remain recorded separately. |
| Remaining source limitations | Firing clips are recordings extracted from official previews, not unpacked raw game sounds. Some late reverberation is shortened before the next shot; Operator retains its bolt cycle. Banner PNG layers restore radial kill states; original Unreal shader/VFX animation is not reproduced. |

## Reviewed coverage

| Collection | Kill MP3 | Composite banners | Integrated firing combinations | Missing fire |
|---|---:|---:|---:|---:|
| Prelude to Chaos | 6 | 4 | 1 | 0 |
| Kuronami | 6 | 4 | 2 | 0 |
| Primordium | 6 | 4 | 2 | 0 |
| Rogue | 6 | 4 | 1 | 0 |
| RGX 11z Pro | 6 | 4 | 1 | 0 |
| Ayakashi | 7 | 4 | 1 | 0 |
| Nocturnum | 6 | 4 | 1 | 0 |
| Mystbloom | 6 | 4 | 1 | 0 |
| ORA by OneTap, all five themes | 30 | 5 | 20 | 0 |
| **Total** | **79** | **37** | **30** | **0** |

Each theme includes kill clips 1–5 and one Successive recording. Ayakashi additionally includes kill 6. ORA's Base, Watch, RENEGADE, RAJA and Ignition are selectable for Vandal, Phantom, Sheriff and Operator. Each of its twenty firing combinations has its own reviewed source range and distinct generated audio bytes. A Base or other weapon sample is never substituted for another theme.

The 79 retained kill clips duplicate the corresponding wiki download's decoded audio; they are **79 unique kill clips**, not 158. The other 33 downloaded MP3s comprise 32 inspect clips and one finisher clip. They were excluded from firing. The new 30 firing samples come from separate official gameplay previews, verified using actual models, muzzle/casing/recoil events and audio attacks. Preview HUDs are hidden, so ammo-count evidence is unavailable.

The 37 composite PNGs remain settings thumbnails. Gameplay uses separately acquired frame, ring, emblem, pip and headshot PNGs. Thirty-three variants use independent skin-colored pips. Ayakashi's four empty independent pip placeholders have been replaced by direct sampling of the real flame pixels in the retained original transparent composites. Their four source rectangles, sizes and matching colors are recorded in [ayakashi-flame-review.json](./audit/ayakashi-flame-review.json); generic white markers are no longer active. All images decode before readiness and drawing reads cached images only. Source files, hashes, variant/color matching and placement are recorded in [banner-layer-review.json](./audit/banner-layer-review.json).

## Build and verification

- Rebuild with `node prepare-offline.mjs`; start on Ubuntu Linux with `node server.mjs`. Rebuilding requires Node.js and `ffmpeg` on `PATH`, with no network download. Original AAC source tracks, reviewed ranges, constant gains and 20 ms tail fades are retained in the repository.
- `node scripts/skin-packs.mjs --audit` checks reviewed source presence, hashes and missing capabilities. `--stage` runs the schema-2 builder; neither command alone claims browser acceptance.
- [build-validation.json](./audit/build-validation.json) records the earlier composite-only build: 109 valid Vorbis outputs, 37 transparent 300 × 300 PNGs and byte-identical repeated builds across 147 skin output files including the manifest.
- [fire-output-validation.json](./audit/fire-output-validation.json) records all 30 firing codecs, durations, levels and distinct hashes. The decoded peaks remain below clipping. Tests independently compare output PCM with the retained source windows before the tail fade, with correlation above 0.98.
- Earlier firing acceptance: `node --test` recorded **90 passed, 0 failed, 0 skipped**; `node verify-offline.mjs` recorded **1,974 resources, 62 scenes, 6 maps, zero required missing**. The two previously optional Outlaw equip resources remain absent. These counts precede the UI localization and banner-layer fix.
- [fire-browser-validation.json](./audit/fire-browser-validation.json) records all thirty ready/audition-start checks. Prior gun selections were restored. [Runtime validation](./audit/runtime-validation.json) distinguishes these checks from manual live training acceptance.
- [banner-progression-validation.json](./audit/banner-progression-validation.json) records the earlier radial-artwork fix: **118 tests passed**, 185 distinct browser-rendered kill states, 2,062 resources, and its temporary Ayakashi generic-marker fallback. Its screenshots are retained as historical evidence.
- [banner-lifecycle-validation.json](./audit/banner-lifecycle-validation.json) records the current follow-up: **120 tests passed, 0 failed, 0 skipped**; **555 early-timestamp kill recoveries and 555 complete clears** through the actual HUD at DPR 1 / 1.25 / 2; four real Ayakashi flame sprites; 185 distinct artwork states; **2,065 resources, zero required missing**. [Current browser screenshot](./audit/banner-lifecycle-review.png) retains the visual evidence.

The in-app browser previously lost pointer lock during manual shooting and paused, so manual live kill playback remains unverified. This follow-up did not repeat that test. The actual patched audio and HUD functions passed automated tests, including first kill with native banner disabled, pause, expiry and round reset. The new firing tests additionally build and decode all thirty real source excerpts and exercise their runtime selection/cache path.

Live kill playback follows the original 1–5 cycle and wraps after five. Successive recordings and Ayakashi kill 6 are available for audition only. Playback events read predecoded caches; missing or failed media retains the original effect.

## Source records

Source review: [asset-review.json](./asset-review.json), [fire-review.json](./audit/fire-review.json), [firing evidence](./audit/fire-evidence/), [original wiki audit](./audit/source-media-audit.json), and [banner contact sheet](./audit/banners-contact-sheet.jpg). The community [VALORANT-API index](https://valorant-api.com/) supplied discovery pointers; actual firing media was downloaded from Riot's CDN, with per-file URLs and hashes retained in the review. ORA theme identity was cross-checked with the labeled [collection previews](https://wiki.playvalorant.com/en-us/ORA_by_OneTap_Collection/Previews). Kill-audio provenance also references the wiki-linked [Cosmetic SFX Drive folder](https://drive.google.com/drive/folders/1PkJyMg_Kj7-rJHoptMudeT5VorBwM8jG).

Original game media remains Riot Games property. The project owner reports official authorization for this use; this status report records technical evidence and provenance.
