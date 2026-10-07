'use strict';
/** Archive tar minimale (format ustar) pour les contextes de build Docker. */

function header(name, size, mode) {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 100, 'utf8');
  h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

/** files : { 'Dockerfile': 'contenu', 'entrypoint.sh': { content, mode: 0o755 } } */
function tar(files) {
  const parts = [];
  for (const [name, value] of Object.entries(files)) {
    const content = typeof value === 'object' && !Buffer.isBuffer(value) ? value.content : value;
    const mode = (typeof value === 'object' && value.mode) || 0o644;
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    parts.push(header(name, data.length, mode), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

module.exports = { tar };
