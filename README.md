# bompus-chunked-file-upload

Upload files from a web browser in parallel chunks. Vanilla JS — **no jQuery**.

Formerly published as [`bompus-jquery-file-upload`](https://github.com/bompus/bompus-jquery-file-upload) (GitHub redirects after rename).

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Requirements

- A modern browser with **Promise** and **async/await**, plus `Blob`/`File.slice`, `FormData`, and `XMLHttpRequest` upload progress

## CDN

https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.0.0/bompus-chunked-file-upload.min.css  
https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.0.0/bompus-chunked-file-upload.min.js

Optional placeholder image:

https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.0.0/no-photo.png

## Quick start (markup)

```html
<form>
  <div data-bfu-text="upload-1"></div>
  <input data-bfu-file="upload-1" type="file" />
  <input data-bfu-hidden="upload-1" type="hidden" name="upload-1" value="" />
  <button type="submit">Save</button>
</form>

<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.0.0/bompus-chunked-file-upload.min.css" />
<script src="https://cdn.jsdelivr.net/gh/bompus/bompus-chunked-file-upload@2.0.0/bompus-chunked-file-upload.min.js"></script>
```

## Full working example

Open [`example.html`](example.html) from an HTTP server in this directory (needs [`upload.php`](upload.php)):

```bash
php -S localhost:8080
# http://localhost:8080/example.html
```

The PHP demo page with image crop (jQuery used only for croppie/featherlight) is [`index.php`](index.php).

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `postUrl` | `"/path/to/upload.php"` | Upload endpoint |
| `fieldName` | `"bompus-file-1"` | Matches `data-bfu-*` attributes |
| `chunkSizeMB` | `0.98` | Chunk size in MB |
| `parallelLimit` | `5` | Max concurrent chunk POSTs (clamped to ≥ 1) |
| `maxFullSizeMB` | `20` | Max size when falling back to a single non-chunked POST |
| `maxRetries` | `3` | Retries per failed `sendChunk` (0 disables) |

## `fileSelected` Promise contract

| Outcome | BFU behavior |
|---------|----------------|
| resolve / return `undefined` / `null` | Validate and upload `this.file` |
| reject / throw (string or `Error`) | `setError(message)` |
| resolve `BompusFileUpload.SKIP_UPLOAD` | Stop; no BFU upload (you already uploaded or cancelled) |

## Full hooks example

```js
BompusFileUpload({
  postUrl: "/upload.php",
  fieldName: "upload-1",
  chunkSizeMB: 0.98,
  parallelLimit: 5,
  maxFullSizeMB: 20,
  maxRetries: 3,
  hooks: {
    getFileDownloadUrl: function (uriEncodedFilename) {
      return "/files/" + uriEncodedFilename;
    },

    getFileDownloadLinkClassName: function (uriEncodedFilename) {
      var ext = (uriEncodedFilename.split(".").pop() || "").toLowerCase();
      if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "gif" || ext === "webp") {
        return "imgLink";
      }
      return "downloadLink";
    },

    // dlEl / removeEl are HTMLElements
    setText: function (fromInit, dlEl, removeEl) {
      var tmpElm = document.createElement("div");
      tmpElm.style.cssFloat = "left";
      tmpElm.className = this.readonly ? "bfu-dl-readonly" : "bfu-dl-editable";
      var pre = document.createElement("span");
      pre.className = "bfu-dl-pre";
      tmpElm.append(pre, dlEl);
      if (this.readonly === false) {
        var divider = document.createElement("span");
        divider.className = "bfu-dl-divider";
        divider.innerHTML = "&nbsp;&nbsp;";
        tmpElm.append(divider, removeEl);
      }
      this.setInfoText(tmpElm);
    },

    fileSelected: function () {
      // return;                                    // proceed with upload
      // return BompusFileUpload.SKIP_UPLOAD;       // you handled upload/cancel
      // return Promise.reject("Nope");             // show error, no upload
    },

    beforeChunkSend: function (formData) {
      formData.append("action", "my_upload_action");
      formData.append("post_id", "123");
    },

    progressStart: function () {},
    progressEnd: function () {},

    uploadComplete: function () {
      console.log("done in", this.uploadDuration, "s", this.currentFilename);
    }
  }
});
```

### Useful instance fields / methods

- `this.file`, `this.filename`, `this.filesize`, `this.currentFilename`, `this.currentUrl`
- `this.uploadDuration`, `this.method` (`"chunk"` \| `"full"`)
- `this.reset()`, `this.setError(message)`, `this.setText(filename, fromInit)`
- `this.upload_file()` — Promise; start upload of the current `this.file`
- `this.abortPendingUploads()` — abort in-flight XHRs for the current generation
- `this.releaseUploadControls()` — clear `inProgress` without wiping a caller’s error text

## Server protocol (summary)

The client POSTs `multipart/form-data` with fields including `chunk_action` (`initFile` \| `sendChunk` \| `combineChunks`), `file_name`, `file_size`, `file_chunk`, `file_chunk_max`, `chunk_method`, `retry_num`, and for `sendChunk` a `file` blob. Expect JSON like `{ "success": true, "data": { "file_name": "..." } }`.

**Do not use the example `upload.php` in production** without hardening (auth, type checks, size limits, path safety).

## WARNING

**DO NOT USE the example upload.php in production. You will want to make sure server-side that you only accept and validate desired file types.**
