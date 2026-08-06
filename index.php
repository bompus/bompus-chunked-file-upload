<?php
/*!
 * Bompus Chunked File Upload v2.0.0
 * https://github.com/bompus/bompus-chunked-file-upload
 *
 * Library: vanilla JS (no jQuery). This demo page loads jQuery only for croppie/featherlight.
 *
 * Copyright Aaron Queen
 */

header('Cache-Control: no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Robots-Tag: noindex, noarchive, nofollow, noimageindex');
?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-US">
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
		<title>Bompus File Upload - Example</title>
		<meta name="viewport" content="width=device-width,initial-scale=1.0" />

		<link rel="stylesheet" href="./bompus-chunked-file-upload.css?v=<?php echo time(); ?>" />
		<script src="./bompus-chunked-file-upload.js?v=<?php echo time(); ?>"></script>

		<!-- jQuery only for croppie/featherlight demo (not required by BompusFileUpload) -->
		<script src='https://cdn.jsdelivr.net/npm/jquery@1.12.4/dist/jquery.min.js'></script>
		
		<!-- BEGIN: EXAMPLE PAGE STYLES, NOT NEEDED FOR PLUGIN USAGE -->
		<style>
			html, body { margin: 0; padding: 0; box-sizing: border-box; }
			*, *:before, *:after { box-sizing: inherit; }
			
			h3 a:visited { color:#00f; }

			.container {
				width: 500px;
				max-width: 100%;
				margin: 15px auto;
				padding: 15px;
				border: 1px solid #ddd;
			}

			.container .example {
				padding: 15px;
				border: 1px solid #ddd;
				margin-bottom: 15px;
			}

			#submitdiv {
				margin-top: 15px;
				padding: 15px;
				background: #eee;
				text-align: center;
			}

			input[type=file] {
				width: 100%;
				padding: 3px 0;
				margin: 1px;
				cursor: pointer;
			}

			.featherlight.cropper .featherlight-content {
				width: 500px;
				padding: 25px;
				padding-bottom: 10px;
				border-bottom: none;
				color: #fff;
				background: #111;
			}

			.featherlight.cropper .featherlight-close-icon {
				background: #ccc;
				font-weight: bold;
			}

			.featherlight.cropper .featherlight-inner .croppie-container .cr-slider-wrap {
				margin-top: 18px;
				padding-left: 5px;
			}

			.featherlight.cropper .featherlight-inner .croppie-container .cr-slider {
				-webkit-appearance: none;
				appearance: none;
				outline: none;
				height: 18px;
				width: 265px;
				max-width: 80%;
			}

			.featherlight.cropper .featherlight-inner .croppie-container .cr-slider::-webkit-slider-thumb {
				-webkit-appearance: none;
				appearance: none;
				width: 15px;
				height: 15px;
				background: #4CAF50;
				cursor: pointer;
			}

			.featherlight.cropper .featherlight-inner .croppie-container .cr-slider::-moz-range-thumb {
				width: 15px;
				height: 15px;
				background: #4CAF50;
				cursor: pointer;
			}
		</style>

		<script>
			var myGetFileDownloadUrl = function(uriEncodedFilename) {
				return '/files/' + this.o.fieldName + '/' + uriEncodedFilename;
			};
			
			var myProgressStart = function() {
				if ($("#submitdiv #major-publishing-actions .inProgressPub").length === 0) {
					$("#submitdiv #major-publishing-actions").prepend(
						"<div class='inProgressPub'>A file upload is in progress. Please wait for it to complete before clicking SAVE.</div><br />"
					);
				}
			};

			var myProgressEnd = function() {
				$("#submitdiv #major-publishing-actions .inProgressPub").remove();
			};

			var myUploadComplete = function() {
				console.log("upload duration", this.uploadDuration, "seconds");
				$.featherlight.close();
			};
		</script>
		<!-- END: EXAMPLE PAGE STYLES, NOT NEEDED FOR PLUGIN USAGE -->

		<!-- BEGIN: supporting files for integrating with an image cropper -->
		<link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/croppie@2.6.4/croppie.min.css' />
		<script src='https://cdn.jsdelivr.net/npm/croppie@2.6.4/croppie.min.js'></script>

		<link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/featherlight@1.7.13/release/featherlight.min.css' />
		<script src='https://cdn.jsdelivr.net/npm/featherlight@1.7.13/release/featherlight.min.js'></script>
		<!-- END: supporting files for integrating with an image cropper -->
	</head>
	<body>
		<div class='container'>
			<h3 style='margin:0;margin-bottom:15px;'>Bompus Chunked File Upload - v2.0.0 - <a target='_blank' href='https://github.com/bompus/bompus-chunked-file-upload'>GitHub</a></h3>
			<form action='#' method='get' onsubmit='alert("Form Submitted. Not really though, this does not actually submit anywhere."); return false;'>
				
			<div class='example'>
					Upload File:
					<?php
						$name = 'upload-1';
						$postId = 1;
						$filename = '';
						// $filename = '080476b3dccbd4100f5a61fd9351e4a72f6f2ac0.pdf.safeExt';
					?>
					<div data-bfu-text="<?php echo $name; ?>"></div>
					<input data-bfu-file="<?php echo $name; ?>" type="file" accept="audio/*,video/*,image/*,application/pdf" disabled="disabled" />
					<input data-bfu-hidden="<?php echo $name; ?>" type="hidden" name="<?php echo $name; ?>" id="<?php echo $name; ?>" value="<?php echo $filename; ?>" />
					<script>
						(function() {
							var fieldName = '<?php echo $name; ?>';
							var upload_1 = BompusFileUpload({
								postUrl: '/upload.php',
								fieldName: fieldName,
								hooks: {
									getFileDownloadUrl: myGetFileDownloadUrl,
									beforeChunkSend: function(formData) {
										formData.append('action', 'dls_admin_ajax_upload');
										formData.append('post', '<?php echo $postId; ?>');
										formData.append('meta', '<?php echo $name; ?>');
									},
									progressStart: myProgressStart,
									progressEnd: myProgressEnd,
									uploadComplete: myUploadComplete
								}
							});
						})();
					</script>
				</div>
				
				<div class='example'>
					Upload Image &amp; Crop:<br />
					<style>
						#upload-2-label { display:inline-block; padding:3px 0; margin: 1px; }
						#upload-2-popup { display:none; }
						#upload-2-popup .bfu-bar { max-width: 100%; }
						#upload-2-popup .bfu-error { background:#fff;padding:5px;width:100%; }
						#upload-2-file { display:none !important; }
					</style>
					<?php
						$name = 'upload-2';
						$postId = 1;
						$filename = '';
						// $filename = '110e6f099be9aa4f1a2bcbecd07bb5687cf72c7d.png.safeExt';
					?>
					<label id='upload-2-label' for='upload-2-file'><img id='upload-2-img' style='width:115px;height:130px;cursor:pointer;' src='./no-photo.png' /></label><br />

					<div id='upload-2-popup'>
						<div style="min-height:400px;">
							<div class="cropDiv" style="height:350px;"></div>
							<div class="cropBtns" style="float:left;width:100%;margin-top:12px;padding:5px;background:#fff;display:none;">
								<button id="btnRotate" style="float:left;">Rotate</button>
								<button id="btnCrop" style="float:right;">Save</button>
							</div>
							<div style="clear:both;"></div>
							<div style="margin-top:2px;" data-bfu-text="<?php echo $name; ?>"></div>
						</div>
					</div>

					<input id='upload-2-file' data-bfu-file="<?php echo $name; ?>" type="file" accept="image/*" disabled="disabled" />
					<input data-bfu-hidden="<?php echo $name; ?>" type="hidden" name="<?php echo $name; ?>" id="<?php echo $name; ?>" value="<?php echo $filename; ?>" />
					<script>
						(function($) {
							var fieldName = '<?php echo $name; ?>';
							var upload_2 = BompusFileUpload({
								postUrl: '/upload.php',
								fieldName: fieldName,
								hooks: {
									getFileDownloadUrl: myGetFileDownloadUrl,
									setText: function(fromInit, dlEl, removeEl) {
										$('#' + fieldName + '-img').attr('src', this.currentUrl);
									},
									fileSelected: function() {
										var self = this;
										return new Promise(function(resolve, reject) {
											var clickedSave = false;
											var settled = false;
											var objUrlSrc = URL.createObjectURL(self.file);
											var popupContents = $('#' + fieldName + '-popup');

											var cropDiv = $('<div />');
											var content = $('<div />');

											var settle = function(value, isReject) {
												if (settled) {
													return;
												}
												settled = true;
												if (isReject === true) {
													reject(value);
												} else {
													resolve(value);
												}
											};

											var disableCropper = function() {
												content.find('input, button').prop('disabled', true);
												content.find('.cr-slider, .cropBtns').hide();
												
												// remove all event listeners, but we have to redraw the canvas
												var oldCanvas = cropDiv.find('canvas').get(0);
												if (oldCanvas) {
													var newClone = cropDiv.clone();
													var context = newClone.find('canvas').get(0).getContext('2d');
													context.drawImage(oldCanvas, 0, 0);
													cropDiv.replaceWith(newClone);
												}
											};

											var caughtErr = function(e) {
												disableCropper();
												cropDiv.hide();
												console.log('croppie caught error', e);
												settle('Unable to read image. Please try a different image.', true);
											};

											var uploadCroppedBlob = function(blob) {
													// add .name to blob object, and convert file extension to PNG
													blob.name = self.file.name.substr(0, self.file.name.lastIndexOf(".")) + ".png";
													self.file = blob;

													// show the image immediately to reduce display blip during server load
													var tmpUrlSrc = URL.createObjectURL(self.file);
													$('#' + fieldName + '-img').attr('src', tmpUrlSrc);
													setTimeout(function() {
														URL.revokeObjectURL(tmpUrlSrc);
													}, 0);

													clickedSave = true;

													disableCropper();
													settle();
											};

											$.featherlight(popupContents, {
												closeOnClick: false,
												afterOpen: function() {
													var flSelf = this;

													content = flSelf.$content;
													content.parents(".featherlight").addClass("cropper").find("> .featherlight-content").css({ "max-width": "90vw", "max-height": "90vh" });
													content.parent().prepend("<div style='position:absolute;top:0;left:0;height:25px;padding:4px 10px 0px 10px;background:#ffee58;color:#000;width:100%;'>Crop Image</div>");

													self.o.elements.infoText = document.querySelector('div[data-bfu-text="<?php echo $name; ?>"]');
													
													cropDiv = content.show().find('.cropDiv');

													var allowedExts = ["jpg", "jpeg", "png", "gif", "webp"];
													var re = /(?:\.([^.]+))?$/;
													var ext = re.exec(self.file.name)[1];
													if (allowedExts.indexOf(ext) === -1) {
														return caughtErr("File extension '" + ext + "' not supported");
													}
													
													cropDiv.croppie({
														enableOrientation: true,
														viewport: { width: 115, height: 130 }
													});

													cropDiv.croppie('bind', { url: objUrlSrc }).then(function() {
														content.find('#btnRotate').on('click', function() {
															cropDiv.croppie('rotate', 90);
														});

														content.find('#btnCrop').on('click', function() {
															cropDiv.croppie('result', { type: 'blob', size: 'original', format: 'png', quality: 1, circle: false }).then(uploadCroppedBlob).catch(caughtErr);
														});

														content.find('.cropBtns').show();
													}).catch(caughtErr);
												},
												afterClose: function() {
													// free up memory
													URL.revokeObjectURL(objUrlSrc);

													if (clickedSave === false) {
														// we need to reset the uploader, or else the file input change event may not fire again
														self.reset();
														settle(BompusFileUpload.SKIP_UPLOAD);
													}
												}
											});
										});
									},
									beforeChunkSend: function(formData) {
										formData.append('action', 'dls_admin_ajax_upload');
										formData.append('post', '<?php echo $postId; ?>');
										formData.append('meta', '<?php echo $name; ?>');
									},
									progressStart: myProgressStart,
									progressEnd: myProgressEnd,
									uploadComplete: myUploadComplete
								}
							});
						})(jQuery);
					</script>
				</div>

				<div id='submitdiv'>
					<div id='major-publishing-actions'></div>
					<input id='publish' type='submit' value='Submit' />
				</div>
			</form>
		</div>
	</body>
</html>