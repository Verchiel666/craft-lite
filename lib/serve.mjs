// craft-lite · serve.mjs — the Ready step: a tiny static server with the MIME types browsers demand.
// .wasm must be application/wasm or the browser refuses to stream-compile it.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function serve(dir, { port = 8787, host = '127.0.0.1', log = console.log } = {}) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const full = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
      if (!full.startsWith(root)) { res.writeHead(403).end('403'); return; }
      const info = await stat(full).catch(() => null);
      if (!info || !info.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end(`404 ${pathname}`); return; }
      const body = await readFile(full);
      res.writeHead(200, {
        'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-cache',
      });
      log(`${new Date().toISOString()} ${req.method} ${pathname} 200 ${body.length}`);
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(`500 ${err.message}`);
    }
  });
  return new Promise((res) => server.listen(port, host, () => res({ server, url: `http://${host}:${port}/` })));
}
