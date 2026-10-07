// Client du backend (public/api.php → src/Actions.php).
import { h, toast } from './lib.js';

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** api('rows', {s, db, table}) → objet JSON ; lève ApiError (message SQL lisible) en cas d'erreur. */
export async function api(action, params = {}) {
  let res;
  try {
    res = await fetch('api.php?a=' + encodeURIComponent(action), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
    });
  } catch (e) {
    throw new ApiError('Serveur injoignable : ' + e.message);
  }
  let data;
  try { data = await res.json(); } catch { throw new ApiError(`Réponse invalide du serveur (HTTP ${res.status}).`); }
  if (!res.ok || data.ok === false) throw new ApiError(data.error || 'HTTP ' + res.status, data.code);
  return data;
}

/** Import d'un fichier .sql / .sql.gz : XHR pour suivre la progression de l'envoi. */
export function uploadImport(fields, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v != null) fd.append(k, v);
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api.php?a=import');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.upload.onload = () => onProgress?.(1);
    xhr.onerror = () => reject(new ApiError('Envoi interrompu.'));
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { return reject(new ApiError(`Réponse invalide (HTTP ${xhr.status}).`)); }
      data.ok === false || xhr.status >= 400 ? reject(new ApiError(data.error || 'HTTP ' + xhr.status, data.code)) : resolve(data);
    };
    xhr.send(fd);
  });
}

/**
 * Export en téléchargement : le navigateur télécharge le flux directement (pas de fichier en mémoire).
 * Un POST de formulaire vers un iframe caché ; si le serveur répond par une erreur JSON, on l'affiche.
 */
export function downloadExport(opts) {
  let frame = document.getElementById('dba-dl');
  if (!frame) {
    frame = h('iframe', { id: 'dba-dl', name: 'dba-dl', style: { display: 'none' } });
    frame.addEventListener('load', () => {
      try {
        const txt = frame.contentDocument.body.innerText.trim();
        if (txt.startsWith('{')) toast(JSON.parse(txt).error || 'Export impossible.', 'error');
      } catch { /* téléchargement en cours : pas de document à lire */ }
    });
    document.body.append(frame);
  }
  const form = h('form', { method: 'post', action: 'api.php?a=export', target: 'dba-dl', style: { display: 'none' } },
    h('input', { name: 'opts', value: JSON.stringify(opts) }));
  document.body.append(form); form.submit(); form.remove();
}
