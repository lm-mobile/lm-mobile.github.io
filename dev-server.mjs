// Runs worker.js on your own computer for testing:  node dev-server.mjs 8787
// Then open http://localhost:8787/ in a browser.
import http from 'node:http';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]) || 8787;

// Node only treats .mjs files as modules reliably, so load a copy of worker.js under that name.
const copy = join(here, '.worker-dev.mjs');
writeFileSync(copy, readFileSync(join(here, 'worker.js')));
const { default: worker } = await import(pathToFileURL(copy).href);
unlinkSync(copy);

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const noBody = req.method === 'GET' || req.method === 'HEAD';
    const request = new Request('http://localhost:' + port + req.url, {
      method: req.method,
      headers: req.headers,
      body: noBody ? undefined : Buffer.concat(chunks)
    });
    const response = await worker.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('dev server error: ' + err.message);
  }
}).listen(port, () => console.log('Learnable Meta relay dev server: http://localhost:' + port + '/'));
