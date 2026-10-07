<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

try {
    Guard::check();
    $action = (string)($_GET['a'] ?? '');
    $method = 'a_' . str_replace('.', '_', $action);
    if (!preg_match('/^[a-z]+(\.[a-z]+)*$/', $action) || !is_callable([Actions::class, $method])) {
        Http::fail("Action « {$action} » inconnue.", 404);
    }
    $out = Actions::$method(Http::params());
    if ($out !== null) {
        Http::json($out);
    }
} catch (UserError $e) {
    Http::fail($e->getMessage());
} catch (Throwable $e) {
    [$message, $code] = Db::message($e);
    Http::fail($message, 400, ['code' => $code]);
}
