import { Router, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as core from '@algerknown/core';
import { getZkbPath } from '../utils/zkb-path.js';

const router = Router();

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
