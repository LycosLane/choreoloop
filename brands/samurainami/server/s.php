<?php
declare(strict_types=1);

/**
 * Self-contained SQLite URL shortener for loop.samurainami.com.
 * - Stores all short links in a single SQLite file (links.sqlite).
 * - Automatically deletes links unused for more than 365 days.
 * - Restricts targets to this app's #share= / #sharez= URLs to prevent abuse.
 */

const DB_PATH = __DIR__ . '/links.sqlite';
const MAX_AGE_SECONDS = 365 * 86400;
const ALLOWED_URL_PATTERN = '/^https:\/\/loop\.samurainami\.com\/#sharez?=[A-Za-z0-9_-]+$/';

function getDb(): PDO {
    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS links (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_accessed INTEGER NOT NULL
        )'
    );
    return $pdo;
}

function generateCode(int $len = 7): string {
    $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $out = '';
    $max = strlen($chars) - 1;
    for ($i = 0; $i < $len; $i++) {
        $out .= $chars[random_int(0, $max)];
    }
    return $out;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['s'])) {
    $code = preg_replace('/[^a-zA-Z0-9]/', '', (string) $_GET['s']);
    if ($code !== '') {
        try {
            $pdo = getDb();
            $stmt = $pdo->prepare('SELECT url FROM links WHERE id = :id LIMIT 1');
            $stmt->execute([':id' => $code]);
            $row = $stmt->fetch();
            if ($row && is_string($row['url']) && preg_match(ALLOWED_URL_PATTERN, $row['url']) === 1) {
                $upd = $pdo->prepare('UPDATE links SET last_accessed = :now WHERE id = :id');
                $upd->execute([':now' => time(), ':id' => $code]);
                header('Location: ' . $row['url'], true, 302);
                exit;
            }
        } catch (Throwable $e) {
            // Fall through to app root
        }
    }
    header('Location: /', true, 302);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    $raw = file_get_contents('php://input');
    $body = json_decode($raw ?: '', true);
    $url = is_array($body) && isset($body['url']) && is_string($body['url']) ? trim($body['url']) : '';

    if ($url === '' || strlen($url) > 16384 || preg_match(ALLOWED_URL_PATTERN, $url) !== 1) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid target URL']);
        exit;
    }

    try {
        $pdo = getDb();
        $now = time();

        // Auto-cleanup links not accessed for > 365 days
        $cutoff = $now - MAX_AGE_SECONDS;
        $pdo->prepare('DELETE FROM links WHERE last_accessed < :cutoff')->execute([':cutoff' => $cutoff]);

        // Reuse existing short code if identical URL already stored
        $find = $pdo->prepare('SELECT id FROM links WHERE url = :url LIMIT 1');
        $find->execute([':url' => $url]);
        $existing = $find->fetch();

        if ($existing && is_string($existing['id'])) {
            $code = $existing['id'];
            $pdo->prepare('UPDATE links SET last_accessed = :now WHERE id = :id')->execute([':now' => $now, ':id' => $code]);
        } else {
            $code = generateCode(7);
            $ins = $pdo->prepare('INSERT INTO links (id, url, created_at, last_accessed) VALUES (:id, :url, :now, :now)');
            $ins->execute([':id' => $code, ':url' => $url, ':now' => $now]);
        }

        echo json_encode(['shortUrl' => 'https://loop.samurainami.com/?s=' . $code]);
        exit;
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Shortener failed']);
        exit;
    }
}

http_response_code(405);
