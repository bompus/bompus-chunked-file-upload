/*!
 * Bompus Chunked File Upload v3.0.2
 * https://github.com/bompus/bompus-chunked-file-upload
 *
 * Headless chunked upload engine + optional mountDefaultUi (same file for CDN).
 * Single-file >1k is intentional (no separate UI package); engine vs UI sectioned below.
 * Zero dependencies. Requires modern browser APIs:
 * Promise/async-await, Blob/File.slice, FormData, XMLHttpRequest upload.
 *
 * chunkSizeMB / maxFullSizeMB use decimal megabytes (1 MB = 1_000_000 bytes).
 *
 * Copyright Aaron Queen
 */

(function (global) {
  "use strict";

  var SKIP_UPLOAD = { name: "SKIP_UPLOAD" };
  var ABORTED = { name: "ABORTED" };
  var TIMEOUT = { name: "TIMEOUT" };
  var TRANSPORT_ERROR = { name: "TRANSPORT_ERROR" };

  var DEFAULT_IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "avif"];

  var formBusyState = new WeakMap();

  /** Leading call, then trailing pulses every `wait` ms while activity continues. */
  function createThrottledUpdate(fn, wait) {
    var timer = null;
    var pending = null;

    function cancel() {
      clearTimeout(timer);
      timer = null;
      pending = null;
    }

    function schedule() {
      timer = setTimeout(function () {
        timer = null;
        if (pending) {
          var args = pending;
          pending = null;
          fn.apply(null, args);
          schedule();
        }
      }, wait);
    }

    var rtn = function () {
      pending = arguments;
      if (timer) {
        return;
      }
      fn.apply(null, pending);
      pending = null;
      schedule();
    };
    rtn.cancel = cancel;
    return rtn;
  }

  async function mapLimit(count, limit, worker) {
    var next = 0;
    var firstError = null;
    var concurrency = Math.max(1, limit);

    async function run() {
      while (firstError === null && next < count) {
        var i = next++;
        try {
          await worker(i);
        } catch (err) {
          if (firstError === null) {
            firstError = err;
          }
          throw err;
        }
      }
    }

    var runners = [];
    for (var r = 0; r < Math.min(concurrency, count); r++) {
      runners.push(run());
    }

    await Promise.allSettled(runners);
    if (firstError !== null) {
      throw firstError;
    }
  }

  function decodeHtmlEntities(str) {
    var ta = document.createElement("textarea");
    ta.innerHTML = str;
    return ta.value;
  }

  function errMessage(err) {
    if (err === TIMEOUT) {
      return "Upload timed out.";
    }
    if (err === ABORTED) {
      return "Upload aborted.";
    }
    if (err === TRANSPORT_ERROR) {
      return "Upload failed.";
    }
    if (err === SKIP_UPLOAD) {
      return "Upload skipped.";
    }
    if (typeof err === "string") {
      return err;
    }
    if (err && err.message) {
      return err.message;
    }
    if (err && err.name) {
      return String(err.name);
    }
    return String(err);
  }

  function cssAttrEscape(value) {
    var s = String(value);
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(s);
    }
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function getFormBusyEntry(form) {
    var entry = formBusyState.get(form);
    if (!entry) {
      entry = { count: 0, listeners: [] };
      formBusyState.set(form, entry);
    }
    return entry;
  }

  function adjustFormBusy(form, delta) {
    if (!form) {
      return;
    }
    var entry = getFormBusyEntry(form);
    entry.count = Math.max(0, entry.count + delta);
    var count = entry.count;
    var listeners = entry.listeners.slice();
    for (var i = 0; i < listeners.length; i++) {
      listeners[i](count);
    }
  }

  /** One submit blocker per form; driven by formBusyCount. */
  function syncFormSubmitForForm(form) {
    if (!form) {
      return;
    }
    var entry = getFormBusyEntry(form);
    if (!entry.boundDisableSubmit) {
      entry.boundDisableSubmit = function (e) {
        e.preventDefault();
      };
    }
    var anyBusy = entry.count > 0;
    var submitBtn = form.querySelector("[type=submit]");
    if (anyBusy) {
      form.addEventListener("submit", entry.boundDisableSubmit);
      if (submitBtn) {
        submitBtn.disabled = true;
      }
    } else {
      form.removeEventListener("submit", entry.boundDisableSubmit);
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Engine (headless)
  // ---------------------------------------------------------------------------

  function BompusFileUpload(options) {
    if (this instanceof BompusFileUpload === false) {
      return new BompusFileUpload(options);
    }

    options = options || {};
    var fieldName = options.fieldName !== undefined ? options.fieldName : "bompus-file-1";
    var fieldSel = cssAttrEscape(fieldName);
    var hiddenInput =
      (options.elements && options.elements.hiddenInput) ||
      document.querySelector('input[type=hidden][data-bfu-hidden="' + fieldSel + '"]');
    var fileInput =
      (options.elements && options.elements.fileInput) ||
      document.querySelector('input[type=file][data-bfu-file="' + fieldSel + '"]');
    var form =
      (options.elements && options.elements.form) ||
      (hiddenInput ? hiddenInput.closest("form") : null);

    var canSlice =
      (typeof File !== "undefined" && File.prototype && typeof File.prototype.slice === "function") ||
      (typeof Blob !== "undefined" && Blob.prototype && typeof Blob.prototype.slice === "function");

    this.o = {
      postUrl: options.postUrl !== undefined ? options.postUrl : "/path/to/upload.php",
      fieldName: fieldName,
      chunkSizeMB: options.chunkSizeMB !== undefined ? options.chunkSizeMB : 0.98,
      parallelLimit: options.parallelLimit !== undefined ? options.parallelLimit : 5,
      maxFullSizeMB: options.maxFullSizeMB !== undefined ? options.maxFullSizeMB : 20,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : 3,
      formData: options.formData,
      downloadUrl:
        options.downloadUrl ||
        function (encoded) {
          return "/files/" + encoded;
        },
      beforeUpload: options.beforeUpload,
      beforeRequest: options.beforeRequest,
      elements: {
        form: form,
        formSubmitBtn: form ? form.querySelector("[type=submit]") : null,
        fileInput: fileInput,
        hiddenInput: hiddenInput
      }
    };

    this._listeners = {};
    this._busy = false;
    this._inputLocked = false;
    this._formBusyHeld = false;
    this._timedOut = false;
    this._uploadTimeoutId = null;
    this._boundFileInputChange = this._onFileInputChange.bind(this);
    this._tickProgressDebounce = createThrottledUpdate(this._emitProgress.bind(this), 500);

    // Decimal MB (1_000_000 bytes)
    this.chunkSizeBytes = 1000 * 1000 * this.o.chunkSizeMB;
    this.file = null;
    this.filename = "";
    this.filesize = -1;
    this.lastChunkNum = 1;
    this.method = "chunk";
    this.chunkProgressBytes = [];
    this.xhrs = [];
    this._retryTimeoutIds = [];
    this.uploadGeneration = 0;
    this.abortedGeneration = -1;
    this.uploadStarted = 0;
    this.uploadDuration = 0;
    this.upSpeedMbps = 0;
    this.currentFilename = "";
    this.encodedFilename = "";
    this.currentUrl = "";
    this.ui = null;
    this.unsupported = null;

    var hiddenEl = this.o.elements.hiddenInput;
    this.readonly = !!(hiddenEl && (hiddenEl.readOnly || hiddenEl.disabled));

    if (hiddenEl) {
      hiddenEl.bfu = this;
    }
    if (fileInput) {
      fileInput.bfu = this;
    }

    if (!global.Promise || !global.Blob || !global.FormData || canSlice === false) {
      this.unsupported =
        "Your browser appears to be outdated and does not support the upload mechanism being used.";
      return this;
    }

    if (hiddenEl && hiddenEl.value) {
      this._setFilenameState(decodeHtmlEntities(hiddenEl.value));
    }

    if (fileInput) {
      fileInput.addEventListener("change", this._boundFileInputChange);
    }
    this._syncFileInputEnabled();

    return this;
  }

  BompusFileUpload.SKIP_UPLOAD = SKIP_UPLOAD;
  BompusFileUpload.ABORTED = ABORTED;
  BompusFileUpload.TIMEOUT = TIMEOUT;
  BompusFileUpload.TRANSPORT_ERROR = TRANSPORT_ERROR;
  BompusFileUpload.DEFAULT_IMAGE_EXTS = DEFAULT_IMAGE_EXTS;

  BompusFileUpload.isImageExt = function (ext, exts) {
    var list = exts && exts.length ? exts : DEFAULT_IMAGE_EXTS;
    return list.includes(String(ext || "").toLowerCase());
  };

  /**
   * Subscribe once per form (same onChange fn is not added twice).
   * WeakMap count: _setBusy, beforeUpload input-lock, and holdFormBusy.
   */
  BompusFileUpload.trackFormBusy = function (form, opts) {
    if (!form) {
      return function () {};
    }
    opts = opts || {};
    var onChange = typeof opts.onChange === "function" ? opts.onChange : null;
    var entry = getFormBusyEntry(form);
    if (onChange) {
      if (entry.listeners.indexOf(onChange) === -1) {
        entry.listeners.push(onChange);
      }
      onChange(entry.count);
    }
    return function untrack() {
      if (!onChange) {
        return;
      }
      entry.listeners = entry.listeners.filter(function (fn) {
        return fn !== onChange;
      });
    };
  };

  BompusFileUpload.formBusyCount = function (form) {
    if (!form) {
      return 0;
    }
    var entry = formBusyState.get(form);
    return entry ? entry.count : 0;
  };

  /**
   * Hold form busy (submit blocked + trackFormBusy) outside upload/_busy.
   * Returns an idempotent release function.
   */
  BompusFileUpload.holdFormBusy = function (form) {
    if (!form) {
      return function () {};
    }
    adjustFormBusy(form, 1);
    syncFormSubmitForForm(form);
    var released = false;
    return function release() {
      if (released === true) {
        return;
      }
      released = true;
      adjustFormBusy(form, -1);
      syncFormSubmitForForm(form);
    };
  };

  BompusFileUpload.prototype.on = function (type, fn) {
    if (!this._listeners[type]) {
      this._listeners[type] = [];
    }
    this._listeners[type].push(fn);
    return this;
  };

  BompusFileUpload.prototype.off = function (type, fn) {
    var list = this._listeners[type];
    if (!list) {
      return this;
    }
    if (!fn) {
      this._listeners[type] = [];
      return this;
    }
    this._listeners[type] = list.filter(function (item) {
      return item !== fn;
    });
    return this;
  };

  BompusFileUpload.prototype.emit = function (type, detail) {
    var list = this._listeners[type];
    if (!list || list.length === 0) {
      return;
    }
    var copy = list.slice();
    for (var i = 0; i < copy.length; i++) {
      copy[i].call(this, detail);
    }
  };

  BompusFileUpload.prototype._emitError = function (err) {
    var message = errMessage(err);
    this.emit("error", { message: message, error: err });
    return message;
  };

  BompusFileUpload.prototype.isBusy = function () {
    return this._busy === true;
  };

  /** Canonical file-input enabled policy: readonly || busy || beforeUpload lock. */
  BompusFileUpload.prototype._syncFileInputEnabled = function () {
    var fileInput = this.o.elements.fileInput;
    if (!fileInput) {
      return;
    }
    fileInput.disabled =
      this.readonly === true || this._busy === true || this._inputLocked === true;
  };

  /** Public: re-apply file-input enabled policy after external disable/enable. */
  BompusFileUpload.prototype.syncFileInputEnabled = function () {
    this._syncFileInputEnabled();
  };

  /** Lock file input during beforeUpload; also holds form busy (not transfer _busy). */
  BompusFileUpload.prototype._setInputLocked = function (locked) {
    if (this._inputLocked === locked) {
      return;
    }
    this._inputLocked = locked;
    adjustFormBusy(this.o.elements.form, locked ? 1 : -1);
    this._syncFileInputEnabled();
    this._syncFormSubmit();
  };

  /** Drop a proceed-handoff form-busy hold that never reached _setBusy(true). */
  BompusFileUpload.prototype._releaseFormBusyHold = function () {
    if (this._formBusyHeld !== true) {
      return;
    }
    this._formBusyHeld = false;
    adjustFormBusy(this.o.elements.form, -1);
    this._syncFormSubmit();
  };

  BompusFileUpload.prototype._setBusy = function (busy) {
    if (this._busy === busy) {
      return;
    }
    this._busy = busy;
    var fileInput = this.o.elements.fileInput;
    if (fileInput) {
      if (busy) {
        fileInput.classList.add("inProgress");
      } else {
        fileInput.classList.remove("inProgress");
      }
    }
    if (busy === true && this._formBusyHeld === true) {
      // Ownership transfer from beforeUpload / pick hold — no double-count.
      this._formBusyHeld = false;
    } else {
      adjustFormBusy(this.o.elements.form, busy ? 1 : -1);
    }
    this._syncFileInputEnabled();
    this._syncFormSubmit();
    this.emit(busy ? "busy" : "idle");
  };

  BompusFileUpload.prototype._syncFormSubmit = function () {
    var form = this.o.elements.form;
    if (form) {
      syncFormSubmitForForm(form);
      return;
    }
    if (!this.o.elements.formSubmitBtn) {
      return;
    }
    this.o.elements.formSubmitBtn.disabled = this._busy === true;
  };

  BompusFileUpload.prototype._setFilenameState = function (filename) {
    this.currentFilename = filename || "";
    this.encodedFilename = encodeURIComponent(this.currentFilename);
    this.currentUrl = this.currentFilename
      ? this.o.downloadUrl.call(this, this.encodedFilename)
      : "";
    if (this.o.elements.hiddenInput) {
      this.o.elements.hiddenInput.value = this.currentFilename;
    }
  };

  BompusFileUpload.prototype._emitProgress = function (isComplete) {
    if (isComplete === true) {
      this._tickProgressDebounce.cancel();
      var uploadEnded = Date.now();
      this.uploadDuration = Number(((uploadEnded - this.uploadStarted) / 1000).toFixed(2));
      if (this.o.elements.fileInput) {
        this.o.elements.fileInput.value = null;
      }
      this.emit("progress", {
        pct: 100,
        mbps: this.upSpeedMbps,
        secsLeft: 0,
        complete: true,
        duration: this.uploadDuration
      });
      return;
    }

    if (this.chunkProgressBytes.length === 0) {
      return;
    }

    var bytesSum = this.chunkProgressBytes.reduce(function (a, b) {
      return a + b;
    }, 0);
    var pct =
      this.filesize > 0 ? Math.min((bytesSum / this.filesize) * 100, 99.9) : 0;
    var elapsed = (Date.now() - this.uploadStarted) / 1000;
    var bps = elapsed ? bytesSum / elapsed : 0;
    var bytesLeft = Math.max(0, this.filesize - bytesSum);
    var upSpeedKBps = Math.ceil(bps / 1024);
    this.upSpeedMbps = (upSpeedKBps / 125).toFixed(2);
    var secsLeft =
      elapsed && bps > 0 ? Math.max(1, Math.ceil(bytesLeft / bps)) : "calculating";

    this.emit("progress", {
      pct: Number(pct.toFixed(1)),
      mbps: this.upSpeedMbps,
      secsLeft: secsLeft,
      complete: false
    });
  };

  BompusFileUpload.prototype._validateFile = function () {
    this.filename = this.file ? this.file.name : "";
    this.filesize = this.file ? this.file.size : 0;
    var dot = this.filename.lastIndexOf(".");
    var extension = dot === -1 ? "" : this.filename.slice(dot + 1);

    if (!this.file) {
      throw "File could not be loaded.";
    }
    if (this.filename.length === 0) {
      throw "File name could not be detected.";
    }
    if (this.filesize <= 0) {
      throw "File size could not be detected.";
    }
    if (
      dot === -1 ||
      extension.length === 0 ||
      extension.length > 16 ||
      /^[A-Za-z0-9]+$/.test(extension) === false
    ) {
      throw "File must end with a type, such as .jpg or .jpeg";
    }
  };

  BompusFileUpload.prototype._onFileInputChange = async function () {
    var fileInput = this.o.elements.fileInput;
    this.file = fileInput && fileInput.files ? fileInput.files[0] : null;
    this.method = "chunk";

    // Block overlapping picks + hold form busy while beforeUpload runs (upload uses _busy)
    this._setInputLocked(true);

    if (this.unsupported) {
      this._emitError(this.unsupported);
      this._setInputLocked(false);
      return;
    }

    if (typeof this.o.beforeUpload === "function") {
      try {
        var result = await this.o.beforeUpload.call(this);
        if (result === SKIP_UPLOAD) {
          this._setInputLocked(false);
          return;
        }
      } catch (err) {
        if (err === ABORTED || err === SKIP_UPLOAD) {
          this._setInputLocked(false);
          return;
        }
        this._emitError(err);
        this._setInputLocked(false);
        return;
      }
    }

    // Handoff form-busy into upload() without a SAVE gap or double-count.
    this._inputLocked = false;
    this._formBusyHeld = true;
    this._syncFileInputEnabled();
    try {
      await this.upload();
    } catch (err) {
      // upload() emits for TIMEOUT / validation / transfer failures; ABORTED is quiet
      this._releaseFormBusyHold();
      if (err === ABORTED || err === TIMEOUT) {
        return;
      }
      this._syncFileInputEnabled();
    }
  };

  BompusFileUpload.prototype._pruneFinishedXhrs = function () {
    if (!this.xhrs || this.xhrs.length === 0) {
      return;
    }
    this.xhrs = this.xhrs.filter(function (xhr) {
      return xhr && xhr.readyState !== 4;
    });
  };

  BompusFileUpload.prototype._clearUploadTimeout = function () {
    if (this._uploadTimeoutId !== null) {
      clearTimeout(this._uploadTimeoutId);
      this._uploadTimeoutId = null;
    }
  };

  /** Clear pending retry timers and reject their chunk promises (avoids mapLimit hang). */
  BompusFileUpload.prototype._clearChunkRetries = function () {
    if (!this._retryTimeoutIds || this._retryTimeoutIds.length === 0) {
      this._retryTimeoutIds = [];
      return;
    }
    this._retryTimeoutIds.forEach(function (entry) {
      clearTimeout(entry.id);
      if (typeof entry.reject === "function") {
        entry.reject(ABORTED);
      }
    });
    this._retryTimeoutIds = [];
  };

  /** Abort in-flight XHRs and pending chunk retries; does not clear busy/timeout/generation. */
  BompusFileUpload.prototype._abortXhrsOnly = function () {
    this._clearChunkRetries();
    if (this.xhrs && this.xhrs.length > 0) {
      this.xhrs.forEach(function (xhr) {
        if (xhr && xhr.readyState !== 4 && typeof xhr.abort === "function") {
          xhr.abort();
        }
      });
      this.xhrs = [];
    }
  };

  BompusFileUpload.prototype.abort = function () {
    this._clearUploadTimeout();
    this._tickProgressDebounce.cancel();
    this.abortedGeneration = this.uploadGeneration;
    this._abortXhrsOnly();
    this._setBusy(false);
  };

  BompusFileUpload.prototype._isStaleOrAborted = function (generation) {
    return generation !== this.uploadGeneration || this.abortedGeneration === generation;
  };

  BompusFileUpload.prototype._throwIfStale = function (generation) {
    if (this._isStaleOrAborted(generation) === true) {
      throw this._timedOut ? TIMEOUT : ABORTED;
    }
  };

  /** Clear timeout/XHR/retries + busy; emit once for TIMEOUT / non-ABORTED; then throw. */
  BompusFileUpload.prototype._endAttempt = function (err) {
    this._clearUploadTimeout();
    this._abortXhrsOnly();
    this._tickProgressDebounce.cancel();
    this._setBusy(false);
    if (err === TIMEOUT) {
      this._emitError(TIMEOUT);
    } else if (err !== ABORTED) {
      this._emitError(err);
    }
    throw err;
  };

  BompusFileUpload.prototype.clearPendingSelection = function () {
    var fileInput = this.o.elements.fileInput;
    if (!fileInput) {
      return;
    }
    fileInput.value = null;
    this._syncFileInputEnabled();
  };

  BompusFileUpload.prototype.setReadonly = function (flag) {
    this.readonly = flag === true;
    this._syncFileInputEnabled();
    if (this.ui && typeof this.ui.renderLabel === "function") {
      this.ui.renderLabel(true);
    }
  };

  BompusFileUpload.prototype.reset = function () {
    this.abort();
    this.file = null;
    this.method = "chunk";
    this._setFilenameState("");
    if (this.o.elements.fileInput && this.readonly !== true) {
      this.o.elements.fileInput.value = null;
    }
  };

  BompusFileUpload.prototype._mergeFormData = function (formData) {
    var extra = this.o.formData;
    if (typeof extra === "function") {
      extra = extra.call(this);
    }
    if (extra && typeof extra === "object") {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) {
        formData.append(keys[i], extra[keys[i]]);
      }
    }
    if (typeof this.o.beforeRequest === "function") {
      this.o.beforeRequest.call(this, formData);
    }
  };

  BompusFileUpload.prototype._uploadChunk = function (myChunkNum, myAction, retryNum) {
    var self = this;
    var generation = this.uploadGeneration;
    var progressIdx = myChunkNum - 1;
    var lengthComputable = false;
    var formData = new FormData();
    var start = (myChunkNum - 1) * this.chunkSizeBytes;
    var end = Math.min(start + this.chunkSizeBytes, this.filesize);
    var myChunkByteLen = end - start;
    var maxFullBytes = this.o.maxFullSizeMB * 1000 * 1000;

    if (retryNum === undefined) {
      retryNum = 0;
    }

    if (self._isStaleOrAborted(generation) === true) {
      return Promise.reject(ABORTED);
    }

    formData.append("file_name", this.filename);
    formData.append("file_size", this.filesize);
    formData.append("file_chunk", myChunkNum);
    formData.append("file_chunk_max", this.lastChunkNum);
    formData.append("chunk_action", myAction);
    formData.append("chunk_method", this.method);
    formData.append("retry_num", retryNum);
    this._mergeFormData(formData);

    if (myAction === "sendChunk") {
      if (this.method === "chunk") {
        formData.append("file", this.file.slice(start, end));
      } else if (this.method === "full") {
        if (this.file.size > maxFullBytes) {
          return Promise.reject(
            "File is too large. Please try again with a file smaller than " +
              this.o.maxFullSizeMB +
              "MB."
          );
        }
        formData.append("file", this.file);
      }
    }

    return new Promise(function (resolve, reject) {
      if (self._isStaleOrAborted(generation) === true) {
        reject(ABORTED);
        return;
      }

      var xhr = new XMLHttpRequest();
      xhr.open("POST", self.o.postUrl);
      xhr.responseType = "text";

      xhr.upload.addEventListener(
        "progress",
        function (e) {
          if (self._isStaleOrAborted(generation) === true) {
            return;
          }
          lengthComputable = e.lengthComputable;
          if (lengthComputable && myAction === "sendChunk") {
            self.chunkProgressBytes[progressIdx] = e.loaded;
            self._tickProgressDebounce(false);
          }
        },
        false
      );

      xhr.onerror = function () {
        if (self._isStaleOrAborted(generation) === true) {
          reject(ABORTED);
          return;
        }
        fail(TRANSPORT_ERROR);
      };

      xhr.onabort = function () {
        reject(ABORTED);
      };

      xhr.onload = function () {
        if (self._isStaleOrAborted(generation) === true) {
          reject(ABORTED);
          return;
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          fail(TRANSPORT_ERROR);
          return;
        }

        var data = null;
        try {
          data = JSON.parse(xhr.responseText || "null");
        } catch (parseErr) {
          reject("Unknown Error E426.");
          return;
        }

        if (!data) {
          data = {};
        }

        var success = data.success;
        data = data.data ? data.data : data;

        if (success !== true) {
          reject(data.message ? data.message : "Unknown Error E426.");
          return;
        }

        if (!data.file_name) {
          reject("Unknown Error E431.");
          return;
        }

        switch (myAction) {
          case "initFile":
            self.filename = data.file_name;
            break;
          case "sendChunk":
            if (!lengthComputable) {
              self.chunkProgressBytes[progressIdx] = myChunkByteLen;
              self._tickProgressDebounce(false);
            }
            break;
          case "combineChunks":
            self._emitProgress(true);
            break;
        }

        resolve(data);
      };

      function fail(textStatus) {
        if (self._isStaleOrAborted(generation) === true) {
          reject(ABORTED);
          return;
        }

        if (self.method === "chunk" && myAction === "sendChunk" && retryNum < self.o.maxRetries) {
          retryNum++;
          var retryGeneration = generation;
          var entry = { id: null, reject: reject };
          entry.id = setTimeout(function () {
            self._retryTimeoutIds = self._retryTimeoutIds.filter(function (item) {
              return item !== entry;
            });
            if (self._isStaleOrAborted(retryGeneration) === true) {
              reject(ABORTED);
              return;
            }
            self._uploadChunk(myChunkNum, myAction, retryNum).then(resolve, reject);
          }, retryNum * 1000);
          self._retryTimeoutIds.push(entry);
          return;
        }

        reject(textStatus || TRANSPORT_ERROR);
      }

      self._pruneFinishedXhrs();
      self.xhrs.push(xhr);
      xhr.send(formData);
    });
  };

  BompusFileUpload.prototype._finishSuccess = function (fileName) {
    this._clearUploadTimeout();
    this._setFilenameState(fileName);
    this._setBusy(false);
    var payload = {
      fileName: fileName,
      duration: this.uploadDuration,
      url: this.currentUrl
    };
    this.emit("complete", payload);
    return payload;
  };

  BompusFileUpload.prototype._runFullFallback = async function (generation) {
    // Kill chunk XHRs only — keep generation, busy, and timeout for this attempt.
    this._abortXhrsOnly();
    this.method = "full";
    this.lastChunkNum = 1;
    this.chunkProgressBytes = [0];
    this.xhrs = [];

    await this._uploadChunk(0, "initFile", 0);
    this._throwIfStale(generation);

    this.uploadStarted = Date.now();
    await this._uploadChunk(1, "sendChunk", 0);
    this._throwIfStale(generation);

    var combineData = await this._uploadChunk(1, "combineChunks", 0);
    this._throwIfStale(generation);

    return this._finishSuccess(combineData.file_name);
  };

  /**
   * Start or continue an upload.
   * - Rejects ABORTED on user/stale abort (no error event).
   * - Rejects TIMEOUT on opts.timeoutMs (emits error once).
   * - Other failures emit error once then reject.
   */
  BompusFileUpload.prototype.upload = async function (file, opts) {
    if (file) {
      this.file = file;
    }
    opts = opts || {};
    var timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 0;

    if (this.unsupported) {
      this._releaseFormBusyHold();
      this._emitError(this.unsupported);
      throw this.unsupported;
    }

    if (this._busy === true) {
      this._releaseFormBusyHold();
      var busyErr = "An upload is already in progress.";
      this._emitError(busyErr);
      throw busyErr;
    }

    this.method = "chunk";

    try {
      this._validateFile();
    } catch (err) {
      this._releaseFormBusyHold();
      this._emitError(err);
      throw err;
    }

    this.uploadGeneration++;
    var generation = this.uploadGeneration;

    this._timedOut = false;
    this.chunkProgressBytes = [];
    this.xhrs = [];
    this._clearChunkRetries();
    this._clearUploadTimeout();

    this.lastChunkNum = Math.max(1, Math.ceil(this.filesize / this.chunkSizeBytes));

    for (var i = 0; i < this.lastChunkNum; i++) {
      this.chunkProgressBytes[i] = 0;
    }

    if (timeoutMs > 0) {
      var selfTimeout = this;
      this._uploadTimeoutId = setTimeout(function () {
        // Soft-stop: keep form busy until upload() settles (TIMEOUT path).
        selfTimeout._timedOut = true;
        selfTimeout.abortedGeneration = selfTimeout.uploadGeneration;
        selfTimeout._abortXhrsOnly();
        selfTimeout._clearUploadTimeout();
      }, timeoutMs);
    }

    this._setBusy(true);

    try {
      await this._uploadChunk(0, "initFile", 0);
      this._throwIfStale(generation);

      this.uploadStarted = Date.now();

      var self = this;
      var sawFirstError = false;
      await mapLimit(this.lastChunkNum, this.o.parallelLimit, function (n) {
        return self._uploadChunk(n + 1, "sendChunk", 0).catch(function (err) {
          if (sawFirstError === false) {
            sawFirstError = true;
            self._abortXhrsOnly();
          }
          throw err;
        });
      });

      this._throwIfStale(generation);

      var combineData = await this._uploadChunk(this.lastChunkNum, "combineChunks", 0);
      this._throwIfStale(generation);

      return this._finishSuccess(combineData.file_name);
    } catch (err) {
      if (generation !== this.uploadGeneration) {
        throw this._timedOut ? TIMEOUT : ABORTED;
      }

      var finalErr = this._timedOut ? TIMEOUT : err;

      if (finalErr === ABORTED || finalErr === TIMEOUT) {
        this._endAttempt(finalErr);
      }

      // Transport/HTTP failures only (not server / Unknown Error* / app messages)
      if (finalErr === TRANSPORT_ERROR && this.method === "chunk") {
        try {
          return await this._runFullFallback(generation);
        } catch (fallbackErr) {
          finalErr = this._timedOut ? TIMEOUT : fallbackErr;
          if (finalErr === ABORTED || finalErr === TIMEOUT) {
            this._endAttempt(finalErr);
          }
        }
      }

      this._endAttempt(finalErr);
    }
  };

  // ---------------------------------------------------------------------------
  // Default UI adapter
  // ---------------------------------------------------------------------------

  function setDisplay(el, visible) {
    if (!el) {
      return;
    }
    el.style.display = visible ? "" : "none";
  }

  function defaultLinkClass(filename, imageExts) {
    var ext = (filename.split(".").pop() || "").toLowerCase();
    return BompusFileUpload.isImageExt(ext, imageExts) ? "imgLink" : "downloadLink";
  }

  BompusFileUpload.mountDefaultUi = function (uploader, uiOpts) {
    if (uploader.ui) {
      return uploader.ui;
    }

    uiOpts = uiOpts || {};
    var fieldName = uploader.o.fieldName;
    var fieldSel = cssAttrEscape(fieldName);
    var infoText =
      uiOpts.infoText || document.querySelector('div[data-bfu-text="' + fieldSel + '"]');
    var linkNewUploads = uiOpts.linkNewUploads === true;
    var showRemove = uiOpts.showRemove !== false;
    var imageExts = uiOpts.imageExts || DEFAULT_IMAGE_EXTS.slice();
    var extraActions = uiOpts.extraActions;
    var barFill = null;
    var barText = null;
    var statusActive = false;

    function clearInfo() {
      if (!infoText) {
        return;
      }
      infoText.replaceChildren();
      setDisplay(infoText, false);
      barFill = null;
      barText = null;
    }

    function setInfoNode(nodeOrHtml) {
      if (!infoText) {
        return;
      }
      infoText.replaceChildren();
      if (typeof nodeOrHtml === "string") {
        infoText.innerHTML = nodeOrHtml;
      } else if (nodeOrHtml) {
        infoText.appendChild(nodeOrHtml);
      }
      setDisplay(infoText, true);
    }

    function setStatus(nodeOrHtml) {
      statusActive = true;
      setInfoNode(nodeOrHtml);
    }

    function clearStatus() {
      if (statusActive !== true) {
        return;
      }
      statusActive = false;
      if (uploader.isBusy() !== true) {
        renderLabel(true);
      } else {
        clearInfo();
      }
    }

    function showProgressShell() {
      statusActive = false;
      setInfoNode(
        '<div class="bfu-bar"><div class="bfu-bar-fill"></div><div class="bfu-bar-text">0.0% | 0.00 Mbps | calculating remaining</div></div>'
      );
      barFill = infoText ? infoText.querySelector(".bfu-bar-fill") : null;
      barText = infoText ? infoText.querySelector(".bfu-bar-text") : null;
    }

    function renderLabel(fromInit) {
      statusActive = false;
      var fileInput = uploader.o.elements.fileInput;

      if (!uploader.currentFilename) {
        if (uploader.readonly === true) {
          setInfoNode(document.createTextNode("No File Uploaded"));
          setDisplay(fileInput, false);
        } else {
          clearInfo();
          setDisplay(fileInput, true);
        }
        return;
      }

      var wrap = document.createElement("div");
      wrap.style.cssFloat = "left";
      wrap.className = uploader.readonly ? "bfu-dl-readonly" : "bfu-dl-editable";

      var showLink = fromInit === true || linkNewUploads === true;
      if (showLink === true) {
        var dl = document.createElement("a");
        dl.target = "_blank";
        dl.className = "bfu-dl " + defaultLinkClass(uploader.currentFilename, imageExts);
        dl.href = uploader.currentUrl;
        dl.textContent = uploader.currentFilename;
        wrap.appendChild(dl);
      } else {
        var span = document.createElement("span");
        span.textContent = uploader.currentFilename;
        wrap.appendChild(span);
      }

      if (uploader.readonly === false && showRemove === true) {
        var divider = document.createElement("span");
        divider.className = "bfu-dl-divider";
        divider.innerHTML = "&nbsp;&nbsp;";
        wrap.appendChild(divider);

        var remove = document.createElement("a");
        remove.className = "bfu-remove";
        remove.href = "#";
        remove.textContent = "Remove";
        remove.addEventListener("click", function (e) {
          e.preventDefault();
          uploader.reset();
          renderLabel(true);
        });
        wrap.appendChild(remove);
      }

      if (uploader.readonly === false && typeof extraActions === "function") {
        var actions = extraActions.call(uploader, {
          fromInit: fromInit === true,
          filename: uploader.currentFilename,
          uploader: uploader
        });
        if (actions && actions.length) {
          for (var a = 0; a < actions.length; a++) {
            if (!actions[a]) {
              continue;
            }
            var d2 = document.createElement("span");
            d2.className = "bfu-dl-divider";
            d2.innerHTML = "&nbsp;&nbsp;";
            wrap.appendChild(d2);
            wrap.appendChild(actions[a]);
          }
        }
      }

      setInfoNode(wrap);
      setDisplay(fileInput, false);
    }

    uploader.on("busy", function () {
      if (statusActive !== true) {
        showProgressShell();
      }
    });

    uploader.on("progress", function (detail) {
      if (!barFill || !barText || statusActive === true) {
        return;
      }
      barFill.style.width = detail.pct + "%";
      var secs = detail.complete === true ? "0" : detail.secsLeft;
      barText.textContent = [detail.pct + "%", detail.mbps + " Mbps", secs + " seconds remaining"].join(
        " | "
      );
    });

    uploader.on("complete", function () {
      renderLabel(false);
    });

    uploader.on("error", function (detail) {
      var err = document.createElement("span");
      err.className = "bfu-error";
      err.textContent =
        "Error: " + String(detail && detail.message ? detail.message : "Unknown error.");
      setInfoNode(err);
      if (uploader.readonly !== true) {
        var fileInput = uploader.o.elements.fileInput;
        setDisplay(fileInput, true);
        if (fileInput) {
          fileInput.value = null;
        }
      }
    });

    // Always paint idle (including empty editable) so enable/show runs
    renderLabel(true);

    var api = {
      setStatus: setStatus,
      clearStatus: clearStatus,
      renderLabel: renderLabel,
      clearInfo: clearInfo
    };
    uploader.ui = api;
    return api;
  };

  global.BompusFileUpload = BompusFileUpload;
})(typeof globalThis !== "undefined" ? globalThis : window);
