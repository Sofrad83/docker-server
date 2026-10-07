<?php
declare(strict_types=1);

/** Erreur « normale » (saisie invalide, objet inconnu…) : message affiché tel quel à l'utilisateur. */
final class UserError extends RuntimeException
{
}

final class Http
{
    public static function json(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode(
            $data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR
        );
        exit;
    }

    public static function fail(string $message, int $status = 400, array $extra = []): never
    {
        self::json(['ok' => false, 'error' => $message] + $extra, $status);
    }

    /** Paramètres de la requête : corps JSON, formulaire (multipart) et query-string fusionnés. */
    public static function params(): array
    {
        static $params = null;
        if ($params !== null) {
            return $params;
        }
        $params = $_POST;
        if (str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'json')) {
            $raw = (string)file_get_contents('php://input');
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $params = $decoded + $params;
            } elseif (trim($raw) !== '') {
                throw new UserError('Corps de requête JSON invalide (' . json_last_error_msg() . ').');
            }
        }
        return $params + $_GET;
    }
}
