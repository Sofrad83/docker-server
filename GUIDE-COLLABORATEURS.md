# docker-server — passer de docker-env à docker-server

Environ 15 minutes au total. docker-env n'est jamais modifié : vous pouvez revenir en arrière à tout moment.

---

## 1. Installer docker-server — 5 min

Prérequis : Docker Desktop (déjà installé si vous utilisez docker-env).

**1. Arrêtez docker-env, sans rien supprimer** (ça libère les ports 80 et 443) :

```powershell
cd C:\docker-env
docker compose stop
```

> ⚠️ N'utilisez pas `.\env down` à ce stade : il supprime le container MySQL, nécessaire à l'étape 2.

**2. Récupérez docker-server** (ou *Code › Download ZIP* sur GitHub, à décompresser dans `C:\docker-server`) :

```powershell
git clone https://github.com/Sofrad83/docker-server.git C:\docker-server
```

**3. Double-cliquez sur `C:\docker-server\start.cmd`.**
Windows pose deux questions (certificat HTTPS, fichier hosts) : répondez **Oui**.

✅ Le tableau de bord s'ouvre sur **http://localhost**.

> Si `start` annonce un autre port (8080…), c'est que docker-env tournait encore : arrêtez-le (étape 1), supprimez le fichier `C:\docker-server\.env`, puis relancez `start.cmd`.

---

## 2. Migrer les bases de données — 2 min

Double-cliquez sur **`C:\docker-server\import-mysql.cmd`** et répondez **Oui**.

Il retrouve le MySQL de docker-env et copie **toutes les bases** vers docker-server : données, vues, procédures et comptes. docker-env n'est pas modifié.

**Rien à changer dans vos projets** : la connexion est identique à docker-env.

| Hôte | Port | Utilisateur | Mot de passe |
|---|---|---|---|
| `mysql` | `3306` | `root` | *(vide)* |

---

## 3. Migrer un projet — 1 min par projet

**1.** Copiez le dossier du projet de `C:\docker-env\repo\` vers **`C:\docker-server\repo\`** (copier-coller dans l'Explorateur).

**2.** Dans le tableau de bord, il apparaît en haut : *Nouveau dossier détecté*. Cliquez sur **Personnaliser** :

- **Adresse** : reprenez la même que dans docker-env. Elle fonctionne tout de suite.
- **Version de PHP** : la même que dans docker-env.
- **Base de données** : laissez cochée et gardez le nom de la base importée : elle est simplement rattachée au projet.
- **Réglages avancés › Extensions** : cochez celles dont le projet a besoin. docker-env installait aussi `ldap`, `soap`, `imap`, `gmp`, `xsl`, `bz2`, `gettext` et `sockets`.

> L'adresse et la version de PHP d'un projet docker-env sont dans `C:\docker-env\data\projects.json` (champs `domains` et `php`).

**3.** Cliquez sur **Créer et mettre en ligne**. La première fois, comptez 2 à 5 minutes, le temps de construire l'image. Ensuite c'est instantané.

Le `.env` du projet n'a pas besoin d'être modifié.

> **Un projet en appelle un autre par son nom de container** (`http://api`, `http://medias`… dans son `.env`) ? Ouvrez le projet **appelé** › onglet **Adresses** › *Depuis les autres projets*, et ajoutez ce nom. Le nom du container docker-env est dans `C:\docker-env\data\projects.json` (champ `container`). Sans ça, l'appel échoue avec « Could not resolve host ».

---

## 4. Créer un FTP — 30 s

Tableau de bord › **FTP** › **Nouveau compte** :

1. Identifiant et mot de passe : un mot de passe est proposé automatiquement.
2. Dossier partagé : un dossier dédié, celui d'un projet, ou **n'importe quel dossier du PC** (collez son chemin).
3. **Créer le compte**, puis **FileZilla** pour télécharger la connexion toute prête (dans FileZilla : *Fichier › Importer*).

> **Retrouver le FTP de docker-env à l'identique** : identifiant `ftpuser`, mot de passe `ftppass` (ou ceux de votre `.env` docker-env), dossier `C:\docker-server\repo`. Les applications qui utilisaient l'hôte `ftp` fonctionnent sans changement.

---

## Bon à savoir

- **Arrêter / relancer** : `stop.cmd` / `start.cmd`.
- **Mails** : tous capturés, sur http://mailpit.localhost. Le SMTP `mailpit:1025` est inchangé.
- **DB Admin** : http://dbadmin.localhost, le même outil que dans docker-env.
- **Xdebug** : onglet *Xdebug* du projet. Il est en mode « Sur demande » par défaut, sur le **port 9003** pour toutes les versions de PHP (docker-env utilisait 9000 en PHP 5.6 / 7.2).
- **Logs, terminal, Composer** : dans les onglets de chaque projet.
- **Erreur « rate limit » au premier lancement** : faites `docker login` (compte Docker gratuit), puis relancez.
- **Quand tout fonctionne**, supprimez les containers de docker-env : `cd C:\docker-env` puis `.\env down`. Ses données MySQL restent dans leur volume Docker.
