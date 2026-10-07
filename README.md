# docker-server

**Un serveur de développement PHP local, prêt en 5 minutes, piloté depuis un tableau de bord.**
Pensé pour un débutant comme pour un développeur senior : on dépose son site dans `repo/`, on clique, il est en ligne en `https://mon-site.localhost`.

- 🗂️ **Projets** — chaque dossier de `repo/` devient un site : framework, version de PHP, dossier public, extensions et base de données sont **détectés automatiquement**.
- 🐘 **PHP 5.6 → 8.5** — version, extensions (cases à cocher), `php.ini`, Composer, Node.js : tout se règle en quelques clics.
- 🐞 **Xdebug** — désactivé / sur demande / toujours, appliqué en 2 secondes, avec la bonne version pour chaque PHP.
- 🌐 **Adresses** — `http://` et `https://` pour chaque projet ; `mon-site.localhost` sans aucune configuration, ou l'adresse de votre choix (`mon-site.test`, `local-mon-site`…).
- 🖥️ **Terminal & logs** — un terminal dans le navigateur, des logs en direct triables (erreurs, alertes, accès…).
- 🛢️ **MySQL / MariaDB** — MySQL 5.7 par défaut, changement de version sans perte de données, autant de serveurs que nécessaire.
- 📂 **FTP** — autant de comptes que voulu, chacun sur **n'importe quel dossier** de la machine, avec export FileZilla et `.env`.
- 🧮 **DB Admin** — administration des bases (tables, données, SQL, import / export, schéma).
- ✉️ **Mailpit** — tous les mails envoyés par PHP sont capturés et consultables.

---

## Installation (≈ 5 minutes)

