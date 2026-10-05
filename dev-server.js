// Local preview: `npm run dev`, then open http://localhost:3000
// Serves public/ and runs api/*.js the way Vercel does. Uses in-memory storage
// unless Redis env vars are set. Organizer password defaults to "admin" locally.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = +process.env.PORT || 3000;
const root = path.resolve('public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z]/g, '');
      const mod = await import(`./api/${name}.js`);
      return await mod.default(req, res);
    }
    let file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(root)) throw new Error('bad path');
    const data = await readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch (e) {
    res.statusCode = 404; res.end('Not found');
  }
}).listen(PORT, () => console.log(`Powerball running at http://localhost:${PORT}`));
