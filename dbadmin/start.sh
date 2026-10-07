#!/bin/sh
# DB Admin — démarrage. Image officielle php:8.4-apache (la même que les projets), sans build : le pilote
# MySQL est compilé au premier démarrage du container (~30 s, hors ligne).
set -e
if ! php -m | grep -qi '^pdo_mysql$'; then
  echo "DB Admin : installation du pilote MySQL (premier démarrage)…"
  docker-php-ext-install -j"$(nproc)" pdo_mysql >/dev/null 2>&1
  a2enmod headers >/dev/null
  sed -ri 's!/var/www/html!/app/public!g; s!/var/www/!/app/public/!g' \
    /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf
  printf 'ServerName localhost\nTimeout 3600\n<IfModule mod_headers.c>\n  Header set Cache-Control "no-cache"\n</IfModule>\n' \
    > /etc/apache2/conf-available/dbadmin.conf
  a2enconf dbadmin >/dev/null
fi
exec apache2-foreground
