/*!
 * Bompus Chunked File Upload v4.0.1
 * https://github.com/bompus/bompus-chunked-file-upload
 *
 * UI-first mount + sequential chunked upload (initFile / sendChunk / combineChunks).
 * Does not auto-upload on file pick — callers use upload(file) or bindInput.
 * Zero dependencies. Requires Promise/async-await, Blob/File.slice, FormData, XHR.
 *
 * chunkSizeMB / maxFileMB use decimal megabytes (1 MB = 1_000_000 bytes).
 *
 * Copyright Aaron Queen
 */

(function (global) {
  "use strict";

  var ABORTED = { name: "ABORTED" };
  var TIMEOUT = { name: "TIMEOUT" };
  var TRANSPORT_ERROR = { name: "TRANSPORT_ERROR" };

  var DEFAULT_IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "avif"];

  var formBusyState = new WeakMap();

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

  function setDisplay(el, visible) {
    if (!el) {
      return;
    }
    el.style.display = visible ? "" : "none";
  }

  function normalizeFile(file) {
    if (!file) {
      return null;
    }
    if (typeof File === "function" && file instanceof File) {
      return file;
    }
    if (typeof Blob !== "undefined" && file instanceof Blob) {
      var name = file.name || "upload.bin";
      return new File([file], name, { type: file.type || "application/octet-stream" });
    }
    return file;
  }

  // ---------------------------------------------------------------------------
  // Form busy (public)
  // ---------------------------------------------------------------------------

  function BompusFileUpload() {
    throw new Error("Use BompusFileUpload.mount(options) — the constructor no longer auto-uploads.");
  }

  BompusFileUpload.ABORTED = ABORTED;
  BompusFileUpload.TIMEOUT = TIMEOUT;
  BompusFileUpload.TRANSPORT_ERROR = TRANSPORT_ERROR;
  BompusFileUpload.DEFAULT_IMAGE_EXTS = DEFAULT_IMAGE_EXTS;

  BompusFileUpload.isImageExt = function (ext, exts) {
    var list = exts && exts.length ? exts : DEFAULT_IMAGE_EXTS;
    return list.indexOf(String(ext || "").toLowerCase()) !== -1;
  };

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

  /**
   * Wire a file input change → onPick(file). Does not upload.
   * Returns unbind().
   */
  BompusFileUpload.bindInput = function (input, onPick) {
    if (!input || typeof onPick !== "function") {
      return function () {};
    }
    var running = false;
    async function handler() {
      if (running === true) {
        return;
      }
      var file = input.files && input.files[0] ? input.files[0] : null;
      if (!file) {
        return;
      }
      running = true;
      try {
        await onPick(file, input);
      } finally {
        running = false;
        try {
          input.value = null;
        } catch (clearErr) {
          /* ignore */
        }
      }
    }
    input.addEventListener("change", handler);
    return function unbind() {
      input.removeEventListener("change", handler);
    };
  };

  // ---------------------------------------------------------------------------
  // Instance
  // ---------------------------------------------------------------------------

  function createInstance(options) {
    options = options || {};
    var els = options.elements || {};
    var hiddenInput = els.hiddenInput || null;
    var fileInput = els.fileInput || null;
    var infoText = els.infoText || null;
    var form = els.form || (hiddenInput ? hiddenInput.closest("form") : null) || (fileInput ? fileInput.closest("form") : null);

    var postUrl = options.url !== undefined ? options.url : options.postUrl;
    if (postUrl === undefined) {
      postUrl = "/path/to/upload.php";
    }

    var maxFileMB =
      options.maxFileMB !== undefined
        ? options.maxFileMB
        : options.maxFullSizeMB !== undefined
          ? options.maxFullSizeMB
          : 200;

    var self = {
      o: {
        postUrl: postUrl,
        fieldName: options.fieldName || (hiddenInput && hiddenInput.getAttribute("name")) || "",
        chunkSizeMB: options.chunkSizeMB !== undefined ? options.chunkSizeMB : 0.98,
        maxFileMB: maxFileMB,
        maxRetries: options.maxRetries !== undefined ? options.maxRetries : 3,
        formData: options.data !== undefined ? options.data : options.formData,
        downloadUrl:
          options.downloadUrl ||
          function (encoded) {
            return "/files/" + encoded;
          },
        decorateLabel: typeof options.decorateLabel === "function" ? options.decorateLabel : null,
        showRemove: options.showRemove !== false,
        linkNewUploads: options.linkNewUploads === true,
        imageExts: options.imageExts || DEFAULT_IMAGE_EXTS.slice(),
        elements: {
          form: form,
          fileInput: fileInput,
          hiddenInput: hiddenInput,
          infoText: infoText
        }
      },
      _listeners: {},
      _busy: false,
      _timedOut: false,
      _uploadTimeoutId: null,
      _uploadData: null,
      _tickProgressDebounce: null,
      chunkSizeBytes: 0,
      file: null,
      filename: "",
      filesize: -1,
      lastChunkNum: 1,
      method: "chunk",
      chunkProgressBytes: [],
      xhrs: [],
      _retryTimeoutIds: [],
      uploadGeneration: 0,
      abortedGeneration: -1,
      uploadStarted: 0,
      uploadDuration: 0,
      upSpeedMbps: 0,
      currentFilename: "",
      encodedFilename: "",
      currentUrl: "",
      ui: null,
      unsupported: null,
      readonly: false
    };

    self.chunkSizeBytes = 1000 * 1000 * self.o.chunkSizeMB;
    self._tickProgressDebounce = createThrottledUpdate(function (complete) {
      emitProgress(self, complete === true);
    }, 500);

    var canSlice =
      (typeof File !== "undefined" && File.prototype && typeof File.prototype.slice === "function") ||
      (typeof Blob !== "undefined" && Blob.prototype && typeof Blob.prototype.slice === "function");

    if (!global.Promise || !global.Blob || !global.FormData || canSlice === false) {
      self.unsupported =
        "Your browser appears to be outdated and does not support the upload mechanism being used.";
    }

    self.readonly = !!(hiddenInput && (hiddenInput.readOnly || hiddenInput.disabled));

    if (hiddenInput) {
      hiddenInput.bfu = self;
    }
    if (fileInput) {
      fileInput.bfu = self;
    }

    if (hiddenInput && hiddenInput.value) {
      setFilenameState(self, decodeHtmlEntities(hiddenInput.value), false);
    }

    attachPrototype(self);
    mountUi(self);
    syncFileInputEnabled(self);

    return self;
  }

  function attachPrototype(self) {
    self.on = function (type, fn) {
      if (!self._listeners[type]) {
        self._listeners[type] = [];
      }
      self._listeners[type].push(fn);
      return self;
    };
    self.off = function (type, fn) {
      var list = self._listeners[type];
      if (!list) {
        return self;
      }
      if (!fn) {
        self._listeners[type] = [];
        return self;
      }
      self._listeners[type] = list.filter(function (item) {
        return item !== fn;
      });
      return self;
    };
    self.emit = function (type, detail) {
      var list = self._listeners[type];
      if (!list || list.length === 0) {
        return;
      }
      var copy = list.slice();
      for (var i = 0; i < copy.length; i++) {
        copy[i].call(self, detail);
      }
    };
    self.isBusy = function () {
      return self._busy === true;
    };
    self.syncFileInputEnabled = function () {
      syncFileInputEnabled(self);
    };
    self.setReadonly = function (flag) {
      self.readonly = flag === true;
      syncFileInputEnabled(self);
      if (self.ui) {
        self.ui.renderLabel(true);
      }
      return self;
    };
    self.clearPendingSelection = function () {
      var fileInput = self.o.elements.fileInput;
      if (fileInput) {
        fileInput.value = null;
      }
      self.file = null;
      return self;
    };
    self.abort = function () {
      clearUploadTimeout(self);
      self._tickProgressDebounce.cancel();
      self.abortedGeneration = self.uploadGeneration;
      abortXhrsOnly(self);
      setBusy(self, false);
      self._uploadData = null;
      return self;
    };
    self.reset = function () {
      self.abort();
      self.clearPendingSelection();
      setFilenameState(self, "", true);
      if (self.ui) {
        self.ui.renderLabel(true);
      }
      return self;
    };
    self.upload = function (file, opts) {
      return runUpload(self, file, opts);
    };
  }

  function syncFileInputEnabled(self) {
    var fileInput = self.o.elements.fileInput;
    if (!fileInput) {
      return;
    }
    fileInput.disabled = self.readonly === true || self._busy === true;
  }

  function setBusy(self, busy) {
    if (self._busy === busy) {
      return;
    }
    self._busy = busy;
    var fileInput = self.o.elements.fileInput;
    if (fileInput) {
      if (busy) {
        fileInput.classList.add("inProgress");
      } else {
        fileInput.classList.remove("inProgress");
      }
    }
    adjustFormBusy(self.o.elements.form, busy ? 1 : -1);
    syncFormSubmitForForm(self.o.elements.form);
    syncFileInputEnabled(self);
    self.emit(busy ? "busy" : "idle");
  }

  function setFilenameState(self, filename, emitChange) {
    var prev = self.currentFilename;
    self.currentFilename = filename || "";
    self.encodedFilename = encodeURIComponent(self.currentFilename);
    self.currentUrl = self.currentFilename
      ? self.o.downloadUrl.call(self, self.encodedFilename)
      : "";
    if (self.o.elements.hiddenInput) {
      self.o.elements.hiddenInput.value = self.currentFilename;
    }
    if (emitChange === true && prev !== self.currentFilename) {
      self.emit("change", {
        fileName: self.currentFilename,
        url: self.currentUrl
      });
    }
  }

  function emitProgress(self, isComplete) {
    if (isComplete === true) {
      self._tickProgressDebounce.cancel();
      var uploadEnded = Date.now();
      self.uploadDuration = Number(((uploadEnded - self.uploadStarted) / 1000).toFixed(2));
      if (self.o.elements.fileInput) {
        self.o.elements.fileInput.value = null;
      }
      self.emit("progress", {
        pct: 100,
        mbps: self.upSpeedMbps,
        secsLeft: 0,
        complete: true,
        duration: self.uploadDuration
      });
      return;
    }

    if (self.chunkProgressBytes.length === 0) {
      return;
    }

    var bytesSum = 0;
    for (var i = 0; i < self.chunkProgressBytes.length; i++) {
      bytesSum += self.chunkProgressBytes[i];
    }
    var pct = self.filesize > 0 ? Math.min((bytesSum / self.filesize) * 100, 99.9) : 0;
    var elapsed = (Date.now() - self.uploadStarted) / 1000;
    var bps = elapsed ? bytesSum / elapsed : 0;
    var bytesLeft = Math.max(0, self.filesize - bytesSum);
    var upSpeedKBps = Math.ceil(bps / 1024);
    self.upSpeedMbps = (upSpeedKBps / 125).toFixed(2);
    var secsLeft =
      elapsed && bps > 0 ? Math.max(1, Math.ceil(bytesLeft / bps)) : "calculating";

    self.emit("progress", {
      pct: Number(pct.toFixed(1)),
      mbps: self.upSpeedMbps,
      secsLeft: secsLeft,
      complete: false
    });
  }

  function validateFile(self) {
    self.filename = self.file ? self.file.name : "";
    self.filesize = self.file ? self.file.size : 0;
    var dot = self.filename.lastIndexOf(".");
    var extension = dot === -1 ? "" : self.filename.slice(dot + 1);
    var maxBytes = self.o.maxFileMB * 1000 * 1000;

    if (!self.file) {
      throw "File could not be loaded.";
    }
    if (self.filename.length === 0) {
      throw "File name could not be detected.";
    }
    if (self.filesize <= 0) {
      throw "File size could not be detected.";
    }
    if (self.filesize > maxBytes) {
      throw (
        "File is too large. Please try again with a file smaller than " +
        self.o.maxFileMB +
        "MB."
      );
    }
    if (
      dot === -1 ||
      extension.length === 0 ||
      extension.length > 16 ||
      /^[A-Za-z0-9]+$/.test(extension) === false
    ) {
      throw "File must end with a type, such as .jpg or .jpeg";
    }
  }

  function clearUploadTimeout(self) {
    if (self._uploadTimeoutId !== null) {
      clearTimeout(self._uploadTimeoutId);
      self._uploadTimeoutId = null;
    }
  }

  function clearChunkRetries(self) {
    if (!self._retryTimeoutIds || self._retryTimeoutIds.length === 0) {
      self._retryTimeoutIds = [];
      return;
    }
    self._retryTimeoutIds.forEach(function (entry) {
      clearTimeout(entry.id);
      if (typeof entry.reject === "function") {
        entry.reject(ABORTED);
      }
    });
    self._retryTimeoutIds = [];
  }

  function abortXhrsOnly(self) {
    clearChunkRetries(self);
    if (self.xhrs && self.xhrs.length > 0) {
      self.xhrs.forEach(function (xhr) {
        if (xhr && xhr.readyState !== 4 && typeof xhr.abort === "function") {
          xhr.abort();
        }
      });
      self.xhrs = [];
    }
  }

  function isStaleOrAborted(self, generation) {
    return generation !== self.uploadGeneration || self.abortedGeneration === generation;
  }

  function throwIfStale(self, generation) {
    if (isStaleOrAborted(self, generation) === true) {
      throw self._timedOut ? TIMEOUT : ABORTED;
    }
  }

  function emitError(self, err) {
    var message = errMessage(err);
    self.emit("error", { message: message, error: err });
    return message;
  }

  function endAttempt(self, err) {
    clearUploadTimeout(self);
    abortXhrsOnly(self);
    self._tickProgressDebounce.cancel();
    setBusy(self, false);
    self._uploadData = null;
    if (err === TIMEOUT) {
      emitError(self, TIMEOUT);
      throw TIMEOUT;
    }
    if (err === ABORTED) {
      throw ABORTED;
    }
    emitError(self, err);
    throw err;
  }

  function mergeFormData(self, formData) {
    var extra = self.o.formData;
    if (typeof extra === "function") {
      extra = extra.call(self);
    }
    if (extra && typeof extra === "object") {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) {
        formData.append(keys[i], extra[keys[i]]);
      }
    }
    var session = self._uploadData;
    if (session && typeof session === "object") {
      var sessionKeys = Object.keys(session);
      for (var s = 0; s < sessionKeys.length; s++) {
        formData.append(sessionKeys[s], session[sessionKeys[s]]);
      }
    }
  }

  function uploadChunk(self, myChunkNum, myAction, retryNum) {
    var generation = self.uploadGeneration;
    var progressIdx = myChunkNum - 1;
    var lengthComputable = false;
    var formData = new FormData();
    var start = (myChunkNum - 1) * self.chunkSizeBytes;
    var end = Math.min(start + self.chunkSizeBytes, self.filesize);
    var myChunkByteLen = end - start;

    if (retryNum === undefined) {
      retryNum = 0;
    }

    if (isStaleOrAborted(self, generation) === true) {
      return Promise.reject(ABORTED);
    }

    formData.append("file_name", self.filename);
    formData.append("file_size", self.filesize);
    formData.append("file_chunk", myChunkNum);
    formData.append("file_chunk_max", self.lastChunkNum);
    formData.append("chunk_action", myAction);
    formData.append("chunk_method", self.method);
    formData.append("retry_num", retryNum);
    mergeFormData(self, formData);

    if (myAction === "sendChunk") {
      if (self.method === "chunk") {
        formData.append("file", self.file.slice(start, end));
      } else {
        formData.append("file", self.file);
      }
    }

    return new Promise(function (resolve, reject) {
      if (isStaleOrAborted(self, generation) === true) {
        reject(ABORTED);
        return;
      }

      var xhr = new XMLHttpRequest();
      xhr.open("POST", self.o.postUrl);
      xhr.responseType = "text";

      xhr.upload.addEventListener(
        "progress",
        function (e) {
          if (isStaleOrAborted(self, generation) === true) {
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
        if (isStaleOrAborted(self, generation) === true) {
          reject(ABORTED);
          return;
        }
        fail(TRANSPORT_ERROR);
      };

      xhr.onabort = function () {
        reject(ABORTED);
      };

      xhr.onload = function () {
        if (isStaleOrAborted(self, generation) === true) {
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

        if (myAction === "initFile") {
          self.filename = data.file_name;
        } else if (myAction === "sendChunk") {
          if (!lengthComputable) {
            self.chunkProgressBytes[progressIdx] = myChunkByteLen;
            self._tickProgressDebounce(false);
          }
        } else if (myAction === "combineChunks") {
          emitProgress(self, true);
        }

        resolve(data);
      };

      function fail(textStatus) {
        if (isStaleOrAborted(self, generation) === true) {
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
            if (isStaleOrAborted(self, retryGeneration) === true) {
              reject(ABORTED);
              return;
            }
            uploadChunk(self, myChunkNum, myAction, retryNum).then(resolve, reject);
          }, retryNum * 1000);
          self._retryTimeoutIds.push(entry);
          return;
        }

        reject(textStatus || TRANSPORT_ERROR);
      }

      self.xhrs = self.xhrs.filter(function (x) {
        return x && x.readyState !== 4;
      });
      self.xhrs.push(xhr);
      xhr.send(formData);
    });
  }

  function finishSuccess(self, fileName) {
    clearUploadTimeout(self);
    setFilenameState(self, fileName, true);
    setBusy(self, false);
    self._uploadData = null;
    var payload = {
      fileName: fileName,
      duration: self.uploadDuration,
      url: self.currentUrl
    };
    self.emit("complete", payload);
    return payload;
  }

  async function runFullFallback(self, generation) {
    abortXhrsOnly(self);
    self.method = "full";
    self.lastChunkNum = 1;
    self.chunkProgressBytes = [0];
    self.xhrs = [];

    await uploadChunk(self, 0, "initFile", 0);
    throwIfStale(self, generation);

    self.uploadStarted = Date.now();
    await uploadChunk(self, 1, "sendChunk", 0);
    throwIfStale(self, generation);

    var combineData = await uploadChunk(self, 1, "combineChunks", 0);
    throwIfStale(self, generation);

    return finishSuccess(self, combineData.file_name);
  }

  async function runUpload(self, file, opts) {
    opts = opts || {};
    var timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 0;

    if (file) {
      self.file = normalizeFile(file);
    }

    if (opts.data && typeof opts.data === "object") {
      self._uploadData = Object.assign({}, opts.data);
    } else {
      self._uploadData = null;
    }

    if (self.unsupported) {
      emitError(self, self.unsupported);
      throw self.unsupported;
    }

    if (self._busy === true) {
      var busyErr = "An upload is already in progress.";
      emitError(self, busyErr);
      throw busyErr;
    }

    self.method = "chunk";

    try {
      validateFile(self);
    } catch (err) {
      emitError(self, err);
      throw err;
    }

    self.uploadGeneration++;
    var generation = self.uploadGeneration;

    self._timedOut = false;
    self.chunkProgressBytes = [];
    self.xhrs = [];
    clearChunkRetries(self);
    clearUploadTimeout(self);

    self.lastChunkNum = Math.max(1, Math.ceil(self.filesize / self.chunkSizeBytes));
    for (var i = 0; i < self.lastChunkNum; i++) {
      self.chunkProgressBytes[i] = 0;
    }

    if (timeoutMs > 0) {
      self._uploadTimeoutId = setTimeout(function () {
        self._timedOut = true;
        self.abortedGeneration = self.uploadGeneration;
        abortXhrsOnly(self);
        clearUploadTimeout(self);
      }, timeoutMs);
    }

    setBusy(self, true);

    try {
      await uploadChunk(self, 0, "initFile", 0);
      throwIfStale(self, generation);

      self.uploadStarted = Date.now();

      for (var n = 1; n <= self.lastChunkNum; n++) {
        await uploadChunk(self, n, "sendChunk", 0);
        throwIfStale(self, generation);
      }

      var combineData = await uploadChunk(self, self.lastChunkNum, "combineChunks", 0);
      throwIfStale(self, generation);

      return finishSuccess(self, combineData.file_name);
    } catch (err) {
      if (generation !== self.uploadGeneration) {
        throw self._timedOut ? TIMEOUT : ABORTED;
      }

      var finalErr = self._timedOut ? TIMEOUT : err;

      if (finalErr === ABORTED || finalErr === TIMEOUT) {
        endAttempt(self, finalErr);
      }

      if (finalErr === TRANSPORT_ERROR && self.method === "chunk") {
        try {
          return await runFullFallback(self, generation);
        } catch (fallbackErr) {
          finalErr = self._timedOut ? TIMEOUT : fallbackErr;
          if (finalErr === ABORTED || finalErr === TIMEOUT) {
            endAttempt(self, finalErr);
          }
        }
      }

      endAttempt(self, finalErr);
    }
  }

  // ---------------------------------------------------------------------------
  // Default UI (always mounted)
  // ---------------------------------------------------------------------------

  function defaultLinkClass(filename, imageExts) {
    var ext = (filename.split(".").pop() || "").toLowerCase();
    return BompusFileUpload.isImageExt(ext, imageExts) ? "imgLink" : "downloadLink";
  }

  function mountUi(self) {
    var infoText = self.o.elements.infoText;
    var linkNewUploads = self.o.linkNewUploads === true;
    var showRemove = self.o.showRemove !== false;
    var imageExts = self.o.imageExts;
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
      if (self.isBusy() !== true) {
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
      var fileInput = self.o.elements.fileInput;

      if (!self.currentFilename) {
        if (self.readonly === true) {
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
      wrap.className = self.readonly ? "bfu-dl-readonly" : "bfu-dl-editable";

      var showLink = fromInit === true || linkNewUploads === true;
      if (showLink === true) {
        var dl = document.createElement("a");
        dl.target = "_blank";
        dl.className = "bfu-dl " + defaultLinkClass(self.currentFilename, imageExts);
        dl.href = self.currentUrl;
        dl.textContent = self.currentFilename;
        wrap.appendChild(dl);
      } else {
        var span = document.createElement("span");
        span.textContent = self.currentFilename;
        wrap.appendChild(span);
      }

      function appendDivider() {
        var divider = document.createElement("span");
        divider.className = "bfu-dl-divider";
        divider.innerHTML = "&nbsp;&nbsp;";
        wrap.appendChild(divider);
      }

      if (self.readonly !== true && typeof self.o.decorateLabel === "function") {
        var actions = self.o.decorateLabel(wrap, {
          fromInit: fromInit === true,
          filename: self.currentFilename,
          uploader: self,
          appendDivider: appendDivider
        });
        if (actions && actions.length) {
          for (var a = 0; a < actions.length; a++) {
            if (!actions[a]) {
              continue;
            }
            appendDivider();
            wrap.appendChild(actions[a]);
          }
        }
      }

      if (self.readonly !== true && showRemove === true) {
        appendDivider();
        var remove = document.createElement("a");
        remove.className = "bfu-remove";
        remove.href = "#";
        remove.textContent = "Remove";
        remove.addEventListener("click", function (e) {
          e.preventDefault();
          self.reset();
        });
        wrap.appendChild(remove);
      }

      setInfoNode(wrap);
      setDisplay(fileInput, false);
    }

    self.on("busy", function () {
      if (statusActive !== true) {
        showProgressShell();
      }
    });

    self.on("progress", function (detail) {
      if (!barFill || !barText || statusActive === true) {
        return;
      }
      barFill.style.width = detail.pct + "%";
      var secs = detail.complete === true ? "0" : detail.secsLeft;
      barText.textContent = [detail.pct + "%", detail.mbps + " Mbps", secs + " seconds remaining"].join(
        " | "
      );
    });

    self.on("complete", function () {
      renderLabel(false);
    });

    self.on("change", function () {
      if (self.isBusy() !== true && statusActive !== true) {
        renderLabel(true);
      }
    });

    self.on("error", function (detail) {
      var err = document.createElement("span");
      err.className = "bfu-error";
      err.textContent =
        "Error: " + String(detail && detail.message ? detail.message : "Unknown error.");
      setInfoNode(err);
      if (self.readonly !== true) {
        var fileInput = self.o.elements.fileInput;
        setDisplay(fileInput, true);
        if (fileInput) {
          fileInput.value = null;
        }
      }
    });

    renderLabel(true);

    self.ui = {
      setStatus: setStatus,
      clearStatus: clearStatus,
      renderLabel: renderLabel,
      clearInfo: clearInfo
    };
  }

  /**
   * Mount a field. Pass elements explicitly (preferred) or a root Element that
   * contains [data-bfu-file], [data-bfu-hidden], and optional [data-bfu-text].
   */
  BompusFileUpload.mount = function (rootOrOpts, maybeOpts) {
    var options;
    if (rootOrOpts && rootOrOpts.nodeType === 1) {
      options = Object.assign({}, maybeOpts || {});
      var root = rootOrOpts;
      options.elements = Object.assign({}, options.elements || {}, {
        fileInput: (options.elements && options.elements.fileInput) || root.querySelector("input[type=file][data-bfu-file]"),
        hiddenInput:
          (options.elements && options.elements.hiddenInput) ||
          root.querySelector("input[type=hidden][data-bfu-hidden]"),
        infoText:
          (options.elements && options.elements.infoText) || root.querySelector("div[data-bfu-text]"),
        form: (options.elements && options.elements.form) || root.closest("form")
      });
    } else {
      options = rootOrOpts || {};
    }
    return createInstance(options);
  };

  global.BompusFileUpload = BompusFileUpload;
})(typeof window !== "undefined" ? window : this);
