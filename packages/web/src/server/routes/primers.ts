import { Router, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as core from '@algerknown/core';
import { getZkbPath } from '../utils/zkb-path.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  let createdSourcePath: string | null = null;

  try {
    const root = getZkbPath(req);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    const { content, ...input } = req.body as Partial<core.Primer> & { content?: unknown };
    const id = input.id?.trim();
    const topic = input.topic?.trim();
    const status = input.status?.trim() as core.Status | undefined;

    if (!id || !topic || !status) {
      return res.status(400).json({ error: 'id, topic, and status are required' });
    }
    if (!/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'id must contain only lowercase letters, numbers, and hyphens' });
    }
    if (core.entryExists(id, root)) {
      return res.status(409).json({ error: `An entry with ID "${id}" already exists` });
    }

    const hasPastedContent = typeof content === 'string' && content.trim().length > 0;
    const suppliedPath = input.source?.path?.trim();
    if (hasPastedContent === Boolean(suppliedPath)) {
      return res.status(400).json({ error: 'Provide either a source path or pasted Markdown content' });
    }

    let sourcePath: string;
    if (hasPastedContent) {
      const sourceDir = path.join(root, 'primer-sources');
      sourcePath = path.join(sourceDir, `${id}.md`);
      if (fs.existsSync(sourcePath)) {
        return res.status(409).json({ error: `A pasted source already exists for "${id}"` });
      }
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(sourcePath, content as string, { encoding: 'utf8', flag: 'wx' });
      createdSourcePath = sourcePath;
      sourcePath = core.assertAllowedSourcePath(sourcePath);
    } else {
      sourcePath = core.assertAllowedSourcePath(suppliedPath!);
    }

    const primer: core.Primer = {
      id,
      type: 'primer',
      topic,
      status,
      source: { ...input.source, path: sourcePath },
      ...(input.document ? { document: input.document } : {}),
      ...(input.section ? { section: input.section } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
    };
    const validation = core.validate(primer, root);
    if (!validation.valid) {
      if (createdSourcePath) fs.unlinkSync(createdSourcePath);
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    core.writeEntry(primer, root);
    res.status(201).json(primer);
  } catch (error) {
    if (createdSourcePath && fs.existsSync(createdSourcePath)) fs.unlinkSync(createdSourcePath);
    if (error instanceof core.SourcePathError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Failed to create primer:', error);
    res.status(500).json({ error: 'Failed to create primer' });
  }
});

function readPrimer(id: string, root: string): core.Primer | null {
  const entry = core.readEntry(id, root);
  return entry?.type === 'primer' ? entry : null;
}

router.get('/', (req: Request, res: Response) => {
  try {
    const root = getZkbPath(req);
    const primers = Object.keys(core.getIndex(root).entries)
      .map((id) => readPrimer(id, root))
      .filter((primer): primer is core.Primer => primer !== null);
    res.json(primers);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/:id/source', (req: Request, res: Response) => {
  try {
    const primer = readPrimer(req.params.id, getZkbPath(req));
    if (!primer) return res.status(404).json({ error: 'Primer not found' });
    const path = core.assertAllowedSourcePath(primer.source.path);
    res.json({ content: core.readPrimerSource(primer), path, mtime: fs.statSync(path).mtime.toISOString() });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const primer = readPrimer(req.params.id, getZkbPath(req));
    if (!primer) return res.status(404).json({ error: 'Primer not found' });
    res.json(primer);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export { router as primersRouter };
