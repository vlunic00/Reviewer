import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createServer } from 'vite';
import { startServer } from '../apps/server/src/index.js';

if (existsSync('.env')) loadEnvFile('.env');
const vite = await createServer();
let backend: Awaited<ReturnType<typeof startServer>> | undefined;
try {
  backend = await startServer(true);
  await vite.listen();
  vite.printUrls();
} catch (error) {
  await vite.close();
  if (backend) {
    const running = backend;
    running.stopAssessments();
    await new Promise<void>((done) => running.server.close(() => done()));
    running.database.close();
  }
  throw error;
}
async function stop() {
  await vite.close();
  if (backend) {
    const running = backend;
    running.stopAssessments();
    await new Promise<void>((done) => running.server.close(() => done()));
    running.database.close();
  }
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
