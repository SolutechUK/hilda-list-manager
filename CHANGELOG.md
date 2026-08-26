# Changelog

## 0.4.0-beta.3

- Sorted `manifest.json` keys in Hassfest-required order.


## 0.4.0-beta.2

Validation fix.

- Added `http` to integration dependencies because H.I.L.D.A registers a static frontend path through Home Assistant's HTTP component.
- Repository topics are now expected to be configured on GitHub for HACS validation.


## 0.4.0-beta.1

First community beta.

### Included
- H.I.L.D.A-branded Home Assistant integration and custom dashboard card
- Visual card editor
- Existing `todo.*` list support
- H.I.L.D.A-managed persistent To-do list creation
- Rename and safe-delete H.I.L.D.A-managed lists
- Safe empty-card fallback
- Multiple list switching with persistent selection
- Add, complete, uncomplete, Mark Done and Clear
- Per-list images and searchable Home Assistant icon selectors
- Manual Send List to `notify.*` or `rest_command.*`
- Automatic Send on Zone for person enter/leave events
- Configurable zone cooldown
- External `todo.*` entities are not deleted/pruned by the integration

### Beta notes
- The dashboard JavaScript resource still needs to be added manually after HACS installation.
- Zone rules should be tested with non-critical destinations before relying on them.
