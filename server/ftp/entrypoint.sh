#!/bin/sh
# docker-server — création des comptes FTP puis lancement de vsftpd.
# FTP_USERS : lignes « utilisateur:mot de passe » encodées en base64.
# Chaque compte voit uniquement son dossier, monté sur /ftp/<utilisateur>.
set -e

conf=/etc/vsftpd/vsftpd.conf
sed -i \
  -e "s/^pasv_min_port=.*/pasv_min_port=${PASV_MIN:-30000}/" \
  -e "s/^pasv_max_port=.*/pasv_max_port=${PASV_MAX:-30009}/" \
  -e "s/^pasv_address=.*/pasv_address=${PASV_ADDRESS:-127.0.0.1}/" \
  "$conf"
mkdir -p /var/run/vsftpd/empty

echo "${FTP_USERS:-}" | base64 -d 2>/dev/null | while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  user="${line%%:*}"
  pass="${line#*:}"
  home="/ftp/$user"
  mkdir -p "$home"
  # Les fichiers créés appartiennent au propriétaire du dossier (Linux) ;
  # sous Windows / macOS le montage est accessible à tous : uid 1000.
  uid=$(stat -c %u "$home")
  gid=$(stat -c %g "$home")
  if [ "$uid" = "0" ]; then uid=1000; gid=1000; fi
  if ! grep -q "^$user:" /etc/passwd; then
    echo "$user:x:$uid:$gid::$home:/sbin/nologin" >> /etc/passwd
    echo "$user:!:20000:0:99999:7:::" >> /etc/shadow
  fi
  echo "$user:$pass" | chpasswd >/dev/null 2>&1
  echo "FTP : compte « $user » -> $home"
done

echo "FTP prêt sur le port 21 (passif ${PASV_MIN:-30000}-${PASV_MAX:-30009})"
exec vsftpd "$conf"
