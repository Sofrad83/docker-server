// Terminal dans le navigateur : xterm.js relié au container par WebSocket.
import { Terminal } from '/vendor/xterm/xterm.mjs';
import { FitAddon } from '/vendor/xterm/addon-fit.mjs';
import { h, icon } from '../lib.js';

const THEME = {
  background: '#0d1017',
  foreground: '#d7dce5',
  cursor: '#8b85ff',
  selectionBackground: '#3a3f5c',
  black: '#1b1f2a', red: '#ff6b6b', green: '#4ade80', yellow: '#fbbf24', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d7dce5',
  brightBlack: '#5c6370', brightRed: '#ff8787', brightGreen: '#86efac', brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
};

/**
 * terminal(container, { root, command }) → { el, destroy, run }
 * command : commande tapée automatiquement à l'ouverture (ex. « npm run dev »).
 */
export function terminal(container, { root = false, command } = {}) {
  const screen = h('div.term-screen');
  const overlay = h('div.term-overlay');
  const el = h('div.term', screen, overlay);
  const term = new Terminal({
    fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    theme: THEME,
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  let ws = null;
  let pending = command || null;
  const enc = new TextEncoder();
  let ro = null;
  let opened = false;

  function connect() {
    overlay.hidden = true;
    ws?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/terminal?container=${encodeURIComponent(container)}&cols=${term.cols}&rows=${term.rows}${root ? '&root=1' : ''}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      term.focus();
      if (pending) {
        const cmd = pending;
        pending = null;
        setTimeout(() => ws?.readyState === 1 && ws.send(enc.encode(`${cmd}\r`)), 400);
      }
    };
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
    ws.onclose = () => {
      overlay.hidden = false;
      overlay.replaceChildren(h('div.term-closed',
        h('p', 'Session terminée.'),
        h('button.btn.btn-primary.btn-sm', { onclick: () => { term.reset(); connect(); } }, icon('refresh', 14), 'Nouvelle session')));
    };
  }

  term.onData((d) => ws?.readyState === 1 && ws.send(enc.encode(d)));
  term.onResize(({ cols, rows }) => ws?.readyState === 1 && ws.send(JSON.stringify({ resize: [cols, rows] })));

  // Ouverture différée : xterm a besoin d'un élément visible pour mesurer.
  function open() {
    if (opened || !el.isConnected || !el.offsetWidth) return;
    opened = true;
    term.open(screen);
    try { fit.fit(); } catch { /* pas encore mesurable */ }
    connect();
  }
  ro = new ResizeObserver(() => {
    if (!opened) open();
    else try { fit.fit(); } catch { /* ignoré */ }
  });
  ro.observe(el);

  return {
    el,
    focus: () => term.focus(),
    run(cmd) {
      if (ws?.readyState === 1) ws.send(enc.encode(`${cmd}\r`));
      else pending = cmd;
      term.focus();
    },
    destroy() {
      ro?.disconnect();
      ws?.close();
      term.dispose();
    },
  };
}
