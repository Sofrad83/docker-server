<?php
declare(strict_types=1);

final class Config
{
    private static ?array $data = null;

    public static function get(string $key, mixed $default = null): mixed
    {
        self::$data ??= require __DIR__ . '/../config.php';
        return self::$data[$key] ?? $default;
    }
}
