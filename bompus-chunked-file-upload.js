/*!
 * Bompus Chunked File Upload v2.1.0
 * https://github.com/bompus/bompus-chunked-file-upload
 *
 * Headless chunked upload engine + optional mountDefaultUi.
 * Requires: Promise/async-await, Blob/File.slice, FormData, XMLHttpRequest upload.
 * No jQuery.
 *
 * Copyright Aaron Queen
 */

(function (global) {
  "use strict";

  var SKIP_UPLOAD = Object.freeze({ skipUpload: true });
  var ABORTED = Object.freeze({ __bfuAborted: true });


  function createThrottledUpdate(fn, wait) {
    var interval = null;
    var lastCall = null;

    function cancel() {
      clearInterval(interval);
      interval = null;
      lastCall = null;
    }

    function caller() {
      if (interval) {
        return;
      }
      lastCall();
      lastCall = null;
      interval = setInterval(function () {
        if (lastCall) {
          lastCall();
          lastCall = null;
        } else {
          cancel();
        }
      }, wait);
    }

    var rtn = function () {
      var args = arguments;
      lastCall = function () {
        fn.apply(null, args);
      };
      caller();
    };
    rtn.cancel = cancel;
    return rtn;
  }

  async function mapLimit(count, limit, worker, onFirstError) {
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
            if (typeof onFirstError === "function") {
              onFirstError();
            }
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
    if (typeof err === "string") {
      return err;
    }
    if (err && err.message) {
      return err.message;
    }
    return String(err);
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
    var hiddenInput =
      (options.elements && options.elements.hiddenInput) ||
      document.querySelector('input[type=hidden][data-bfu-hidden="' + fieldName + '"]');
    var fileInput =
      (options.elements && options.elements.fileInput) ||
      document.querySelector('input[type=file][data-bfu-file="' + fieldName + '"]');
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
      downloadUrl: options.downloadUrl || function (encoded) {
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
    this._boundDisableFormSubmit = this._disableFormSubmit.bind(this);
    this._boundFileInputChange = this._onFileInputChange.bind(this);
    this._tickProgressDebounce = createThrottledUpdate(this._emitProgress.bind(this), 500);

    this.chunkSizeBytes = 1000 * 1000 * this.o.chunkSizeMB;
    this.file = null;
    this.filename = "";
    this.filesize = -1;
    this.lastChunkNum = 1;
    this.method = "chunk";
    this.chunkProgressPct = [];
    this.chunkProgressBytes = [];
    this.xhrs = [];
    this.uploadGeneration = 0;
    this.abortedGeneration = -1;
    this.uploadStarted = 0;
    this.uploadEnded = 0;
    this.uploadDuration = 0;
    this.bytesLeft = 0;
    this.secsLeft = 0;
    this.upSpeedKBps = 0;
    this.upSpeedMbps = 0;
    this.currentFilename = "";
    this.encodedFilename = "";
    this.currentUrl = "";

    var hiddenEl = this.o.elements.hiddenInput;
    this.readonly = !!(hiddenEl && (hiddenEl.readOnly || hiddenEl.disabled));

    if (!global.Promise || !global.Blob || !global.FormData || canSlice === false) {
      this.emit("error", {
        message:
          "Your browser appears to be outdated and does not support the upload mechanism being used."
      });
      return this;
    }

    if (hiddenEl && hiddenEl.value) {
      this._setFilenameState(decodeHtmlEntities(hiddenEl.value));
    }

    if (fileInput) {
      fileInput.addEventListener("change", this._boundFileInputChange);
    }

    return this;
  }

  BompusFileUpload.SKIP_UPLOAD = SKIP_UPLOAD;
  BompusFileUpload.ABORTED = ABORTED;

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

  BompusFileUpload.prototype._disableFormSubmit = function (e) {
    e.preventDefault();
    return false;
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
        fileInput.disabled = true;
      } else {
        fileInput.classList.remove("inProgress");
        if (this.readonly !== true) {
          fileInput.disabled = false;
        }
      }
    }
    this._syncFormSubmit();
    this.emit(busy ? "busy" : "idle");
  };

  BompusFileUpload.prototype._syncFormSubmit = function () {
    var form = this.o.elements.form;
    var anyBusy = this._busy;
    if (form) {
      anyBusy = form.querySelectorAll("input[type=file].inProgress").length > 0;
    }
    if (!this.o.elements.formSubmitBtn && form) {
      this.o.elements.formSubmitBtn = form.querySelector("[type=submit]");
    }
    var submitBtn = this.o.elements.formSubmitBtn;
    if (anyBusy) {
      if (form) {
        form.removeEventListener("submit", this._boundDisableFormSubmit);
        form.addEventListener("submit", this._boundDisableFormSubmit);
      }
      if (submitBtn) {
        submitBtn.disabled = true;
      }
    } else {
      if (form) {
        form.removeEventListener("submit", this._boundDisableFormSubmit);
      }
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
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
    var pct = 0;
    var detail;

    if (isComplete === true) {
      this._tickProgressDebounce.cancel();
      this.uploadEnded = Date.now();
      this.uploadDuration = Number(((this.uploadEnded - this.uploadStarted) / 1000).toFixed(2));
      if (this.o.elements.fileInput) {
        this.o.elements.fileInput.value = null;
      }
      detail = {
        pct: 100,
        mbps: this.upSpeedMbps,
        secsLeft: 0,
        complete: true,
        duration: this.uploadDuration
      };
      this.emit("progress", detail);
      return;
    }

    var chunkCount = this.chunkProgressPct.length;
    if (chunkCount === 0) {
      return;
    }

    var pctSum = this.chunkProgressPct.reduce(function (a, b) {
      return a + b;
    }, 0);
    pct = Math.min(pctSum / chunkCount, 99.9);

    var bytesSum = this.chunkProgressBytes.reduce(function (a, b) {
      return a + b;
    }, 0);
    var elapsed = (Date.now() - this.uploadStarted) / 1000;
    var bps = elapsed ? bytesSum / elapsed : 0;

    this.bytesLeft = Math.max(0, this.filesize - bytesSum);
    this.upSpeedKBps = Math.ceil(bps / 1024);
    this.upSpeedMbps = (this.upSpeedKBps / 125).toFixed(2);
    if (elapsed && bps > 0) {
      this.secsLeft = Math.max(1, Math.ceil(this.bytesLeft / bps));
    } else {
      this.secsLeft = "calculating";
    }

    this.emit("progress", {
      pct: Number(pct.toFixed(1)),
      mbps: this.upSpeedMbps,
      secsLeft: this.secsLeft,
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
    if (dot === -1 || extension.length === 0 || extension.length > 16 || /^[A-Za-z0-9]+$/.test(extension) === false) {
      throw "File must end with a type, such as .jpg or .jpeg";
    }
  };

  BompusFileUpload.prototype._onFileInputChange = async function (e) {
    e.preventDefault();
    var fileInput = this.o.elements.fileInput;
    this.file = fileInput && fileInput.files ? fileInput.files[0] : null;
    this.method = "chunk";

    try {
      if (typeof this.o.beforeUpload === "function") {
        var result = await this.o.beforeUpload.call(this);
        if (result === SKIP_UPLOAD) {
          return;
        }
      }
      await this.upload();
    } catch (err) {
      if (err === ABORTED) {
        return;
      }
      var message = errMessage(err);
      this.emit("error", { message: message, error: err });
    }
  };

  BompusFileUpload.prototype.pruneFinishedXhrs = function () {
    if (!this.xhrs || this.xhrs.length === 0) {
      return;
    }
    this.xhrs = this.xhrs.filter(function (xhr) {
      return xhr && xhr.readyState !== 4;
    });
  };

  BompusFileUpload.prototype.abort = function () {
    this.abortedGeneration = this.uploadGeneration;
    if (this.xhrs && this.xhrs.length > 0) {
      this.xhrs.forEach(function (xhr) {
        if (xhr && xhr.readyState !== 4 && typeof xhr.abort === "function") {
          xhr.abort();
        }
      });
      this.xhrs = [];
    }
    this._setBusy(false);
  };

  // Back-compat alias used by some callers / docs during migration
  BompusFileUpload.prototype.abortPendingUploads = function () {
    this.abort();
  };

  BompusFileUpload.prototype.isStaleOrAborted = function (generation) {
    return generation !== this.uploadGeneration || this.abortedGeneration === generation;
  };

  BompusFileUpload.prototype.reset = function () {
    this.abort();
    this.file = null;
    this.method = "chunk";
    this._setFilenameState("");
    if (this.o.elements.fileInput && this.readonly !== true) {
      this.o.elements.fileInput.value = null;
    }
    this._setBusy(false);
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

  BompusFileUpload.prototype.upload_chunk = function (myChunkNum, myAction, retryNum) {
    var self = this;
    var generation = this.uploadGeneration;
    var progressIdx = myChunkNum - 1;
    var lengthComputable = false;
    var formData = new FormData();
    var start = (myChunkNum - 1) * this.chunkSizeBytes;
    var end = Math.min(start + this.chunkSizeBytes, this.filesize);
    var myChunkByteLen = end - start;

    if (retryNum === undefined) {
      retryNum = 0;
    }

    if (self.isStaleOrAborted(generation) === true) {
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
        if (this.file.size > this.o.maxFullSizeMB * 1024 * 1024) {
          return Promise.reject(
            "File is too large. Please try again with a file smaller than " + this.o.maxFullSizeMB + "MB."
          );
        }
        formData.append("file", this.file);
      }
    }

    return new Promise(function (resolve, reject) {
      if (self.isStaleOrAborted(generation) === true) {
        reject(ABORTED);
        return;
      }

      var xhr = new XMLHttpRequest();
      xhr.open("POST", self.o.postUrl);
      xhr.responseType = "text";

      xhr.upload.addEventListener(
        "progress",
        function (e) {
          if (self.isStaleOrAborted(generation) === true) {
            return;
          }
          lengthComputable = e.lengthComputable;
          if (lengthComputable && myAction === "sendChunk") {
            self.chunkProgressBytes[progressIdx] = e.loaded;
            self.chunkProgressPct[progressIdx] = (e.loaded / e.total) * 100;
            self._tickProgressDebounce(false);
          }
        },
        false
      );

      xhr.onerror = function () {
        if (self.isStaleOrAborted(generation) === true) {
          reject(ABORTED);
          return;
        }
        fail("error");
      };

      xhr.onabort = function () {
        reject(ABORTED);
      };

      xhr.onload = function () {
        if (self.isStaleOrAborted(generation) === true) {
          reject(ABORTED);
          return;
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          fail("error");
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
              self.chunkProgressPct[progressIdx] = 100;
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
        if (self.isStaleOrAborted(generation) === true) {
          reject(ABORTED);
          return;
        }

        if (self.method === "chunk" && myAction === "sendChunk" && retryNum < self.o.maxRetries) {
          retryNum++;
          setTimeout(function () {
            self.upload_chunk(myChunkNum, myAction, retryNum).then(resolve, reject);
          }, retryNum * 1000);
          return;
        }

        reject(textStatus || "error");
      }

      self.pruneFinishedXhrs();
      self.xhrs.push(xhr);
      xhr.send(formData);
    });
  };

  BompusFileUpload.prototype.upload = async function (file) {
    if (file) {
      this.file = file;
    }
    this.method = this.method || "chunk";
    this._validateFile();

    this.uploadGeneration++;
    var generation = this.uploadGeneration;

    this.chunkProgressPct = [];
    this.chunkProgressBytes = [];
    this.xhrs = [];

    if (this.method === "chunk") {
      this.lastChunkNum = Math.max(1, Math.ceil(this.filesize / this.chunkSizeBytes));
    } else {
      this.lastChunkNum = 1;
    }

    for (var i = 0; i < this.lastChunkNum; i++) {
      this.chunkProgressPct[i] = 0;
      this.chunkProgressBytes[i] = 0;
    }

    this._setBusy(true);

    try {
      await this.upload_chunk(0, "initFile", 0);

      if (this.isStaleOrAborted(generation) === true) {
        throw ABORTED;
      }

      this.uploadStarted = Date.now();

      var self = this;
      await mapLimit(
        this.lastChunkNum,
        this.o.parallelLimit,
        function (n) {
          return self.upload_chunk(n + 1, "sendChunk", 0);
        },
        function () {
          self.abort();
        }
      );

      if (this.isStaleOrAborted(generation) === true) {
        throw ABORTED;
      }

      var combineData = await this.upload_chunk(this.lastChunkNum, "combineChunks", 0);

      if (this.isStaleOrAborted(generation) === true) {
        throw ABORTED;
      }

      this._setFilenameState(combineData.file_name);
      this._setBusy(false);

      var payload = {
        fileName: combineData.file_name,
        duration: this.uploadDuration,
        url: this.currentUrl
      };
      this.emit("complete", payload);
      return payload;
    } catch (err) {
      if (generation !== this.uploadGeneration) {
        throw ABORTED;
      }

      if (err !== ABORTED) {
        this.abort();
      } else {
        this._setBusy(false);
      }

      if (err === ABORTED) {
        throw err;
      }

      var errStr = errMessage(err);

      if (errStr.indexOf("Unknown Error") === -1 && this.method === "chunk") {
        this.method = "full";
        return await this.upload();
      }

      this._setBusy(false);
      this.emit("error", { message: errStr, error: err });
      throw err;
    }
  };

  // Alias
  BompusFileUpload.prototype.upload_file = function (file) {
    return this.upload(file);
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
    for (var i = 0; i < imageExts.length; i++) {
      if (imageExts[i] === ext) {
        return "imgLink";
      }
    }
    return "downloadLink";
  }

  BompusFileUpload.mountDefaultUi = function (uploader, uiOpts) {
    uiOpts = uiOpts || {};
    var fieldName = uploader.o.fieldName;
    var infoText =
      uiOpts.infoText ||
      document.querySelector('div[data-bfu-text="' + fieldName + '"]');
    var linkNewUploads = uiOpts.linkNewUploads === true;
    var showRemove = uiOpts.showRemove !== false;
    var imageExts = uiOpts.imageExts || ["jpg", "jpeg", "png", "gif", "webp"];
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
      if (uploader._busy !== true) {
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

      var pre = document.createElement("span");
      pre.className = "bfu-dl-pre";
      wrap.appendChild(pre);

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
        remove.target = "_blank";
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

    uploader.on("idle", function () {
      // label / error handlers refresh UI; avoid wiping mid-status
    });

    uploader.on("complete", function () {
      renderLabel(false);
    });

    uploader.on("error", function (detail) {
      var err = document.createElement("span");
      err.className = "bfu-error";
      err.textContent = "Error: " + String(detail && detail.message ? detail.message : "Unknown error.");
      setInfoNode(err);
      if (uploader.readonly !== true) {
        setDisplay(uploader.o.elements.fileInput, true);
        if (uploader.o.elements.fileInput) {
          uploader.o.elements.fileInput.value = null;
        }
      }
    });

    // Initial paint
    if (uploader.currentFilename) {
      renderLabel(true);
    } else if (uploader.readonly === true) {
      renderLabel(true);
    }

    return {
      setStatus: setStatus,
      clearStatus: clearStatus,
      renderLabel: renderLabel,
      clearInfo: clearInfo
    };
  };

  global.BompusFileUpload = BompusFileUpload;
})(typeof globalThis !== "undefined" ? globalThis : window);
