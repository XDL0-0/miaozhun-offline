# Champions annual collections

The offline skin menu includes all annual Champions collections available in the retained VALORANT 13.08 source installation.

| Year | Rifle | Melee |
|---|---|---|
| 2021 | Vandal | Karambit |
| 2022 | Phantom | Butterfly Knife |
| 2023 | Vandal | Kunai |
| 2024 | Phantom | Blade |
| 2025 | Vandal | Butterfly Knife |
| 2026 | Phantom, attacking Snake / defending Dragon | Fan, attacking Snake / defending Dragon |

Open Settings → Audio → Weapon Skins & Kill Feedback. Select the rifle or Melee (Knife), then its Champions collection. The 2026 theme changes the source model/material package as well as the kill banner. Each weapon stores its appearance separately. Switch to melee during training to see the selected knife; the existing Y inspection control remains in use.

All model geometry, original-resolution surface textures, original retargeted animations, supported firing particles, gunfire/kill audio and banner images are local. The delivered app needs neither the original game installation nor an accelerator. Skin changes reuse the existing renderer and animation clock. Optional failed skin loads return to the native appearance.

The complete catalogue contains 15 collections, 26 weapon combinations and four explicit 2026 model-theme packages. The 2026 default catalogue entries alias their defending packages; they do not duplicate another weapon. The importer binds upgraded materials by original Unreal mesh slot names because GLB exports deduplicate and reorder their material arrays. Original slot/index evidence and every resulting primitive assignment are retained in [the material audit](../skin-packs/audit/champions-material-slot-review.json).

Kill feedback follows the trainer's existing five-kill cycle. The early Champions banners use original radial layers. The later banners select predecoded, count-specific images. Their sixth image is retained in the source pack; sixth kill audio for Champions 2026 can be auditioned separately. Image drawing and audio playback perform no fetching or decoding during a kill.

Some original Unreal procedural materials are approximated on the existing weapon triangles. Unsupported cube projections, noise-only cards and procedural light volumes are omitted with recorded reasons, so they cannot become opaque planes in front of the player. The 2026 banner images reproduce the opened UI state from original textures and layout endpoints; they do not reproduce the original Unreal transition animation. The 2022 gunshot uses the final shot and tail of an official preview burst, with a small amount of preceding reverberation at its onset.

Acquisition URLs, hashes, reviewed audio intervals and original banner recipes are recorded in [the media audit](../skin-packs/audit/champions-media-review.json) and [the banner recipes](../skin-packs/audit/champions-banner-recipes.json). `node scripts/rebuild-champions-banners.mjs` reproduces the twelve 2026 source frames from retained local PNGs, without downloading anything. The regular `node prepare-offline.mjs` build uses only retained reviewed inputs and requires Node.js and FFmpeg.

Historical Champions acceptance, before the later material/resource changes: 154 tests passed with no failures or skips. The shipped renderer passed 28 appearance packages and 322 action/handedness states, including rapid selection recovery, native fallback and return to the baseline GPU resource count. Twenty-one firearm appearances passed 84 burst/ADS sequences across 6,132 frames. The offline verifier checked 2,810 resources, 62 scenes and six maps with no required missing assets or failures. [Detailed validation](../skin-packs/audit/champions-runtime-validation.json) and [actual rendered comparisons](../skin-packs/audit/champions-offline-review.png) retain that evidence. These checks are not an FPS benchmark. See [the subsequent rendering changes and validation limits](weapon-rendering.md) for the current material pipeline.
