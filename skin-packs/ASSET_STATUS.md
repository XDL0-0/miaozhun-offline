# Imported media status — 2026-10-19

Source: VALORANT Wiki's linked public Google Drive **Cosmetic SFX files** folder:
https://drive.google.com/drive/folders/1PkJyMg_Kj7-rJHoptMudeT5VorBwM8jG

This branch currently stores **79 original MP3 files (13,425,505 bytes)** in `skin-packs/media/`, verified by reading the branch's recursive Git tree.

| Collection | Original MP3 files |
|---|---:|
| ORA by OneTap (Base, Watch, RENEGADE, RAJA, Ignition) | 30 |
| Prelude to Chaos | 6 |
| Kuronami | 6 |
| Primordium | 6 |
| Rogue | 6 |
| RGX 11z Pro | 6 |
| Ayakashi (Kill 1–6 + Successive) | 7 |
| Nocturnum | 6 |
| Mystbloom | 6 |
| **Total** | **79** |

Files were copied as original MP3, without resampling or editing. They are categorized under `skin-packs/media/<collection>/kill/<theme>/`.

## Still NOT completed

- Gunfire / firing sound samples for each weapon and theme (not found in this source folder's selected kill-SFX inventory).
- Kill-banner images / icon textures (not downloaded).
- Browser runtime integration: existing `fireKit`/`killKit`/`killbanner` selectors do not yet load `skin-packs/media`.
- Updating `scripts/skin-packs.mjs` staging format: earlier scaffold expects local OGG+PNG input, whereas the directly sourced media here are MP3.
- Game testing and UI audition.

Original game media rights must be handled under the project owner's reported official authorization; this file does not represent independent verification of rights.
