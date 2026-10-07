<?php
declare(strict_types=1);

mb_internal_encoding('UTF-8');
set_time_limit(0);

foreach (['Config', 'Http', 'Guard', 'Db', 'SqlSplitter', 'Dump', 'Actions'] as $class) {
    require __DIR__ . '/' . $class . '.php';
}
