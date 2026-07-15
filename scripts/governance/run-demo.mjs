#!/usr/bin/env node
/**
 * Orchestrates the Phase 2 governance demo: seeds a temporary local KB +
 * sqlite database (packages/web/tests/e2e/demo-fixtures.ts), starts the
 * real server against it, records the scripted Playwright review session
 * (packages/web/tests/e2e/review-session.spec.ts), stops the server, and
 * assembles the full evidence bundle under build/phase2-demo/.
 *
 * `--seed-only` seeds and prints the generated credentials/proposal ids,
 * then exits without starting the server or running Playwright -- useful
 * for driving the same server manually (see docs/phase-2-governance-demo.md).
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './evidence.mjs';

const REPO_ROOT = repoRoot();
const WEB_ROOT = path.join(REPO_ROOT, 'packages', 'web');
const DEMO_DIR = path.join(REPO_ROOT, 'build', 'phase2-demo');
const SEED_ONLY = process.argv.includes('--seed-only');

function log(message) {
  console.log(`[demo] ${message}`);
}

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...opts });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))));
    child.on('error', reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForHealth(origin, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/api/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${origin} never became healthy: ${lastErr?.message ?? 'timed out'}`);
}

async function seed() {
  log('seeding a fresh temporary KB + governed database under build/phase2-demo/ ...');
  await run('npx', ['tsx', 'tests/e2e/demo-fixtures.ts'], { cwd: WEB_ROOT });
  const manifest = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'seed-manifest.json'), 'utf-8'));
  return manifest;
}

async function startServer(manifest, port) {
  const origin = `http://127.0.0.1:${port}`;
  // The real built client (dist/client), not `tsx src/server/index.ts`
  // directly: the server resolves its static-file root relative to its own
  // __dirname assuming it runs from dist/server, so running from source
  // would 404 every asset. This also matches the recording's intent -- a
  // session against the actual production bundle, not a dev server.
  const serverEntry = path.join(WEB_ROOT, 'dist', 'server', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    log('dist/server/index.js not found -- building @algerknown/web first...');
    await run('npm', ['run', 'build', '--workspace=@algerknown/web'], { cwd: REPO_ROOT });
  }
  const child = spawn('node', [serverEntry], {
    cwd: WEB_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      WEB_HOST: '127.0.0.1',
      GOVERNANCE_PUBLIC_ORIGIN: origin,
      GOVERNANCE_REVIEWER_ID: manifest.reviewerId,
      GOVERNANCE_REVIEWER_DISPLAY_NAME: manifest.reviewerDisplayName,
      GOVERNANCE_REVIEWER_SECRET: manifest.reviewerSecret,
      GOVERNANCE_PROCESSOR_ID: manifest.processorId,
      GOVERNANCE_PROCESSOR_SECRET: manifest.processorSecret,
      ALGERKNOWN_ROOT: manifest.algerknownRoot,
      GOVERNANCE_DB_PATH: manifest.dbPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrBuf = '';
  child.stderr?.on('data', (chunk) => (stderrBuf += String(chunk)));
  const exitedEarly = new Promise((_resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`server exited early (code ${code}) before becoming healthy:\n${stderrBuf}`)));
  });
  await Promise.race([waitForHealth(origin, 30_000), exitedEarly]).catch((err) => {
    child.kill('SIGKILL');
    throw err;
  });
  log(`server healthy at ${origin}`);
  return { child, origin };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timedOut = await Promise.race([exited.then(() => false), new Promise((resolve) => setTimeout(() => resolve(true), 5000))]);
  if (timedOut) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function runPlaywright(origin) {
  log('recording the scripted Algerknown review session (Playwright, Chromium)...');
  await run('npx', ['playwright', 'test'], {
    cwd: WEB_ROOT,
    env: { ...process.env, PHASE2_DEMO_BASE_URL: origin },
  });
}

async function collectSupplementaryArtifacts() {
  log('collecting supplementary evidence artifacts...');

  const evidenceDir = path.join(REPO_ROOT, 'build', 'phase2-acceptance', 'evidence');
  function readEvidence(checkId) {
    const file = path.join(evidenceDir, `${checkId}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : { checkId, cases: [], note: 'no build/phase2-acceptance evidence found -- run `npm run test:phase2` first for a fully populated demo bundle' };
  }

  fs.writeFileSync(path.join(DEMO_DIR, 'rail-matrix.json'), JSON.stringify(readEvidence('ec1-structural-rails'), null, 2));
  fs.writeFileSync(path.join(DEMO_DIR, 'read-model-rebuild.json'), JSON.stringify(readEvidence('ec5-read-model-rebuild'), null, 2));
  fs.writeFileSync(path.join(DEMO_DIR, 'recovery-report.json'), JSON.stringify(readEvidence('ec6-restart-crash-recovery'), null, 2));
  fs.writeFileSync(
    path.join(DEMO_DIR, 'boundary-audit.json'),
    JSON.stringify({ static: readEvidence('ec8-no-write-bypass'), authenticatedBoundary: readEvidence('ec7-authenticated-boundary') }, null, 2),
  );

  const conformance = readEvidence('ec3-backend-conformance');
  const lines = [
    'Phase 2 demo -- backend conformance summary',
    `generated: ${new Date().toISOString()}`,
    '',
    ...conformance.cases.map((c) => `[${c.status}] backend=${c.backend} case=${c.caseId} suite=${c.suite} durationMs=${c.durationMs}`),
  ];
  if (conformance.cases.length === 0) lines.push('(no cases found -- run `npm run test:phase2:conformance` first for a fully populated demo bundle)');
  fs.writeFileSync(path.join(DEMO_DIR, 'backend-conformance.txt'), lines.join('\n') + '\n');
}

async function main() {
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  const manifest = await seed();
  log(`reviewer secret (test-only, never a real credential): ${manifest.reviewerSecret}`);

  if (SEED_ONLY) {
    log('--seed-only: skipping server start and Playwright recording.');
    return;
  }

  const port = await freePort();
  const { child, origin } = await startServer(manifest, port);
  try {
    await runPlaywright(origin);
  } finally {
    await stopServer(child);
  }
  await collectSupplementaryArtifacts();
  log(`done. Artifacts under ${path.relative(REPO_ROOT, DEMO_DIR)}/`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
