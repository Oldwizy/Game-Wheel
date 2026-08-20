import { spawn } from 'node:child_process';
import { once } from 'node:events';
import httpServer from 'http-server';

const host = '127.0.0.1';
const port = 4173;
const baseURL = `http://${host}:${port}`;
let server = null;

async function serverIsAvailable() {
  try {
    await fetch(baseURL, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function startServer() {
  server = httpServer.createServer({ root: process.cwd(), cache: -1 });
  await new Promise((resolve, reject) => {
    server.server.once('error', reject);
    server.listen(port, host, resolve);
  });
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.server.close(error => error ? reject(error) : resolve());
  });
}

if (!await serverIsAvailable()) await startServer();

const playwright = spawn(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
  { stdio: 'inherit' }
);
const [exitCode] = await once(playwright, 'exit');

await stopServer();
process.exitCode = exitCode ?? 1;
