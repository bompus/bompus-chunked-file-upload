# bompus-chunked-file-upload

Parallel chunked file uploads. **Vanilla JS — no jQuery.**

**v2.1:** headless upload engine + optional `mountDefaultUi`.

Formerly [`bompus-jquery-file-upload`](https://github.com/bompus/bompus-jquery-file-upload) (archived / deprecated). Prefer CDN **`@2.1.0`**.

See [CHANGELOG.md](CHANGELOG.md).

## Requirements

Modern browser: Promise / async-await, `Blob`/`File.slice`, `FormData`, XHR upload progress.

## CDN

https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.1.0/bompus-chunked-file-upload.min.css  
https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.1.0/bompus-chunked-file-upload.min.js

https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.1.0/no-photo.png

## Quick start

```html
<form>
  <div data-bfu-text="upload-1"></div>
  <input data-bfu-file="upload-1" type="file" />
  <input data-bfu-hidden="upload-1" type="hidden" name="upload-1" value="" />
  <button type="submit">Save</button>
</form>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.1.0/bompus-chunked-file-upload.min.css" />
<script src="https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.1.0/bompus-chunked-file-upload.min.js"></script>
<script>
  var up = BompusFileUpload({
    postUrl: "/upload.php",
    fieldName: "upload-1",
    formData: { meta: "upload-1" },
    downloadUrl: function (encoded) { return "/files/" + encoded; }
  });
  BompusFileUpload.mountDefaultUi(up, { linkNewUploads: true });
</script>
```

## Engine options

| Option | Default | Description |
|--------|---------|-------------|
| `postUrl` | `"/path/to/upload.php"` | Upload endpoint |
| `fieldName` | `"bompus-file-1"` | Resolves `data-bfu-*` |
| `formData` | — | Object or `() => object` merged into every request |
| `downloadUrl` | `(enc) => "/files/"+enc` | Build download URL |
| `beforeUpload` | — | async; `SKIP_UPLOAD` / throw / proceed |
| `beforeRequest` | — | `(formData) => void` after merge |
| `chunkSizeMB` | `0.98` | Chunk size |
| `parallelLimit` | `5` | Max concurrent chunk POSTs |
| `maxFullSizeMB` | `20` | Full-POST fallback max |
| `maxRetries` | `3` | Per-chunk retries |

## `beforeUpload` contract

| Outcome | Behavior |
|---------|----------|
| resolve / return | Validate and `upload()` current `this.file` |
| throw / reject | `error` event (UI may render) |
| `BompusFileUpload.SKIP_UPLOAD` | Stop; no upload |

## Events / methods

- Events: `busy`, `idle`, `progress`, `complete`, `error` — `up.on("complete", fn)`
- `await up.upload(file?)` — success `{ fileName, duration, url }`; abort → `BompusFileUpload.ABORTED`
- `up.abort()`, `up.reset()`
- Sentinels: `BompusFileUpload.SKIP_UPLOAD`, `BompusFileUpload.ABORTED`

## Default UI

```js
var ui = BompusFileUpload.mountDefaultUi(up, {
  linkNewUploads: false,
  imageExts: ["jpg", "jpeg", "png", "gif", "webp", "avif"],
  extraActions: function (ctx) { return []; },
  showRemove: true
});
ui.setStatus("Preparing…");
ui.clearStatus();
```

## Demo

```bash
php -S localhost:8080
# http://localhost:8080/example.html
```

Crop demo (`index.php`) loads jQuery only for croppie/featherlight.

## WARNING

**Do not use example `upload.php` in production** without auth, type checks, size limits, and path safety.
