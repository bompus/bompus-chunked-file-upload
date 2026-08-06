# bompus-chunked-file-upload

Parallel chunked file uploads. **Vanilla JS — zero dependencies.**

**v3.0:** headless engine + optional `mountDefaultUi`, form busy tracking, `el.bfu` registry.

Formerly [`bompus-jquery-file-upload`](https://github.com/bompus/bompus-jquery-file-upload) (deprecated). Prefer CDN **`@3.0.1`**.

See [CHANGELOG.md](CHANGELOG.md).

## Requirements

Modern browser: Promise / async-await, `Blob`/`File.slice`, `FormData`, XHR upload progress.

## CDN

https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@3.0.1/bompus-chunked-file-upload.min.css  
https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@3.0.1/bompus-chunked-file-upload.min.js  
https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@3.0.1/no-photo.png

## Quick start

```html
<form id="post">
  <div data-bfu-text="upload-1"></div>
  <input data-bfu-file="upload-1" type="file" />
  <input data-bfu-hidden="upload-1" type="hidden" name="upload-1" value="" />
  <button type="submit">Save</button>
</form>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@3.0.1/bompus-chunked-file-upload.min.css" />
<script src="https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@3.0.1/bompus-chunked-file-upload.min.js"></script>
<script>
  var form = document.getElementById("post");
  var up = BompusFileUpload({
    postUrl: "/upload.php",
    fieldName: "upload-1",
    formData: { meta: "upload-1" },
    downloadUrl: function (encoded) { return "/files/" + encoded; }
  });
  BompusFileUpload.mountDefaultUi(up, { linkNewUploads: true });
  BompusFileUpload.trackFormBusy(form, {
    onChange: function (count) { /* show notice when count > 0 */ }
  });
</script>
```

## Engine options

| Option | Default | Description |
|--------|---------|-------------|
| `postUrl` | `"/path/to/upload.php"` | Upload endpoint |
| `fieldName` | `"bompus-file-1"` | Resolves `data-bfu-*` (CSS.escape used) |
| `formData` | — | Object or `() => object` merged into every request |
| `downloadUrl` | `(enc) => "/files/"+enc` | Build download URL |
| `beforeUpload` | — | async; `SKIP_UPLOAD` / throw / proceed |
| `beforeRequest` | — | `(formData) => void` after merge |
| `chunkSizeMB` | `0.98` | Decimal MB (`1_000_000` bytes) |
| `parallelLimit` | `5` | Max concurrent chunk POSTs |
| `maxFullSizeMB` | `20` | Full-POST fallback max (decimal MB) |
| `maxRetries` | `3` | Per-chunk retries |

## `beforeUpload` contract

| Outcome | Behavior |
|---------|----------|
| resolve / return | Validate and `upload()` current `this.file` |
| throw / reject | `error` event (UI may render) |
| `BompusFileUpload.SKIP_UPLOAD` | Stop; no upload |

## Events / methods

- Events: `busy`, `idle`, `progress`, `complete`, `error`
- `await up.upload(file?, { timeoutMs })` — success `{ fileName, duration, url }`
  - **`ABORTED`**: reject only (no `error` event) — user/stale abort
  - **`TIMEOUT`**: reject **and** one `error` event — `opts.timeoutMs` exceeded (form stays busy until settle)
  - Other failures: reject **and** one `error` event
  - Overlap while busy: reject with message + `error` event
- `up.abort()`, `up.reset()`, `up.clearPendingSelection()`, `up.setReadonly(bool)`
- `up.unsupported` — string if browser APIs missing (no construct-time event)
- Registry: `hiddenInput.bfu` / `fileInput.bfu` → uploader instance
- Sentinels: `SKIP_UPLOAD`, `ABORTED`, `TIMEOUT`, `TRANSPORT_ERROR` (identity `===` only; `.name` for debug)
- `up.isBusy()` — whether this uploader holds the busy lock
- Form busy: `trackFormBusy(form, { onChange })` once per form, `formBusyCount(form)`, `holdFormBusy(form)` → `release()`
- Form busy also held during `beforeUpload` / file-input lock (submit blocked; no transfer progress UI)
- `BompusFileUpload.isImageExt(ext)`, `DEFAULT_IMAGE_EXTS` (includes avif)

## Default UI

```js
var ui = BompusFileUpload.mountDefaultUi(up, {
  linkNewUploads: false,
  imageExts: BompusFileUpload.DEFAULT_IMAGE_EXTS.slice(),
  extraActions: function (ctx) { return []; },
  showRemove: true
});
// also available as up.ui
ui.setStatus("Preparing…");
ui.clearStatus();
```

## Demo

```bash
php -S localhost:8080
# http://localhost:8080/example.html
```

## WARNING

**Do not use example `upload.php` in production** without auth, type checks, size limits, and path safety.
