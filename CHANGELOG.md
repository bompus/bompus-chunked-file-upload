# Changelog

## [3.0.0] — 2026-08-06

### Breaking

- Registry is **`el.bfu`** only (no `upload_1` / `upload_2` properties).
- Form busy via WeakMap: **`trackFormBusy(form, { onChange })`** once per form + **`formBusyCount(form)`** (no `.inProgress` sniff / per-field counters).
- Dropped `upload_file` / `abortPendingUploads`; chunk helpers are private.
- Sentinels are identity objects (`SKIP_UPLOAD`, `ABORTED`, **`TIMEOUT`**, **`TRANSPORT_ERROR`**) — compare with `===`.
- `mountDefaultUi` sets **`uploader.ui`** and always paints empty idle (enables file input).
- Zero-dependency package (vanilla JS only; no jQuery/Croppie/Featherlight in the library).

### Added

- `setReadonly(flag)`, `clearPendingSelection()`
- `upload(file?, { timeoutMs })` → reject `TIMEOUT` (one `error` emit; form stays busy until settle)
- `DEFAULT_IMAGE_EXTS` includes **avif**; `isImageExt(ext, exts?)`
- `up.unsupported` when browser APIs are missing
- `up.isBusy()`

### Fixed

- Reliable `error` emit for `beforeUpload` / validation (no silent file-input failures; no double-emit)
- Full-size fallback is in-attempt (no recursive `upload()` / timeout poison)
- Overlapping `upload()` while busy rejected with one `error`
- `mountDefaultUi` idempotent; `trackFormBusy` dedupes the same `onChange`
- `fieldName` escaped for `querySelector`
- `maxFullSizeMB` uses decimal MB (aligned with `chunkSizeMB`)
- Full-size fallback only on `TRANSPORT_ERROR` (not server / app messages)
- Pending chunk retries cancelled on abort / fail-fast / settle
- File input disabled during `beforeUpload` (no overlapping picks)

## [2.1.0] — 2026-08-06

Headless engine + optional `mountDefaultUi`. Prefer **3.0.0**.

## [2.0.0] — 2026-08-06

Vanilla port (historical). Prefer **3.0.0**.
