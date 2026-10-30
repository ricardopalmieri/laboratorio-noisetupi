<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$samplesDirectory = __DIR__ . DIRECTORY_SEPARATOR . 'samples';
$allowedExtensions = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm'];
$files = [];

if (!is_dir($samplesDirectory)) {
    http_response_code(500);
    echo json_encode(['files' => [], 'error' => 'A pasta samples não existe.'], JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $root = realpath($samplesDirectory) ?: $samplesDirectory;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($samplesDirectory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );

    foreach ($iterator as $item) {
        if (!$item->isFile()) continue;
        $extension = strtolower($item->getExtension());
        if (!in_array($extension, $allowedExtensions, true)) continue;

        $fullPath = $item->getPathname();
        $relative = ltrim(str_replace('\\', '/', substr($fullPath, strlen($root))), '/');
        $folder = dirname($relative);
        if ($folder === '.') $folder = '';
        $urlParts = array_map('rawurlencode', explode('/', $relative));
        $size = $item->getSize();
        $modified = $item->getMTime();

        $files[] = [
            'id' => sha1($relative . '|' . $size . '|' . $modified),
            'name' => $item->getFilename(),
            'folder' => $folder,
            'url' => 'samples/' . implode('/', $urlParts),
            'size' => $size,
            'modified' => $modified,
        ];
    }

    usort($files, static function(array $a, array $b): int {
        $fa = ($a['folder'] ?? '') . '/' . $a['name'];
        $fb = ($b['folder'] ?? '') . '/' . $b['name'];
        return strnatcasecmp($fa, $fb);
    });
    echo json_encode(['files' => $files], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['files' => [], 'error' => 'Não foi possível ler a pasta de samples.'], JSON_UNESCAPED_UNICODE);
}
