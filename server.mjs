import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const inside = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

export function createAppServer({ rootDir = projectRoot } = {}) {
  const root = path.resolve(rootDir);
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return reply(405, 'Use GET ou HEAD para consultar o laboratório.'); }
    let pathname;
    try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
    catch { return reply(400, 'O endereço contém uma codificação inválida.'); }
    if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || pathname.split('/').some(part => part.startsWith('.'))) {
      return reply(403, 'Este caminho não está disponível no laboratório.');
    }
    if (pathname === '/') pathname = '/index.html';
    if (!(pathname === '/index.html' || pathname.startsWith('/src/') || pathname.startsWith('/public/'))) return reply(404, 'Arquivo não encontrado.');
    const requested = path.resolve(root, `.${pathname}`);
    if (!inside(root, requested)) return reply(403, 'Este caminho não está disponível no laboratório.');
    try {
      const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(requested)]);
      const scope = pathname.startsWith('/src/') ? 'src' : pathname.startsWith('/public/') ? 'public' : '';
      const permittedRoot = path.join(actualRoot, scope);
      if (path.relative(actualRoot, actualFile).split(path.sep).some(part => part.startsWith('.'))) return reply(403, 'Este caminho não está disponível no laboratório.');
      if (!inside(permittedRoot, actualFile) || (scope === '' && actualFile !== path.join(actualRoot, 'index.html'))) return reply(403, 'Este caminho não está disponível no laboratório.');
      if (!(await stat(actualFile)).isFile()) return reply(404, 'Arquivo não encontrado.');
      const body = await readFile(actualFile);
      res.writeHead(200, { 'Content-Type': mime[path.extname(actualFile).toLowerCase()] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      reply(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500, 'Não foi possível abrir este arquivo do laboratório.');
    }
  });
}

export async function startServer({ port = 4173, rootDir = projectRoot } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('A porta deve ser um inteiro entre 0 e 65535.');
  const server = createAppServer({ rootDir });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = process.argv[2] ?? process.env.PORT ?? '4173';
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    console.error('Informe uma porta inteira entre 1 e 65535.');
    process.exitCode = 1;
  } else {
    try { const server = await startServer({ port: Number(raw) }); console.log(`Laboratório disponível em http://127.0.0.1:${server.address().port}`); }
    catch (error) { console.error(`Não foi possível iniciar o laboratório: ${error.message}`); process.exitCode = 1; }
  }
}

