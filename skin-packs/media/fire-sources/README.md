# Original firing source tracks

These 14 M4A files retain the complete original AAC streams from downloaded Riot Games weapon preview MP4s. Remuxing copied the compressed audio without encoding. Decoded PCM SHA-256 equality with each source MP4 was verified.

The source URLs, video hashes, retained-track hashes and PCM hashes are recorded in [fire-review.json](../../audit/fire-review.json). Exact single-shot ranges and processing settings are in [asset-review.json](../../asset-review.json). Ten ordinary weapon previews yield ten clips; the four ORA level-5 previews each yield five independent theme clips. The generated Vorbis files are written under `dist/skin-packs/` by `node prepare-offline.mjs`.

These are official preview recordings, not unpacked game sound files. Source MP4s remain in the ignored acquisition directory; rebuilding is offline and uses the retained complete audio tracks. Original game media is owned by Riot Games.
