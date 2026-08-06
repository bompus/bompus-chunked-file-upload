# Changelog

All notable changes to [bompus-chunked-file-upload](https://github.com/bompus/bompus-chunked-file-upload) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-08-06

### Breaking

- **Headless-first engine.** `BompusFileUpload(options)` no longer owns label/progress DOM.
- **Removed `hooks` bag** (`setText`, `fileSelected`, `beforeChunkSend`, `progressStart`/`End`, `uploadComplete`, download-link-class hooks).
- Prefer **`formData`**, **`downloadUrl`**, **`beforeUpload`**, optional **`beforeRequest`**.
- Lifecycle via **`upload(file?)` Promise** + events: `busy` | `idle` | `progress` | `complete` | `error`.
- Opt-in UI: **`BompusFileUpload.mountDefaultUi(up, opts)`** (progress, label, remove, `linkNewUploads`, `extraActions`, `imageExts`, `setStatus`/`clearStatus`).
- Abort / stale generation **`reject(BompusFileUpload.ABORTED)`** (never silent fulfill).
- Prefer CDN tag **`@2.1.0`** (`@2.0.0` may be unreliable on jsDelivr).

### Retained from 2.0.0

- No jQuery / no async.js; XHR chunked upload; fail-fast parallel chunks; identity `SKIP_UPLOAD` / `ABORTED`; retry + full-size fallback; XSS-safer UI text; extension validation; xhr prune; ETA guards.

## [2.0.0] - 2026-08-06

### Breaking

- Renamed from `bompus-jquery-file-upload`; vanilla JS; `BompusFileUpload` global (no `$.bompusFileUpload`).

### Added / Fixed

- Parallel chunked uploads without async.js; Promise `fileSelected`; abort generation; public abort helpers; bugfixes retained into 2.1.0.

## [1.0.9] - 2024-08-20

### Fixed

- Read `success` from the top-level JSON response before unwrapping `data`

[Unreleased]: https://github.com/bompus/bompus-chunked-file-upload/compare/2.1.0...HEAD
[2.1.0]: https://github.com/bompus/bompus-chunked-file-upload/compare/2.0.0...2.1.0
[2.0.0]: https://github.com/bompus/bompus-chunked-file-upload/releases/tag/2.0.0
[1.0.9]: https://github.com/bompus/bompus-jquery-file-upload/compare/1.0.8...1.0.9
