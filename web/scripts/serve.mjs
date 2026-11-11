import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT phai la so nguyen tu 1 den 65535.');
const localUrl = `http://127.0.0.1:${port}`;
function openBrowser() {
  if (!process.argv.includes('--open')) return;
  // Only a fixed loopback URL is passed to the system browser launcher.
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', localUrl] : [localUrl];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Mo thu cong: ${localUrl}`));
  child.unref();
}
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root) || !(await stat(filename)).isFile()) throw new Error('Not found');
    const body = await readFile(filename);
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(localUrl, { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.text()).includes('<title>Signature Cleaner')) {
        console.log(`Signature Cleaner da chay: ${localUrl}`); openBrowser(); return;
      }
    } catch { /* Report the port conflict below. */ }
  }
  console.error(error.message); process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => { console.log(`Signature Cleaner: ${localUrl}`); openBrowser(); });
