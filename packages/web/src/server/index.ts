import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { entriesRouter } from './routes/entries.js';
import { linksRouter } from './routes/links.js';
import { searchRouter } from './routes/search.js';
import { configRouter } from './routes/config.js';
import { createGovernanceAuthRouter } from './routes/governance-auth.js';
import { createGovernanceRouter } from './routes/governance.js';
import { createGovernanceRuntime } from './auth/index.js';
import { createGovernanceComposition } from './governance/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env - try multiple locations for flexibility
// 1. Monorepo root (when running from dist/server)
// 2. packages/web (when running locally)
const envPaths = [
  path.resolve(__dirname, '../../../..', '.env'),  // from dist/server
  path.resolve(__dirname, '../..', '.env'),        // from src/server  
];
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`Loaded .env from ${envPath}`);
    break;
  }
}

const app = express();
const PORT = process.env.PORT || 2393;
// Loopback by default; see docs/springfield-deployment.md before binding
// this anywhere else.
const HOST = process.env.WEB_HOST || '127.0.0.1';

// Middleware
// No CORS middleware: the SPA and API share one origin, and the browser
// governance trust boundary depends on that being true (see
// docs/springfield-deployment.md).
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/entries', entriesRouter);
app.use('/api/links', linksRouter);
app.use('/api/search', searchRouter);
app.use('/api/config', configRouter);

// Governance (Phase 2 single-operator trust profile + this cohort's
// governed HTTP API). Only mounted when GOVERNANCE_REVIEWER_*/
// GOVERNANCE_PROCESSOR_* are configured; fails closed (throws at startup,
// crashing the process) rather than mounting a half-configured governance
// surface. The composition root builds+migrates the durable SQLite proposal
// store, registers the Algerknown git repositories, constructs the single
// WriteOrchestrator/DurableProposalService, and runs crash recovery before
// any governance route is reachable.
const governanceRuntime = createGovernanceRuntime();
async function mountGovernance(): Promise<void> {
  if (!governanceRuntime.config.enabled) {
    console.log('Governance disabled: no GOVERNANCE_REVIEWER_*/GOVERNANCE_PROCESSOR_* configured');
    return;
  }
  app.use('/api/governance/auth', createGovernanceAuthRouter(governanceRuntime));
  const sweepIntervalMs = 5 * 60 * 1000;
  setInterval(() => governanceRuntime.sessionRegistry.sweepExpired(), sweepIntervalMs).unref();

  const composition = await createGovernanceComposition({ clock: governanceRuntime.clock });
  app.use('/api/governance', createGovernanceRouter(governanceRuntime, composition));
}

async function main(): Promise<void> {
  await mountGovernance();

  // Proxy RAG backend requests
  const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || 'http://localhost:4735';
  app.all('/rag/*', async (req, res) => {
    const ragPath = req.url.replace(/^\/rag\//, '');
    try {
      const response = await fetch(`${RAG_BACKEND_URL}/${ragPath}`, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: JSON.stringify(req.body) } : {}),
      });
      const data = await response.text();
      res.status(response.status).type('json').send(data);
    } catch {
      res.status(502).json({ error: 'RAG backend unavailable' });
    }
  });

  // Serve static files from the client build
  const clientDistPath = path.join(__dirname, '../client');
  app.use(express.static(clientDistPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });

  // Error handler. The internal message is logged server-side but never
  // returned to the client -- echoing err.message leaks internals (namespace
  // names, configured engines, stack context) to the caller.
  app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Server error:', err);
    // Once the response has started streaming we can no longer set a status or
    // body; delegate to Express's built-in handler (which aborts the socket)
    // rather than throwing "Can't set headers after they are sent" and masking
    // the original error.
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(Number(PORT), HOST, () => {
    console.log(`API server running on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export { app };
