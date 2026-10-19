# Original weapon environments

`originals/` retains the unchanged Radiance RGBE panoramas exported from the
local VALORANT installation. Names are their complete SHA-256 hashes. The source
asset paths, dimensions and hashes are recorded under `environments` in
`skin-packs/audit/weapon-model-sources.json`.

Run `node scripts/import-weapon-models.mjs` with the existing reviewed local
export directory to regenerate the weapon packages. The importer uses each
visible material's original `HDRI` parameter where present. Other visible
surfaces use the explicitly identified original weapon studio panorama
`Ares_HDRI_FirstPerson`. Hidden surfaces allocate no environment.

Runtime environments are gzip-compressed, little-endian RGBA binary16 data at
`/skin-packs/models/assets/<hash>.bin.gz`. RGB values contain linear HDR radiance;
alpha is one. No exposure adjustment, tone mapping or radiance clamp is baked
into these values. Panoramas larger than 1024 × 512 use area averaging in linear
space. Smaller environments retain their original exported dimensions, including
the one-pixel aspect discrepancy introduced by CUE4Parse's panorama conversion.
Gun body textures and geometry are unaffected by this environment size cap.

The audit records statistics both before conversion and after decoding the
runtime half floats. Source reflection strength, rotation and tint parameters
are retained for review. The runtime applies its own rendering and filtering.
