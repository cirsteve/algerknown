import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { entriesRouter } from './routes/entries.js';
import { linksRouter } from './routes/links.js';
import { searchRouter } from './routes/search.js';
import { configRouter } from './routes/config.js';
import { createGovernanceAuthRouter } from './routes/governance-auth.js';
import { createGovernanceRuntime } from './auth/index.js';

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

// Governance auth (Phase 2 single-operator trust profile). Only mounted
// when GOVERNANCE_REVIEWER_*/GOVERNANCE_PROCESSOR_* are configured; fails
// closed (throws at startup) rather than mounting a half-configured
// governance surface.
const governanceRuntime = createGovernanceRuntime();
if (governanceRuntime.config.enabled) {
  app.use('/api/governance/auth', createGovernanceAuthRouter(governanceRuntime));
  const sweepIntervalMs = 5 * 60 * 1000;
  setInterval(() => governanceRuntime.sessionRegistry.sweepExpired(), sweepIntervalMs).unref();
} else {
  console.log('Governance auth disabled: no GOVERNANCE_REVIEWER_*/GOVERNANCE_PROCESSOR_* configured');
}

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

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});

export { app };
