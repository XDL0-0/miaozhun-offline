# English UI audit

The language selector is available in the lower-left offline toolbar. Chinese remains the default. The language is stored under `al-offline-language` and is included in existing settings backups. Switching reloads the application; the editor first commits its current input, saves its draft, reads the draft back for comparison, and flushes scene-library changes. A failed save keeps the current page open.

## Terminology and provenance

The dictionaries cover the hall, built-in drills, settings, controls, crosshair editor, weapon skins, training, results, replays, scene editor, dialogs, errors, tooltips and accessibility labels.

- Weapons, agents and map names were checked against Riot’s [arsenal](https://playvalorant.com/en-us/arsenal/), [agents](https://playvalorant.com/en-us/agents/) and [maps](https://playvalorant.com/en-us/maps/).
- Crosshair tabs use **Primary**, **Aim Down Sights** and **Sniper Scope**, matching [patch 5.04](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-5-04/).
- **The Range** follows [patch 9.02](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-902/). Ability and skin references are recorded in [the terminology audit](english-terminology-audit.json).
- All 142 minimap labels are copied from coordinate-matched English client records in [VALORANT-API](https://valorant-api.com/v1/maps?language=en-US). This is a third-party extraction, not a Riot-operated API. The corresponding Chinese records, map asset identities, coordinates, source hashes and Riot cross-checks are retained in [the callout audit](minimap-callouts-audit.json). Labels are mapped per map: the same Chinese label can mean B Rafters, B Tower or B Nest.
- Existing English skin names and ORA theme casing are preserved. ORA theme labels were not independently confirmed in a publisher-primary source; the update does not invent official replacements.
- VALORANT Workshop, Community Workshop, Target Drills and Scene Editor describe this application’s own features. They are editorial translations, not official Riot mode names. Descriptive scene labels are retained where an authored location is ambiguous.

Context matters: `零` means Cypher in agent names and 0 in a numeral helper; calendar weekday abbreviations are handled separately. Internal rank IDs resolve the source’s older Chinese rank aliases. `K/O` becomes KAY/O in English. Lockdown is Killjoy’s ability, while Detained describes its status effect. A generic flash waypoint is distinct from Breach’s Flashpoint.

## Implementation boundaries

`site/` remains the acquired source. `prepare-offline.mjs` applies compatibility patches and an AST-based localization pass to `dist/`. Translated expressions are parenthesized so minified `return"text"` and similar constructs keep their JavaScript meaning. Whole template expressions use numbered placeholders, allowing natural English word order without evaluating substitutions twice.

The language runtime loads before offline adaptation and the client. There is no translation observer scanning the game DOM. Existing offline adaptation also watches the trainer’s separate portal for unavailable cloud actions and local-backup notices; HUD text remains excluded from adaptation scans.

Serialized scene documents, hashes, rules, IDs, user names and replay contents are not translated. Known built-in scene names are localized only at scoped presentation boundaries. Arbitrary user text, including names that match a UI word, remains intact. Minimap labels are returned as presentation copies with their original coordinates.

`patches/locales/overrides.en.json` contains reviewed shared wording and context decisions. `minimap-callouts.en.json` is deliberately separate from the global string dictionary. `dist/localization-report.json` records actual source coverage and per-map callout counts. Builds reject missing translations, invalid English entries, conflicting unapproved values and changed placeholder sets.

## Validation

Run `node prepare-offline.mjs`, `node --test` and `node verify-offline.mjs`. The localization behavior tests execute transformed snippets from the retained client, including the settings view, editor save hook, calendar, difficulty parser, Vue display helper and result presentation. They cover storage restrictions, reload ordering, failed saves, templates, shader/protocol preservation, per-map labels and unchanged custom data.

Browser acceptance covers language persistence and Chinese return, the six settings categories and their subcontrols, skin selectors, the editor, immediate edit-and-switch preservation, imported built-in names, training entry, aim assistance, pause/TAB menus, a complete timed session, results and local replay. The native language option “简体中文” and user-authored names intentionally remain in their original language.
