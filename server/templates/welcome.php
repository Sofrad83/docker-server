<?php
/*
 * Page d'accueil créée par docker-server. Remplacez ce fichier par votre code.
 */
$mailSent = null;
if (isset($_GET['mail'])) {
    $mailSent = @mail('test@example.com', 'Test docker-server', "Ce mail a été envoyé par PHP " . PHP_VERSION . ".\nIl est capturé par Mailpit : rien ne part vraiment.");
}

$db = ['ok' => false, 'msg' => 'Extension pdo_mysql absente'];
if (extension_loaded('pdo_mysql')) {
    try {
        $pdo = new PDO('mysql:host=mysql;port=3306', 'root', '', [PDO::ATTR_TIMEOUT => 3]);
        $db = ['ok' => true, 'msg' => $pdo->query('SELECT VERSION()')->fetchColumn()];
    } catch (Exception $e) {
        $db = ['ok' => false, 'msg' => $e->getMessage()];
    }
}

$extensions = get_loaded_extensions();
natcasesort($extensions);
$xdebug = extension_loaded('xdebug') ? (ini_get('xdebug.start_with_request') ?: (ini_get('xdebug.remote_autostart') ? 'yes' : 'trigger')) : null;
$https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, "UTF-8"); }
?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h(basename(__DIR__)) ?> — ça marche !</title>
<style>
  :root { --bg:#f5f6f8; --card:#fff; --line:#e4e7ec; --text:#0f172a; --muted:#64748b; --accent:#5146e5; --ok:#15803d; --ko:#b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0d12; --card:#12151c; --line:#232836; --text:#e6e8ee; --muted:#98a2b3; --accent:#8b85ff; --ok:#4ade80; --ko:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:860px; margin:0 auto; padding:56px 20px; }
  .hero { display:flex; gap:18px; align-items:center; margin-bottom:32px; }
  .badge { width:56px; height:56px; border-radius:16px; background:var(--accent); color:#fff; display:grid; place-items:center; font-size:28px; flex:none; }
  h1 { margin:0; font-size:28px; letter-spacing:-.02em; }
  .muted { color:var(--muted); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:14px; margin-bottom:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
  .card h2 { margin:0 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; }
  .big { font-size:20px; font-weight:650; }
  .ok { color:var(--ok); } .ko { color:var(--ko); }
  code { font:13px ui-monospace,"Cascadia Code",Consolas,monospace; background:var(--bg); border:1px solid var(--line); padding:1px 6px; border-radius:6px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chips span { font:12px ui-monospace,Consolas,monospace; padding:3px 8px; border-radius:999px; background:var(--bg); border:1px solid var(--line); }
  a.btn { display:inline-block; margin-top:8px; padding:7px 12px; border-radius:9px; background:var(--accent); color:#fff; text-decoration:none; font-weight:600; font-size:13px; }
  ol { margin:8px 0 0; padding-left:20px; } li { margin:4px 0; }
</style>
</head>
<body>
<main>
  <div class="hero">
    <div class="badge">✓</div>
    <div>
      <h1>Ça marche !</h1>
      <div class="muted">Le projet <strong><?= h(basename(__DIR__)) ?></strong> est servi par docker-server<?= $https ? ' en HTTPS' : '' ?>.</div>
    </div>
  </div>

  <div class="grid">
    <div class="card"><h2>PHP</h2><div class="big"><?= h(PHP_VERSION) ?></div><div class="muted"><?= h(php_sapi_name()) ?> · <?= h(date_default_timezone_get()) ?></div></div>
    <div class="card"><h2>Base de données</h2>
      <div class="big <?= $db['ok'] ? 'ok' : 'ko' ?>"><?= $db['ok'] ? 'Connectée' : 'Indisponible' ?></div>
      <div class="muted"><?= $db['ok'] ? 'mysql:3306 · ' . h($db['msg']) : h($db['msg']) ?></div>
    </div>
    <div class="card"><h2>Xdebug</h2><div class="big"><?= $xdebug ? ($xdebug === 'yes' ? 'Toujours actif' : 'Sur demande') : 'Désactivé' ?></div><div class="muted">Réglable dans l'onglet Xdebug</div></div>
    <div class="card"><h2>Mails</h2>
      <?php if ($mailSent === null): ?>
        <div class="muted">Les mails de PHP sont capturés par Mailpit.</div><a class="btn" href="?mail=1">Envoyer un mail de test</a>
      <?php else: ?>
        <div class="big <?= $mailSent ? 'ok' : 'ko' ?>"><?= $mailSent ? 'Envoyé' : 'Échec' ?></div><div class="muted">Voir sur <code>mailpit.localhost</code></div>
      <?php endif ?>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <h2>Et maintenant ?</h2>
    <ol>
      <li>Remplacez ce fichier <code>index.php</code> par votre code, dans <code>repo/<?= h(basename(__DIR__)) ?>/</code>.</li>
      <li>Connectez-vous à MySQL avec l'hôte <code>mysql</code>, l'utilisateur <code>root</code>, sans mot de passe.</li>
      <li>Version de PHP, extensions, Composer, logs et terminal : tout se règle dans le tableau de bord.</li>
    </ol>
  </div>

  <div class="card">
    <h2><?= count($extensions) ?> extensions chargées</h2>
    <div class="chips"><?php foreach ($extensions as $e): ?><span><?= h($e) ?></span><?php endforeach ?></div>
  </div>
</main>
</body>
</html>
