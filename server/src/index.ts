import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.ts';
import { api } from './routes.ts';

const app = express();
app.use(express.json({ limit: '5mb' }));

// CORS: allow local frontends only
app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use('/api', api);

// serve built frontend when available (production single-server mode)
const webDist = path.resolve(import.meta.dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`[evolus-red] server listening on http://localhost:${config.port}`);
  console.log(`[evolus-red] mock target:   http://localhost:${config.port}/api/mock/target`);
});
