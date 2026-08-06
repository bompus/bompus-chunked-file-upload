/*!
 * Bompus Chunked File Upload v2.0.0
 * https://github.com/bompus/bompus-chunked-file-upload
 *
 * Requires: modern browser with Promise + async/await, Blob/File.slice, FormData, XMLHttpRequest upload
 * No jQuery.
 *
 * Copyright Aaron Queen
 */

// some tests on my 1 gigabit connection for a 96MB file
// 500KB, 5  parallel = 18 seconds
// 980KB, 1  parallel = ???
// 980KB, 3  parallel = 21 seconds
// 980KB, 5  parallel = 15 seconds ***** THE CHOSEN DEFAULT *****
// 980KB, 10 parallel = 17 seconds
// 2MB,   5  parallel = 14 seconds, random lag spikes, tests above 2MB also showed these random lag spikes

(function (global) {
  "use strict";

  var SKIP_UPLOAD = Object.freeze({ skipUpload: true });
  var ABORTED = Object.freeze({ __bfuAborted: true });

  function deepMerge(target, source) {
    if (source === null || source === undefined) {
      return target;
    }
    var out = target;
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var srcVal = source[key];
      if (srcVal && typeof srcVal === "object" && srcVal.constructor === Object) {
        if (!out[key] || typeof out[key] !== "object" || out[key].constructor !== Object) {
          out[key] = {};
        }
        deepMerge(out[key], srcVal);
      } else {
        out[key] = srcVal;
      }
    }
    return out;
  }

  function decodeHtmlEntities(str) {
    var ta = document.createElement("textarea");
    ta.innerHTML = str;
    return ta.value;
  }

  function setDisplay(el, visible) {
    if (!el) {
      return;
    }
    el.style.display = visible ? "" : "none";
  }

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

  function BompusFileUpload(options) {
    if (this instanceof BompusFileUpload === false) {
      return new BompusFileUpload(options);
    }

    var fieldName = options.fieldName !== undefined ? options.fieldName : "bompus-file-1";
    var hiddenInput = document.querySelector('input[type=hidden][data-bfu-hidden="' + fieldName + '"]');
    var form = hiddenInput ? hiddenInput.closest("form") : null;

    this.o = deepMerge(
      {
        postUrl: "/path/to/upload.php",
        fieldName: fieldName,
        chunkSizeMB: 0.98,
        parallelLimit: 5,
        maxFullSizeMB: 20,
        maxRetries: 3,

        elements: {
          form: form,
          formSubmitBtn: form ? form.querySelector("[type=submit]") : null,
          infoText: document.querySelector('div[data-bfu-text="' + fieldName + '"]'),
          fileInput: document.querySelector('input[type=file][data-bfu-file="' + fieldName + '"]'),
          hiddenInput: hiddenInput
        },

        hooks: {
          getFileDownloadUrl: function (uriEncodedFilename) {
            return "/files/" + uriEncodedFilename;
          },
          getFileDownloadLinkClassName: function (uriEncodedFilename) {
            var linkClass = "downloadLink";
            var re = /(?:\.([^.]+))?$/;
            var extMatch = re.exec(uriEncodedFilename);
            var ext = (extMatch && extMatch[1] ? extMatch[1] : "").toLowerCase();
            if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "gif" || ext === "webp") {
              linkClass = "imgLink";
            }
            return linkClass;
          },
          setText: function (fromInit, dlEl, removeEl) {
            var tmpElm = document.createElement("div");
            tmpElm.style.cssFloat = "left";
            tmpElm.className = this.readonly ? "bfu-dl-readonly" : "bfu-dl-editable";

            var pre = document.createElement("span");
            pre.className = "bfu-dl-pre";
            tmpElm.appendChild(pre);
            tmpElm.appendChild(dlEl);

            if (this.readonly === false) {
              var divider = document.createElement("span");
              divider.className = "bfu-dl-divider";
              divider.innerHTML = "&nbsp;&nbsp;";
              tmpElm.appendChild(divider);
              tmpElm.appendChild(removeEl);
            }

            this.setInfoText(tmpElm);
          },
          fileSelected: function () {},
          beforeChunkSend: function (formData) {},
          progressStart: function () {},
          progressEnd: function () {},
          uploadComplete: function () {}
        }
      },
      options
    );

    var canSlice =
      (typeof File !== "undefined" && File.prototype && typeof File.prototype.slice === "function") ||
      (typeof Blob !== "undefined" && Blob.prototype && typeof Blob.prototype.slice === "function");

    if (!global.Promise || !global.Blob || !global.FormData || canSlice === false) {
      this.setInfoText(
        'Your browser appears to be outdated and does not support the upload mechanism being used. Please upgrade your browser to the latest version or use <a class="bluea" target="_blank" href="https://www.google.com/chrome/">Google Chrome</a> browser for the best experience.'
      );
      return;
    }

    this.chunkSizeBytes = 1000 * 1000 * this.o.chunkSizeMB;

    var hiddenVal = this.o.elements.hiddenInput ? this.o.elements.hiddenInput.value : "";
    this.currentFilename = decodeHtmlEntities(hiddenVal);

    var hiddenEl = this.o.elements.hiddenInput;
    this.readonly = !!(hiddenEl && (hiddenEl.readOnly || hiddenEl.disabled));

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
    this.bfuBarFill = null;
    this.bfuBarText = null;
    this._hookProgressActive = false;
    this._boundDisableFormSubmit = this.disableFormSubmitEvent.bind(this);
    this._boundFileInputChange = this.onFileInputChange.bind(this);

    if (this.currentFilename.length === 0) {
      this.reset();
    } else {
      this.setText(this.currentFilename, true);
    }

    this.tickProgressDebounce = createThrottledUpdate(this.tickProgress.bind(this), 500);

    if (this.o.elements.fileInput) {
      this.o.elements.fileInput.addEventListener("change", this._boundFileInputChange);
    }

    return this;
  }

  BompusFileUpload.SKIP_UPLOAD = SKIP_UPLOAD;
  BompusFileUpload.ABORTED = ABORTED;

  BompusFileUpload.prototype.disableFormSubmitEvent = function (e) {
    e.preventDefault();
    return false;
  };

  BompusFileUpload.prototype.pruneFinishedXhrs = function () {
    if (!this.xhrs || this.xhrs.length === 0) {
      return;
    }
    this.xhrs = this.xhrs.filter(function (xhr) {
      return xhr && xhr.readyState !== 4;
    });
  };

  BompusFileUpload.prototype.abortPendingUploads = function () {
    this.abortedGeneration = this.uploadGeneration;
    if (!this.xhrs || this.xhrs.length === 0) {
      return;
    }
    this.xhrs.forEach(function (xhr) {
      if (xhr && xhr.readyState !== 4 && typeof xhr.abort === "function") {
        xhr.abort();
      }
    });
    this.xhrs = [];
  };

  BompusFileUpload.prototype.isStaleOrAborted = function (generation) {
    return generation !== this.uploadGeneration || this.abortedGeneration === generation;
  };

  BompusFileUpload.prototype.releaseUploadControls = function () {
    var fileInput = this.o.elements.fileInput;
    if (fileInput) {
      fileInput.classList.remove("inProgress");
    }
    this.toggleFormSubmit();
    if (this.readonly !== true && fileInput) {
      fileInput.disabled = false;
      setDisplay(fileInput, true);
      fileInput.value = null;
    }
  };

  BompusFileUpload.prototype.resetProgress = function () {
    this.setInfoText(
      '<div class="bfu-bar"><div class="bfu-bar-fill"></div><div class="bfu-bar-text">0.0% | 0.00 Mbps | calculating remaining</div></div>'
    );
    var info = this.o.elements.infoText;
    this.bfuBarFill = info ? info.querySelector(".bfu-bar-fill") : null;
    this.bfuBarText = info ? info.querySelector(".bfu-bar-text") : null;
  };

  BompusFileUpload.prototype.beginUploadAfterFileSelected = function () {
    this.filename = this.file ? this.file.name : "";
    this.filesize = this.file ? this.file.size : 0;

    var dot = this.filename.lastIndexOf(".");
    var extension = dot === -1 ? "" : this.filename.slice(dot + 1);

    if (!this.file) {
      return this.setError("File could not be loaded.");
    }
    if (this.filename.length === 0) {
      return this.setError("File name could not be detected.");
    }
    if (this.filesize <= 0) {
      return this.setError("File size could not be detected.");
    }
    if (dot === -1 || extension.length === 0 || extension.length > 16 || /^[A-Za-z0-9]+$/.test(extension) === false) {
      return this.setError("File must end with a type, such as .jpg or .jpeg");
    }

    var fileInput = this.o.elements.fileInput;
    if (fileInput) {
      fileInput.disabled = true;
      fileInput.classList.add("inProgress");
    }
    this.resetProgress();
    this.toggleFormSubmit();
    return this.upload_file();
  };

  BompusFileUpload.prototype.onFileInputChange = function (e) {
    var self = this;

    e.preventDefault();

    var fileInput = this.o.elements.fileInput;
    this.file = fileInput && fileInput.files ? fileInput.files[0] : null;
    this.method = "chunk";

    Promise.resolve(this.o.hooks.fileSelected.call(this))
      .then(function (result) {
        if (result === SKIP_UPLOAD) {
          return;
        }
        return self.beginUploadAfterFileSelected();
      })
      .catch(function (err) {
        if (err === ABORTED) {
          return;
        }
        var message = typeof err === "string" ? err : (err && err.message) || "Unknown error.";
        self.setError(message);
      });

    return false;
  };

  BompusFileUpload.prototype.enableUpload = function () {
    this.releaseUploadControls();

    if (this.readonly === true) {
      this.setInfoText("No File Uploaded");
      setDisplay(this.o.elements.fileInput, false);
      return;
    }

    this.setInfoText("");
  };

  BompusFileUpload.prototype.reset = function () {
    this.enableUpload();
    if (this.o.elements.hiddenInput) {
      this.o.elements.hiddenInput.value = "";
    }
  };

  BompusFileUpload.prototype.setError = function (message) {
    this.reset();
    var err = document.createElement("span");
    err.className = "bfu-error";
    err.textContent = "Error: " + String(message);
    this.setInfoText(err);
  };

  BompusFileUpload.prototype.setInfoText = function (htmlOrElm) {
    var info = this.o.elements.infoText;
    if (!info) {
      return;
    }

    if (htmlOrElm === "") {
      info.replaceChildren();
      setDisplay(info, false);
      return;
    }

    info.replaceChildren();
    if (typeof htmlOrElm === "string") {
      info.innerHTML = htmlOrElm;
    } else if (htmlOrElm && htmlOrElm.jquery) {
      for (var i = 0; i < htmlOrElm.length; i++) {
        info.appendChild(htmlOrElm[i]);
      }
    } else if (htmlOrElm) {
      info.appendChild(htmlOrElm);
    }
    setDisplay(info, true);
  };

  BompusFileUpload.prototype.setText = function (filename, fromInit) {
    var self = this;

    this.currentFilename = filename;
    this.encodedFilename = encodeURIComponent(this.currentFilename);
    this.currentUrl = this.o.hooks.getFileDownloadUrl.call(this, this.encodedFilename);
    this.linkClass = this.o.hooks.getFileDownloadLinkClassName.call(this, this.encodedFilename);
    if (this.o.elements.hiddenInput) {
      this.o.elements.hiddenInput.value = this.currentFilename;
    }

    var dl = document.createElement("a");
    dl.target = "_blank";
    dl.className = "bfu-dl " + this.linkClass;
    dl.href = this.currentUrl;
    dl.textContent = this.currentFilename;

    var remove = document.createElement("a");
    remove.target = "_blank";
    remove.className = "bfu-remove";
    remove.href = "#";
    remove.textContent = "Remove";
    remove.addEventListener("click", function (e) {
      e.preventDefault();
      self.reset();
    });

    this.enableUpload();
    setDisplay(this.o.elements.fileInput, false);

    this.o.hooks.setText.call(this, fromInit, dl, remove);
  };

  BompusFileUpload.prototype.tickProgress = function (isComplete) {
    var percent_done = 0;

    if (isComplete === true) {
      percent_done = "100";
      this.tickProgressDebounce.cancel();
      this.uploadEnded = Date.now();
      this.uploadDuration = (this.uploadEnded - this.uploadStarted) / 1000;
      this.uploadDuration = Number(this.uploadDuration.toFixed(2));

      if (this.o.elements.fileInput) {
        this.o.elements.fileInput.value = null;
      }
    } else {
      var chunkCount = this.chunkProgressPct.length;
      if (chunkCount === 0) {
        return;
      }

      var pctSum = this.chunkProgressPct.reduce(function (a, b) {
        return a + b;
      }, 0);
      percent_done = pctSum / chunkCount;
      percent_done = Math.min(percent_done, 99.9);
      percent_done = percent_done.toFixed(1);

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
    }

    if (this.bfuBarFill) {
      this.bfuBarFill.style.width = percent_done + "%";
    }
    var tmpText = [percent_done + "%", this.upSpeedMbps + " Mbps", this.secsLeft + " seconds remaining"].join(" | ");
    if (this.bfuBarText) {
      this.bfuBarText.textContent = tmpText;
    }
  };

  BompusFileUpload.prototype.toggleFormSubmit = function () {
    var fileInput = this.o.elements.fileInput;
    var form = this.o.elements.form;
    var thisInProgress = !!(fileInput && fileInput.classList.contains("inProgress"));
    var anyInProgress = form
      ? form.querySelectorAll("input[type=file].inProgress").length > 0
      : thisInProgress;

    if (!this.o.elements.formSubmitBtn && form) {
      this.o.elements.formSubmitBtn = form.querySelector("[type=submit]");
    }

    var submitBtn = this.o.elements.formSubmitBtn;

    if (anyInProgress) {
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

    if (thisInProgress === true) {
      if (this._hookProgressActive !== true) {
        this._hookProgressActive = true;
        this.o.hooks.progressStart.call(this);
      }
    } else if (this._hookProgressActive === true) {
      this._hookProgressActive = false;
      this.o.hooks.progressEnd.call(this);
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

    this.o.hooks.beforeChunkSend.call(this, formData);

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
            self.tickProgressDebounce(false);
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
          var errMessage = data.message ? data.message : "Unknown Error E426.";
          reject(errMessage);
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
              self.tickProgressDebounce(false);
            }
            break;
          case "combineChunks":
            self.tickProgress(true);
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

  BompusFileUpload.prototype.upload_file = async function () {
    this.uploadGeneration++;
    var generation = this.uploadGeneration;

    this.chunkProgressPct = [];
    this.chunkProgressBytes = [];
    this.xhrs = [];

    if (this.method === "chunk") {
      this.lastChunkNum = Math.max(1, Math.ceil(this.filesize / this.chunkSizeBytes));
    } else if (this.method === "full") {
      this.lastChunkNum = 1;
    }

    for (var i = 0; i < this.lastChunkNum; i++) {
      this.chunkProgressPct[i] = 0;
      this.chunkProgressBytes[i] = 0;
    }

    try {
      await this.upload_chunk(0, "initFile", 0);

      if (generation !== this.uploadGeneration) {
        return;
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
          self.abortPendingUploads();
        }
      );

      if (generation !== this.uploadGeneration) {
        return;
      }

      var combineData = await this.upload_chunk(this.lastChunkNum, "combineChunks", 0);

      if (generation !== this.uploadGeneration) {
        return;
      }

      this.setText(combineData.file_name, false);
      this.o.hooks.uploadComplete.call(this);
    } catch (err) {
      if (generation !== this.uploadGeneration) {
        return;
      }

      this.abortPendingUploads();
      this.xhrs = [];

      if (err === ABORTED) {
        this.releaseUploadControls();
        throw err;
      }

      var errStr = typeof err === "string" ? err : (err && err.message) || String(err);

      if (errStr.indexOf("Unknown Error") === -1) {
        if (this.method === "chunk") {
          this.method = "full";
          this.resetProgress();
          return await this.upload_file();
        }
      }

      this.setError(errStr);
      throw err;
    }
  };

  global.BompusFileUpload = BompusFileUpload;
})(typeof globalThis !== "undefined" ? globalThis : window);
