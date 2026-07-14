import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as core from '@algerknown/core';
import { entriesRouter } from '../../src/server/routes/entries.js';
import { linksRouter } from '../../src/server/routes/links.js';

describe('legacy write routes respect the governed boundary', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-boundary-'));
    core.init(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function buildApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.headers['x-zkb-path'] = root;
      next();
    });
    app.use('/api/entries', entriesRouter);
    app.use('/api/links', linksRouter);
    return app;
  }

  function governDossier(relativePath: string, namespace: string): void {
    const manifestPath = path.join(root, '.algerknown', 'governed-boundary.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ version: 1, generatedAt: new Date(0).toISOString(), managedPaths: [relativePath], namespaces: { [relativePath]: namespace } }),
    );
  }

  it('allows POST/PUT/DELETE for a legacy_ungoverned entry', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/entries').send({ id: 'legacy-1', type: 'summary', topic: 'T', status: 'active', summary: 'S' });
    expect(created.status).toBe(201);

    const updated = await request(app).put('/api/entries/legacy-1').send({ summary: 'Updated' });
    expect(updated.status).toBe(200);

    const deleted = await request(app).delete('/api/entries/legacy-1');
    expect(deleted.status).toBe(200);
  });

  it('rejects PUT/DELETE on a governed entry with 409 governed_write_required', async () => {
    core.writeEntry({ id: 'governed-1', type: 'summary', topic: 'T', status: 'active', summary: 'S' } as core.Summary, root);
    governDossier('summaries/governed-1.yaml', 'canonical.project.demo');

    const app = buildApp();
    const updated = await request(app).put('/api/entries/governed-1').send({ summary: 'Updated' });
    expect(updated.status).toBe(409);
    expect(updated.body.error).toBe('governed_write_required');
    expect(updated.body.namespace).toBe('canonical.project.demo');

    const deleted = await request(app).delete('/api/entries/governed-1');
    expect(deleted.status).toBe(409);
    expect(deleted.body.error).toBe('governed_write_required');

    // Neither request actually mutated the file.
    const stillThere = core.readEntry('governed-1', root);
    expect((stillThere as core.Summary)?.summary).toBe('S');
  });

  it('rejects POST /api/links when the source entry is governed', async () => {
    core.writeEntry({ id: 'governed-src', type: 'summary', topic: 'T', status: 'active', summary: 'S' } as core.Summary, root);
    core.writeEntry({ id: 'legacy-target', type: 'summary', topic: 'T2', status: 'active', summary: 'S2' } as core.Summary, root);
    governDossier('summaries/governed-src.yaml', 'canonical.project.demo');

    const app = buildApp();
    const res = await request(app).post('/api/links').send({ sourceId: 'governed-src', targetId: 'legacy-target', relationship: 'informs' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('governed_write_required');
  });
});
