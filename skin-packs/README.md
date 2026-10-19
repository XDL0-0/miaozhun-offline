# Vandal / Phantom skin packs + ORA by OneTap

The offline client builds skin effects from reviewed originals in `skin-packs/media/`. The build supplies **30 genuine single-shot gunfire clips, 79 kill-audio clips and 37 layered kill-banner variants** across nine collections and thirteen themes. The 37 composite previews are retained for settings. The 30 firing mappings cover ten ordinary skin/weapon pairs and all twenty ORA weapon/theme pairs. Available effects work independently, with native fallback if a resource fails.

## Selection

The September 2026 VALSTATS report recorded 60,024 equipped-player inventories. Its top-ten tables include the default skin. Filtering each weapon's top ten to orange **Exclusive** edition gives:

- **Vandal:** Prelude to Chaos, Kuronami, Primordium, Rogue, RGX 11z Pro.
- **Phantom:** Primordium, Ayakashi, Kuronami, Nocturnum, Mystbloom.
- **Additional request:** ORA by OneTap (Ultra), with Vandal, Phantom, Sheriff and Operator. Each gun supports **Base, Watch, RENEGADE, RAJA and Ignition** selections.

The ordered tables and collection reference pages remain in [catalog.json](./catalog.json). These measure equipped usage. Shared collection kill effects are reused for each eligible weapon; ORA's five themes retain separate media.

## Build and run on Linux

Install Node.js and ensure `ffmpeg` is on `PATH`, then run from the repository root:

```bash
node prepare-offline.mjs
node server.mjs
```

Open [the local client](http://127.0.0.1:18746/aim). The server listens only on `127.0.0.1:18746`. The Windows launcher remains available; rebuilding on Windows also requires `ffmpeg` on `PATH` and can use `.\runtime\node.exe` in place of `node`.

`prepare-offline.mjs` applies the versioned patches and calls [build-skin-packs.mjs](../scripts/build-skin-packs.mjs). The builder checks reviewed SHA-256 hashes, converts MP3 and reviewed AAC excerpts to Vorbis OGG, normalizes composite previews to 300 × 300, copies layered PNGs at their original pixel dimensions, and writes the **schema-2** `dist/skin-packs/index.json`. Identical layers share a content-addressed URL. It rebuilds from repository media and [asset-review.json](./asset-review.json); `skin-packs/local/wiki-downloads/` and a new download are unnecessary. Rebuilding replaces generated skin output.

## Settings and playback

In **参数设置 → 音频 → 枪械皮肤与击杀反馈**, select a gun, skin, theme and banner style. Selections and the separate fire, kill and banner switches are stored per gun in the browser. Ordinary collections offer four banner variants; ORA offers one variant per theme. The panel reports missing, loading, failed and ready assets, shows a banner preview, and provides fire, individual and 1–5 kill auditions, an original-effect option, stop and reload controls.

Audio and images load asynchronously. Audio is decoded before use; firing and kill events only read the decoded cache. An unavailable or failed asset falls back to the current original effect. All 30 reviewed firing samples are available after preload; their audition controls follow the actual loading state. Missing or failed resources still disable their audition and use the native effect during play.

Live kills follow the client's existing **1–5 cyclic sound sequence**: kill 6 uses clip 1, kill 7 uses clip 2. `successive.ogg` is an original multi-kill recording available for audition; Ayakashi's sixth clip is also audition-only. Neither replaces the live 1–5 sequence.

Gameplay uses separate frame, ring, emblem, pip and headshot layers. The existing client HUD places pips around the emblem for kills 1–5, including opposite positions for two kills, then repeats that cycle. Ayakashi now samples the actual colored flame pixels from its four retained transparent composite originals using a reviewed source rectangle and logical size. Its independent pip downloads were empty placeholders; generic white chevrons are no longer used for current packs. Other variants use their source-colored pips. Every image is decoded during preload and reused during drawing. A failed required layer falls back to the native banner instead of displaying a static composite. The legacy composite and explicit generic-marker renderers remain compatible with older schema-2 packs.

[banner-layer-review.json](./audit/banner-layer-review.json) records all 37 variant mappings, source geometry and the [Kingdom Archives](https://kingdomarchive.com/killbanners) source pages. [ayakashi-flame-review.json](./audit/ayakashi-flame-review.json) records the four original composite sources and exact flame rectangles. The runtime ships 89 unique PNG layers, with source sprites preserving original bytes. Existing variant IDs remain stable for saved selections. The rendering restores radial kill states with the native client animation; original Unreal shader/VFX animation is outside this implementation.

The HUD retains a kill whose event time is briefly ahead of its display clock, then advances the animation when the clock catches up. Expiry resets the canvas transform before clearing in backing-pixel coordinates. This fixes intermittent missing animations and right-bottom-only clears after skipped fade frames. Browser acceptance exercises both behaviors for all variants at DPR 1, 1.25 and 2.

## Audit and staging

```bash
node scripts/skin-packs.mjs --audit
node scripts/skin-packs.mjs --stage
node --test tests/skin-packs.test.mjs tests/skin-media-build.test.mjs
```

- `--audit` checks actual reviewed input paths and hashes. It distinguishes absent review mappings, absent files and changed files, and lists each missing weapon/theme capability without inventing source filenames. It does not verify browser integration.
- `--stage` uses the same schema-2 builder as `prepare-offline.mjs`. It retains every usable clip and banner in partially supplied themes and explicitly records missing assets. Staging alone is a file build, separate from installing the client patches and checking playback.
- `--scaffold` remains a compatibility command that prints the review inventory. It creates no legacy local folders or fake layer requirements.

The manifest's `sourceStatus` and `resourceStatus` describe media coverage. They do not certify that the browser has decoded a file or that a training session has exercised it. See [ASSET_STATUS.md](./ASSET_STATUS.md) for evidence and remaining gaps.

## Provenance

[asset-review.json](./asset-review.json) records original paths, source URLs, hashes, audio roles and banner variants. [fire-review.json](./audit/fire-review.json) adds all 30 firing time ranges, source identities and before/shot/after evidence. Fourteen complete original AAC tracks are retained in `media/fire-sources/`: copied from downloaded Riot CDN MP4 previews without encoding and checked for decoded PCM equality. Building needs these tracked audio sources, not the large ignored videos.

Gunfire is extracted from official gameplay previews, rather than unpacked raw game sound files. Each range contains one shot and excludes equip, reload, kill and finisher events. Long reverberation tails are shortened before the next tap; Operator retains its natural bolt cycle. Exact time ranges, constant peak gains (target 0.7) and 20 ms tail fades are applied reproducibly by the builder. The original sources remain unchanged. The [audit folder](./audit/) contains inventory and visual-review evidence. Original game media remains owned by Riot Games; use follows the project owner's reported official authorization. Source attribution does not change ownership.

Ranking source: [VALSTATS](https://reports.valstats.site/skin-popularity-v2/). Collection and kill-banner references: [VALORANT Wiki](https://wiki.playvalorant.com/en-us/Weapon_Skins), [Kill Banners](https://wiki.playvalorant.com/en-us/Kill_Banners). Per-file sources are recorded in the review data.
