<?php
/*!
 * Bompus File Upload v1.0.4
 * https://upload.bompus.com/
 *
 * DO NOT USE THIS IN PRODUCTION
 *
 * This is a NON-PRODUCTION-READY example for handling chunked parallel uploads from jquery.bompus-file-upload.js
 *
 */

header('Cache-Control: no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Robots-Tag: noindex, noarchive, nofollow, noimageindex');
header('Content-type: application/json');

function get_upload_info($meta, $file_name, $file_chunk) {
	if (isset($_SERVER['CONTENT_LENGTH']) && (empty($_POST))) {
		die(json_encode(['message' => 'File is too large. Please try again with a smaller file.']));
	}

	$valid_meta = [
		'upload-1',
		'upload-2'
	];

	if (in_array($meta, $valid_meta) === false) {
		die(json_encode(['message' => 'Invalid Meta']));
	}

	// absolute public URL folder where a browser visitor can access the uploaded file, must start with a "/"
	$web_path_folder = "/files/{$meta}";
	
	// absolute file system directory folder to place the uploaded file, must start with a "/"
	$dir = __DIR__ . "/files/{$meta}";

	$myInfoPath = "{$dir}/{$file_name}";
	$myInfo = pathinfo($myInfoPath);
	$ext = isset($myInfo['extension']) ? strtolower($myInfo['extension']) : '';

	// NOTE: this is NOT production-ready. you should do better safety checks than this to prevent unsafe file extensions from being uploaded
	if (strlen($ext) < 3 || strlen($ext) > 4) {
		die(json_encode(['message' => 'Invalid Filename - Code E2.<br />A valid 3 or 4 character extension is required, such as .jpg , .jpeg , .png , .gif , .pdf , .mp4']));
	} else if (substr($ext,0,3) === 'php' || substr($ext,0,3) === 'asp' || substr($ext,0,3) === 'htm' || substr($ext,0,2) === 'js' || $ext === 'cgi' || $ext === 'pl' || $ext === 'py' || $ext === 'phtml' || $ext === 'shtml' || $ext === 'sh') {
		die(json_encode(['message' => 'Invalid File Extension - Code E3.']));
	}

	if ($file_chunk === 0 && is_dir($dir) === true) {
		// we should only have one file in each folder, because each ID is self-contained in a unique file system folder
		// so, if uploading and it is the first chunk, we delete all files in the directory first
		$fileArr = glob($dir . '/*.*');
		array_walk($fileArr, function ($fn) {
			if (is_file($fn)) {
				unlink($fn);
			}
		});
	}

	if (is_dir($dir) === false) {
		mkdir($dir, 0755, true);
	}

	$filename = strtolower(sha1($file_name)) . $ext;
	$filename .= '.safeExt'; // a further attempt to prevent malicious file extensions from being executed by the server
	$web_path = "{$web_path_folder}/{$filename}";
	$file_path = "{$dir}/{$filename}";

	$ret = new stdClass();
	$ret->dir = $dir;
	$ret->filename = $filename;
	$ret->file_path = $file_path;
	$ret->web_path = $web_path;
	$ret->web_path_folder = $web_path_folder;

	return $ret;
}

function handle_upload() {
	$start = microtime(true);

	$p = new stdClass();
	foreach ($_POST as $c => $val) {
		$p->$c = $val;
	}

	$file_chunk = intval($p->file_chunk);
	$file_chunk_max = intval($p->file_chunk_max);
	$act = $p->chunk_action;

	if ($act === 'sendChunk' && $p->chunk_method === 'chunk') {
		// die('error state testing');
	}

	$ret = get_upload_info($p->meta, $p->file_name, $file_chunk);

	$data = new stdClass();
	$data->success = true;
	$data->chunk_action = $act;
	$data->file_chunk = $file_chunk;
	$data->file_chunk_max = $file_chunk_max;
	$data->file_name = $ret->filename;

	if ($act === 'initFile') {
		// nothing special, get_upload_info really takes care of this
	} else if ($act === 'sendChunk') {
		$chunk_path = $ret->file_path . '.' . $file_chunk . '.chunk';
		move_uploaded_file($_FILES['file']['tmp_name'], $chunk_path);
	} else if ($act === 'combineChunks') {
		$final = fopen($ret->file_path, 'ab');

		for ($i = 1; $i <= $file_chunk_max; $i++) {
			$chunk_path = $ret->file_path . '.' . $i . '.chunk';
			$file = fopen($chunk_path, 'rb');
			while (!feof($file)) {
				$buff = fread($file, 16384);
				fwrite($final, $buff);
			}
			fclose($file);
			unlink($chunk_path);
		}

		fclose($final);

		// if we want to reduce the size, we can, but...
		// image will be in 130 x 115 aspect ratio, so browser can resize if we just use the original cropped image

		// using: PHP GD library ( https://www.php.net/manual/en/function.imagecreatefrompng.php )
		// $img = imagecreatefrompng($ret->file_path);
		// list($width, $height) = getimagesize($ret->file_path);
		// $tmp = imagecreatetruecolor(115, 130);
		// imagecopyresampled($tmp, $img, 0, 0, 0, 0, 115, 130, $width, $height);
		// unlink($ret->file_path);
		// imagepng($tmp, $ret->file_path);

		// using: php-vips extension ( https://github.com/libvips/php-vips )
		// $image = Jcupitt\Vips\Image::thumbnail($ret->file_path, 130, ['size' => 'down']); // max width/height is 130px, only size down
		// unlink($ret->file_path);
		// $image->writeToFile($ret->file_path, ['strip' => true, 'Q' => 100]); // strip exif data, quality 100%
	}

	$data->taken = (float) number_format(microtime(true) - $start, 6, '.', '');
	die(json_encode($data));
}

handle_upload();
?>