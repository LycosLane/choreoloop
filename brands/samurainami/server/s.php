<?php
declare(strict_types=1);

/**
 * Self-contained SQLite URL shortener for loop.samurainami.com.
 * - Stores all short links in a single SQLite file (links.sqlite).
 * - Automatically deletes links unused for more than 365 days and caps total rows at MAX_LINKS.
 * - Restricts targets to this app's #share= / #sharez= URLs to prevent abuse.
 */

const DB_PATH = __DIR__ . '/links.sqlite';
const MAX_AGE_SECONDS = 365 * 86400;
const MAX_LINKS = 10000;
const MAX_BODY_BYTES = 20480;
const ALLOWED_ORIGIN = 'https://loop.samurainami.com';
const ALLOWED_URL_PATTERN = '/^https:\/\/loop\.samurainami\.com\/(?:index\.html)?#sharez?=[A-Za-z0-9_-]+$/D';

function getDb(): PDO {
    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 3000;');
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS links (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_accessed INTEGER NOT NULL
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_links_url ON links(url)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_links_last_accessed ON links(last_accessed)');
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

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if (($method === 'GET' || $method === 'HEAD') && isset($_GET['s'])) {
    header('Cache-Control: no-store');
    $code = preg_replace('/[^a-zA-Z0-9]/', '', (string) $_GET['s']);
    if ($code !== '') {
        try {
            $pdo = getDb();
            $stmt = $pdo->prepare('SELECT url FROM links WHERE id = :id LIMIT 1');
            $stmt->execute([':id' => $code]);
            $row = $stmt->fetch();
            if ($row && is_string($row['url']) && preg_match(ALLOWED_URL_PATTERN, $row['url']) === 1) {
                if ($method === 'GET') {
                    $upd = $pdo->prepare('UPDATE links SET last_accessed = :now WHERE id = :id');
                    $upd->execute([':now' => time(), ':id' => $code]);
                }
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

if ($method === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    $originValid = $origin === ALLOWED_ORIGIN;
    $refererValid = $origin === '' && str_starts_with($referer, ALLOWED_ORIGIN . '/');
    if (!$originValid && !$refererValid) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden origin']);
        exit;
    }

    $contentLen = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
    if ($contentLen > MAX_BODY_BYTES) {
        http_response_code(413);
        echo json_encode(['error' => 'Payload too large']);
        exit;
    }

    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_BODY_BYTES) {
        http_response_code(413);
        echo json_encode(['error' => 'Payload too large']);
        exit;
    }

    $body = json_decode($raw, true);
    $url = is_array($body) && isset($body['url']) && is_string($body['url']) ? trim($body['url']) : '';

    if ($url === '' || strlen($url) > 16384 || preg_match(ALLOWED_URL_PATTERN, $url) !== 1) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid target URL']);
        exit;
    }

    try {
        $pdo = getDb();
        $now = time();
        $pdo->exec('BEGIN IMMEDIATE');

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
            // Cap total stored links to prevent unbounded disk usage
            $count = (int) $pdo->query('SELECT COUNT(*) FROM links')->fetchColumn();
            if ($count >= MAX_LINKS) {
                $excess = $count - MAX_LINKS + 1;
                $del = $pdo->prepare(
                    'DELETE FROM links WHERE id IN (SELECT id FROM links ORDER BY last_accessed ASC LIMIT :limit)'
                );
                $del->bindValue(':limit', $excess, PDO::PARAM_INT);
                $del->execute();
            }

            $code = '';
            $ins = $pdo->prepare('INSERT INTO links (id, url, created_at, last_accessed) VALUES (:id, :url, :now, :now)');
            for ($attempt = 0; $attempt < 3; $attempt++) {
                $candidate = generateCode(7);
                try {
                    $ins->execute([':id' => $candidate, ':url' => $url, ':now' => $now]);
                    $code = $candidate;
                    break;
                } catch (PDOException $e) {
                    if ($attempt === 2) throw $e;
                }
            }
        }

        $pdo->exec('COMMIT');
        echo json_encode(['shortUrl' => ALLOWED_ORIGIN . '/?s=' . $code]);
        exit;
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->exec('ROLLBACK');
        }
        http_response_code(500);
        echo json_encode(['error' => 'Shortener failed']);
        exit;
    }
}

http_response_code(405);
