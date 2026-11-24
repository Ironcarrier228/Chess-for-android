/* Мини-сервер для локального запуска и превью (без зависимостей). */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve('.');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-cache',
      // чтобы приложение можно было встроить в iframe превью
      'x-frame-options': 'ALLOWALL',
      'content-security-policy': '',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Server error: ' + err.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Гамбит запущен: http://${HOST}:${PORT}`);
});
