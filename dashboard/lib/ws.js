'use strict';
/** Serveur WebSocket minimal (RFC 6455) — juste ce qu'il faut pour le terminal. */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsConnection extends EventEmitter {
  constructor(socket, head) {
    super();
    this.socket = socket;
    this.buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.fragments = [];
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.parse();
    });
    socket.on('close', () => this.terminate());
    socket.on('error', () => this.terminate());
    if (this.buf.length) setImmediate(() => this.parse());
  }

  parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;
      const mask = masked ? this.buf.subarray(off, off + 4) : null;
      const payload = Buffer.from(this.buf.subarray(off + maskLen, off + maskLen + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + maskLen + len);

      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.frame(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        if (op !== 0x0) this.fragments = [{ op, data: payload }];
        else this.fragments.push({ op: 0, data: payload });
        if (fin) {
          const first = this.fragments[0];
          const data = Buffer.concat(this.fragments.map((f) => f.data));
          this.fragments = [];
          this.emit('message', first && first.op === 0x1 ? data.toString('utf8') : data);
        }
      }
    }
  }

  frame(op, data) {
    if (this.closed) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    let head;
    if (payload.length < 126) {
      head = Buffer.from([0x80 | op, payload.length]);
    } else if (payload.length < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(payload.length, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(data) {
    this.frame(Buffer.isBuffer(data) ? 0x2 : 0x1, data);
  }

  close() {
    if (this.closed) return;
    try { this.frame(0x8, Buffer.alloc(0)); } catch { /* socket déjà fermé */ }
    this.terminate();
  }

  terminate() {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.emit('close');
  }
}

/** Termine la poignée de main HTTP → WebSocket. */
function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const digest = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${digest}`,
    '', '',
  ].join('\r\n'));
  return new WsConnection(socket, head);
}

module.exports = { accept };
