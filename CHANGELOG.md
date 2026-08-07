# Changelog

## [4.0.1] — 2026-08-07

- Removed unused `_inputLocked`; file input enablement is `readonly || busy` only

## [4.0.0] — 2026-08-07

### Breaking

- **No auto-upload** on `<input type=file> change`. Call `upload(file)` or `BompusFileUpload.bindInput(input, onPick)`.
- **`BompusFileUpload.mount(options)`** is the public entry (UI always mounted). Constructor throws. Removed `mountDefaultUi`, `beforeUpload`, `SKIP_UPLOAD`, `parallelLimit`, `setUploadFormData` / `clearUploadFormData`, `beforeRequest`.
- Per-upload session fields: `upload(file, { data })` (merged on every request including `combineChunks`).
- Prefer explicit `elements: { fileInput, hiddenInput, infoText }` — no page-wide `fieldName` scavenger. Optional root Element scopes `data-bfu-*` lookup.

### Added

- `BompusFileUpload.bindInput(input, onPick)` — pick helper with no upload semantics
- `decorateLabel(labelRoot, ctx)` mount option (replace `extraActions` / `extraActionsBeforeRemove`)
- `change` event when the hidden filename is set or cleared
- `maxFileMB` (rejects oversized files; `maxFullSizeMB` alias)

### Changed

- Chunk sends are **sequential** only (init → send×N → combine); transport full-fallback still uses the same 3-step protocol
- Form busy during **transfer** automatically; use `holdFormBusy` for preprocess dialogs
- Kept: `trackFormBusy`, `formBusyCount`, `holdFormBusy`, `el.bfu` registry, `.bfu-*` CSS classes, identity `ABORTED` / `TIMEOUT` / `TRANSPORT_ERROR` for reject handling

## [3.0.3] — 2026-08-06

- Session `setUploadFormData` / `extraActionsBeforeRemove` (superseded by 4.0)
