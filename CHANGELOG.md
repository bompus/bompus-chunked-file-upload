# Changelog

All notable changes to [bompus-chunked-file-upload](https://github.com/bompus/bompus-chunked-file-upload) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-08-06

### Breaking

- Renamed project from `bompus-jquery-file-upload` → **`bompus-chunked-file-upload`**
- **Removed jQuery** (and async.js). Library is vanilla JS on modern browsers (Promise / async-await, `Blob`/`File.slice`, `FormData`, XHR upload progress)
- Global API: **`BompusFileUpload(options)`** (was `$.bompusFileUpload`)
- Asset names: `bompus-chunked-file-upload.js` / `.css`
- `hooks.setText(fromInit, dlEl, removeEl)` receives **HTMLElement**s (not jQuery)
- `o.elements.*` are **HTMLElement**s (or `null`)
- `hooks.fileSelected` is **Promise-based**; skip only via **`BompusFileUpload.SKIP_UPLOAD`** (identity — duck-typed `{ skipUpload: true }` is ignored)
- Abort rejects **`BompusFileUpload.ABORTED`**
- `upload_file()` returns a Promise that settles on success / error / abort

### Added

- Public `abortPendingUploads()`, `releaseUploadControls()`
- Fail-fast `mapLimit` concurrency helper
- Upload generation tracking so abort does not count as success

### Fixed

- Chunk retry used wrong `method` reference (retries often never ran)
- Parallel chunk failure aborts siblings; abort no longer continues upload/combine
- Abort path does not race away a caller’s `setError` message
- XSS-safer error / link / progress label text
- `parallelLimit < 1` no longer skips workers; progress ETA guards; prune finished XHRs
- `progressStart` / `progressEnd` only on true in-progress transitions

### Changed

- Extension validation: alphanumeric ≤16 chars; image link class case-insensitive + `webp`
- Demo: `example.html` is vanilla-only; `index.php` crop demo keeps jQuery only for croppie/featherlight

## [1.0.9] - 2024-08-20

### Fixed

- Read `success` from the top-level JSON response before unwrapping `data`, so successful responses with a nested `data` object are not treated as failures

## [1.0.8] - 2024-08-20

### Changed

- Documented / pinned **async@2.6.4** in the library header
- Default `beforeChunkSend` example append commented out (no longer posts a sample field by default)
- Success handling: unwrap `data.data`, require `file_name`, and dispatch `initFile` / `sendChunk` / `combineChunks` via a switch
- Server may slugify/rename the file during `initFile`; client adopts `data.file_name`

### Fixed

- Progress fallback and combine completion only run for the matching chunk action

## [1.0.7] - 2023-10-20

### Fixed

- Readonly mode hides the file input again (`hide()` after a brief `show()` regression in 1.0.6)

## [1.0.6] - 2023-10-20

### Changed

- Readonly mode: show file input while displaying “No File Uploaded” (superseded by 1.0.7)

## [1.0.5] - 2023-10-20

### Changed

- Readonly path temporarily stopped hiding the file input (follow-ups in 1.0.6 / 1.0.7)

## [1.0.4] - 2019-10-03

### Changed

- Default `maxRetries` increased from 1 to 3; retry delay scales with attempt number
- Retries limited to chunked `sendChunk` failures (not every request type)
- CDN examples moved from cdnjs to jsDelivr
- Simplified demo / example page

### Fixed

- Full-upload size check compared bytes to `maxFullSizeMB` without converting MB → bytes
- Reset `method` to `"chunk"` when enabling upload / on new file selection

## [1.0.3] - 2019-10-03

### Added

- README CDN paths for the published assets

### Fixed

- Minor demo / CSS polish

## [1.0.2] - 2019-10-02

### Changed

- Point docs/deps at the GitHub project and jsDelivr (away from upload.bompus.com / cdnjs)

### Fixed

- Readonly upload UI: show “No File Uploaded” and hide the file input correctly
- Path / example cleanups

## [1.0.1] - 2019-10-01

### Changed

- Simplified example `upload.php` handler
- Minor CSS tweak; demo `index.php` updates

## [1.0.0] - 2019-10-01

### Added

- Initial public release: parallel chunked uploads via jQuery + async.js, progress UI, hooks, demo page, and example server handler

[Unreleased]: https://github.com/bompus/bompus-chunked-file-upload/compare/2.0.0...HEAD
[2.0.0]: https://github.com/bompus/bompus-chunked-file-upload/releases/tag/2.0.0
[1.0.9]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.8...1.0.9
[1.0.8]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.7...1.0.8
[1.0.7]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.6...1.0.7
[1.0.6]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.5...1.0.6
[1.0.5]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.4...1.0.5
[1.0.4]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.3...1.0.4
[1.0.3]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.2...1.0.3
[1.0.2]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.1...1.0.2
[1.0.1]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.0...1.0.1
[1.0.0]: https://github.com/bompus/bompus-jquery-file-upload/releases/tag/1.0.0
