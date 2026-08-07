# bompus-chunked-file-upload

Sequential chunked file uploads. **Vanilla JS — zero dependencies.**

**v4.0:** UI-first `mount`, **no auto-upload** on file pick, `upload(file, { data })`, form busy helpers, `decorateLabel`. Wire protocol remains `initFile` → `sendChunk`(s) → `combineChunks`.

Formerly [`bompus-jquery-file-upload`](https://github.com/bompus/bompus-jquery-file-upload) (deprecated). Prefer CDN **`@4.0.1`**.

See [CHANGELOG.md](CHANGELOG.md).

## Requirements

Modern browser: Promise / async-await, `Blob`/`File.slice`, `FormData`, XHR upload progress.

## CDN

https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@4.0.1/bompus-chunked-file-upload.min.css  
https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@4.0.1/bompus-chunked-file-upload.min.js  
https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@4.0.1/no-photo.png

## Quick start

```html
<form id="post">
  <div data-bfu-text="upload-1"></div>
  <input data-bfu-file="upload-1" type="file" />
  <input data-bfu-hidden="upload-1" type="hidden" name="upload-1" value="" />
  <button type="submit">Save</button>
</form>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@4.0.1/bompus-chunked-file-upload.min.css" />
<script src="https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@4.0.1/bompus-chunked-file-upload.min.js"></script>
<script>
  var form = document.getElementById("post");
  var fileInput = document.querySelector('[data-bfu-file="upload-1"]');
  var field = BompusFileUpload.mount({
    url: "/upload.php",
    data: { meta: "upload-1" },
    elements: {
      infoText: document.querySelector('[data-bfu-text="upload-1"]'),
      fileInput: fileInput,
      hiddenInput: document.querySelector('[data-bfu-hidden="upload-1"]')
    },
    downloadUrl: function (encoded) { return "/files/" + encoded; },
    linkNewUploads: true
  });
  BompusFileUpload.bindInput(fileInput, function (file) {
    return field.upload(file);
  });
  BompusFileUpload.trackFormBusy(form, {
    onChange: function (count) { /* show notice when count > 0 */ }
  });
</script>
```

## Mount options

| Option | Default | Description |
|--------|---------|-------------|
| `url` / `postUrl` | `"/path/to/upload.php"` | Upload endpoint |
| `data` / `formData` | — | Object or `() => object` merged into every request |
| `elements` | — | `{ fileInput, hiddenInput, infoText?, form? }` (preferred) |
| `downloadUrl` | `(enc) => "/files/"+enc` | Build download URL |
| `decorateLabel` | — | `(labelRoot, ctx) => HTMLElement[]?` — mutate label and/or return action nodes (before Remove) |
| `showRemove` | `true` | Show Remove control |
| `linkNewUploads` | `false` | Link newly uploaded filenames (existing values always link) |
| `imageExts` | `DEFAULT_IMAGE_EXTS` | Exts that get `imgLink` class |
| `chunkSizeMB` | `0.98` | Decimal MB (`1_000_000` bytes) |
| `maxFileMB` | `200` | Reject larger files (`maxFullSizeMB` accepted as alias) |
| `maxRetries` | `3` | Per-chunk retries |

Pass a root `Element` as the first argument to resolve `data-bfu-*` **within that root** (no page-wide scavenger).

## Pick ≠ upload

File input changes do **not** upload. Use:

```js
BompusFileUpload.bindInput(fileInput, async (file) => {
  // optional preprocess / crop / editor …
  await field.upload(file, { data: { client_processed: "1" }, timeoutMs });
});
// cancel = do not call upload
```

## Events / methods

- Events: `busy`, `idle`, `progress`, `complete`, `error`, `change` (hidden value set or cleared)
- `await field.upload(file?, { data?, timeoutMs? })` — success `{ fileName, duration, url }`
  - Abort / stale: reject `BompusFileUpload.ABORTED` (no `error` event)
  - Timeout: reject `TIMEOUT` **and** one `error` event
  - Other failures: reject **and** one `error` event
- `field.abort()`, `field.reset()`, `field.clearPendingSelection()`, `field.setReadonly(bool)`, `field.syncFileInputEnabled()`
- Registry: `hiddenInput.bfu` / `fileInput.bfu` → instance
- Form busy: `trackFormBusy(form, { onChange })`, `formBusyCount(form)`, `holdFormBusy(form)` → `release()` (use during dialogs so SAVE stays blocked)
- Transfer automatically holds form busy while bytes are on the wire
- `BompusFileUpload.isImageExt(ext)`, `DEFAULT_IMAGE_EXTS`

## UI helpers

```js
field.ui.setStatus("Preparing…");
field.ui.clearStatus();
field.ui.renderLabel(true);
```

## Server protocol

Each logical `upload()` sends:

1. `chunk_action=initFile`
2. one or more `chunk_action=sendChunk` (file blob)
3. `chunk_action=combineChunks`

Fields: `file_name`, `file_size`, `file_chunk`, `file_chunk_max`, `chunk_method`, `retry_num`, plus mount `data` and per-upload `opts.data`. JSON success with `file_name` (WP `wp_send_json_success` unwrap OK).