**Prérequis : [Docker Desktop](https://www.docker.com/products/docker-desktop/)** (Windows, macOS) ou Docker Engine (Linux). C'est tout.

1. Téléchargez ce dépôt (`git clone` ou *Code › Download ZIP*) et placez-le où vous voulez.
2. Lancez :
   - **Windows** : double-cliquez sur **`start.cmd`**
   - **macOS / Linux** : `./start.sh` (ou `bash start.sh`)
3. Le tableau de bord s'ouvre sur **http://localhost**. C'est prêt.

Le script vérifie Docker (et le démarre si besoin), choisit d'autres ports si 80 / 443 sont déjà pris, démarre les services et installe le certificat HTTPS local. Le premier lancement télécharge quelques images Docker ; les suivants prennent quelques secondes.

> Sans les scripts : `docker compose up -d`, puis http://localhost.

Pour tout arrêter : **`stop.cmd`** / `./stop.sh` (rien n'est supprimé).

---

## Ajouter un projet

1. Copiez votre site dans le dossier **`repo/`** (par exemple `repo/mon-site/`).
2. Il apparaît dans le tableau de bord, déjà configuré. Cliquez sur **Mettre en ligne**.
3. Ouvrez **https://mon-site.localhost**.

Ce qui est détecté : Laravel, Symfony, WordPress (et Bedrock), Drupal, PrestaShop, Joomla, CodeIgniter, CakePHP, Yii, PHP « nu » et sites statiques ; la version de PHP (`composer.json`), le dossier public (`public/`, `web/`…), les extensions demandées (`ext-*`), Node.js (`package.json`) et le nom de la base (`.env`, `wp-config.php`).

Pas encore de code ? **Nouveau projet › Nouveau dossier** crée un dossier avec une page de démarrage qui vérifie PHP, la base et les mails.

### Se connecter à la base depuis son projet

| | Depuis le projet (container) | Depuis votre PC (HeidiSQL, TablePlus…) |
|---|---|---|
| Hôte | `mysql` | `127.0.0.1` |
| Port | `3306` | `3306` (ou celui affiché) |
| Utilisateur / mot de passe | `root` / `root` | `root` / `root` |

L'onglet **Aperçu** de chaque projet donne la configuration prête à copier pour Laravel, Symfony, WordPress et PDO. docker-server n'écrit jamais dans les fichiers de vos projets.

### Reprendre les bases d'un autre environnement Docker

Double-cliquez sur **`import-mysql.cmd`** : il détecte les autres containers MySQL / MariaDB de la machine et copie **toutes leurs bases** vers docker-server (tables, données, vues, procédures, déclencheurs, comptes et droits). Le mot de passe root de la source est détecté, la source n'est jamais modifiée (démarrée puis arrêtée si besoin), et une copie du SQL reste dans `data\backups\`.

### Xdebug

Onglet **Xdebug** du projet : *Sur demande* par défaut (extension *Xdebug Helper* ou `?XDEBUG_TRIGGER=1`), *Désactivé* (performances maximales) ou *Toujours*. Port **9003**, chemins `/var/www/html` ↔ dossier du projet. La configuration VS Code (`launch.json`) et PhpStorm est fournie dans l'onglet.

---

## Les adresses

| | |
|---|---|
| Tableau de bord | http://localhost — ou http://ds-dashboard |
| Vos projets | http(s)://`nom-du-projet`.localhost par défaut, ou l'adresse de votre choix |
| DB Admin | http://dbadmin.localhost |
| Mails (Mailpit) | http://mailpit.localhost |

**L'adresse d'un projet est libre**, dès sa création : `mon-site.localhost`, `mon-site.test`, ou un simple nom comme `local-mon-site`. Elle répond en http:// et en https://.

- Les adresses en `.localhost` fonctionnent immédiatement, sans rien configurer (Chrome, Edge, Firefox).
- Les autres doivent figurer dans le fichier hosts de la machine. Sous Windows, `start.cmd` lance un petit agent qui s'en charge : dès qu'une adresse apparaît, Windows demande une confirmation, et c'est tout. Sinon : double-cliquez sur **`hosts.cmd`** (Windows) ou lancez `./hosts.sh` (macOS / Linux). Seul un bloc `# >>> docker-server` est écrit, le reste du fichier n'est pas touché.
- Un nom sans point (`local-mon-site`, `ds-dashboard`) se tape avec un `/` final dans la barre d'adresse (`local-mon-site/`), sinon le navigateur lance une recherche.

---

## Réglages (facultatifs)

Copiez `.env.example` en `.env` pour changer les ports, la version de MySQL créée au premier démarrage ou le fuseau horaire, puis relancez `start`. Tout le reste se règle dans le tableau de bord.

---

## Questions fréquentes

**Le navigateur affiche un avertissement en https.** Le certificat local n'est pas installé : *Réglages › HTTPS* donne le fichier et la commande (le script `start` le fait sous Windows et macOS). Redémarrez ensuite le navigateur.

**Le port 80 est déjà pris (IIS, WAMP, Skype…).** `start` le détecte et passe sur 8080 / 8443 : le tableau de bord est alors sur http://localhost:8080.

**« You have reached your pull rate limit ».** Docker Hub limite les téléchargements anonymes. Connectez-vous (`docker login`, compte gratuit) ou réessayez un peu plus tard.

**Safari n'ouvre pas `mon-site.localhost`.** Selon les versions, Safari ne résout pas les sous-domaines de localhost : utilisez Chrome, Edge ou Firefox, ou ajoutez l'adresse au fichier hosts.

**Linux : à qui appartiennent les fichiers ?** Apache, Composer et le terminal tournent avec l'utilisateur propriétaire du dossier du projet : les fichiers créés (vendor/, cache…) vous appartiennent.

**Vite / `npm run dev`.** Le serveur de développement de Vite n'est pas exposé hors du container : utilisez `npm run build` (bouton dans *Commandes*), ou lancez Vite sur votre machine.

**Désinstaller.** `stop`, puis supprimez le dossier. Pour libérer aussi l'espace Docker : `docker rm -f $(docker ps -aq --filter label=docker-server.kind)` puis supprimez les images `ds-php` et les volumes `ds-*` depuis Docker Desktop.

---

## Comment ça marche

```
navigateur ──► proxy (Caddy) ─┬─► tableau de bord      (Node.js, pilote Docker)
  *.localhost   HTTP + HTTPS  ├─► ds-<projet>          (PHP + Apache, un container par projet)
                              ├─► DB Admin, Mailpit
                              └─  ds-mysql, ds-db-*, ds-ftp   (créés à la demande)
```

```
docker-server/
├─ start.cmd / start.sh    démarrage (stop.cmd / stop.sh pour arrêter)
├─ hosts.cmd / hosts.sh    met à jour le fichier hosts (adresses personnalisées)
├─ import-mysql.cmd        copie les bases d'un autre container MySQL vers docker-server
├─ docker-compose.yml      le socle : proxy, tableau de bord, DB Admin, Mailpit
├─ .env.example            réglages facultatifs (ports, version MySQL, fuseau)
├─ repo/                   ► VOS PROJETS
├─ data/                   état (state.json), certificats, sauvegardes SQL, php.ini générés
├─ dashboard/              le tableau de bord : Node.js sans dépendance, interface en JS natif
├─ dbadmin/                DB Admin (PHP + JS natif)
└─ server/                 Caddyfile, FTP (vsftpd), configuration Apache, page de démarrage
```

- **Une seule source de vérité** : `data/state.json`. Images, containers, routes et `php.ini` en sont déduits et recréés si besoin (dossier copié sur un autre poste, container supprimé…).
- **Images partagées** : deux projets avec la même version de PHP et les mêmes extensions utilisent la même image ; elle n'est construite qu'une fois ([install-php-extensions](https://github.com/mlocati/docker-php-extension-installer) choisit les bonnes versions, Xdebug compris).
- **Changement de version MySQL** : les bases sont sauvegardées dans `data/backups/`, le nouveau serveur est créé, puis elles sont réimportées ; l'ancien volume est conservé.

## Sécurité

Outil **strictement local** : tous les ports écoutent sur `127.0.0.1`, il n'y a pas d'authentification et les mots de passe sont volontairement simples. Ne l'exposez jamais sur un réseau et ne l'utilisez pas en production.

## Licence

MIT — voir [LICENSE](LICENSE). Inclut [xterm.js](https://github.com/xtermjs/xterm.js) (MIT).
