import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { createApp } from './app.js';
import { loadCases } from './cases.js';
import { openDatabase } from './database.js';

export async function startServer(development = false) {
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env.PORT ?? 3001);
  const webPort = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env.WEB_PORT ?? 5173);
  const cases = await loadCases(resolve('data/cases'));
  const database = openDatabase(resolve('data/app.sqlite'));
  const origins = [`http://127.0.0.1:${port}`];
  if (development) origins.push(`http://127.0.0.1:${webPort}`);
  const app = createApp(cases, database, origins);
  if (!development) {
    const webDirectory = resolve('dist/web');
    if (!existsSync(resolve(webDirectory, 'index.html'))) {
      database.close();
      throw new Error(
        'Frontend build is missing. Run npm run build before npm start.',
      );
    }
    app.use(express.static(webDirectory));
  }
  const server = app.listen(port, '127.0.0.1');
  try {
    await new Promise<void>((accept, reject) => {
      server.once('listening', accept);
      server.once('error', reject);
    });
  } catch (error) {
    database.close();
    throw error;
  }
  console.log(`API ready: http://127.0.0.1:${port} (${cases.size} exercises)`);
  return { server, database };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { server, database } = await startServer();
  const stop = () =>
    server.close(() => {
      database.close();
      process.exit(0);
    });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
