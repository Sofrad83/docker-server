'use strict';
/**
 * Configuration du dashboard : constantes + variables d'environnement transmises
 * par docker-compose.yml (elles-mêmes lues dans .env, toutes optionnelles).
 */
const path = require('path');

const env = process.env;
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const WORKSPACE = env.WORKSPACE || '/workspace';

module.exports = {
  APP: 'docker-server',
  VERSION: '0.1.0',

  // Racine du projet docker-server, montée dans ce container.
  WORKSPACE,
  REPO_DIR: path.join(WORKSPACE, 'repo'),
  DATA_DIR: path.join(WORKSPACE, 'data'),
  SERVER_DIR: path.join(WORKSPACE, 'server'),
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),

  // Réseau Docker partagé par tous les containers (créé par docker-compose.yml).
  NETWORK: 'docker-server',
  SELF: 'ds-dashboard',
  PROXY: 'ds-proxy',
  MAILPIT: 'ds-mailpit',
  FTP: 'ds-ftp',
  LABEL: 'docker-server.kind',

  PORT: int(env.DASHBOARD_PORT, 8000),

  // Ports publiés sur la machine.
  bindIp: env.BIND_IP || '127.0.0.1',
  httpPort: int(env.HTTP_PORT, 80),
  httpsPort: int(env.HTTPS_PORT, 443),
  mysqlPort: int(env.MYSQL_PORT, 3306),
  mysqlVersion: env.MYSQL_VERSION || '5.7',
  ftpPort: int(env.FTP_PORT, 21),
  ftpPasvMin: int(env.FTP_PASV_MIN, 30000),
  ftpPasvMax: int(env.FTP_PASV_MAX, 30009),

  timezone: env.TZ || 'Europe/Paris',
  dbPassword: 'root',

  // Renseigné au démarrage : chemin de WORKSPACE vu par la machine hôte (pour les montages).
  hostRoot: '',
};
