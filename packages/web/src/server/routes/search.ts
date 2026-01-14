import { Router, Request, Response } from 'express';
import * as core from '@algerknown/core';

const router = Router();

const getZkbPath = (req: Request): string => {
  const zkbPath = req.headers['x-zkb-path'] as string;
  if (!zkbPath) {
    throw new Error('x-zkb-path header required');
  }
  return zkbPath;
};

// GET /api/search?q=query&type=filter - Search entries
router.get('/', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const query = req.query.q as string;
    const typeFilter = req.query.type as 'summary' | 'entry' | undefined;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    
    let results = core.search(query, zkbPath);
    
    // Apply type filter if provided
    if (typeFilter) {
      results = results.filter(r => r.type === typeFilter);
    }
    
    res.json(results);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/search/types - Get available entry types
router.get('/types', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const index = core.getIndex(zkbPath);
    const types = new Set<string>();
    
    for (const entry of Object.values(index.entries)) {
      types.add(entry.type);
    }
    
    res.json(Array.from(types));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/search/by-type/:type - Get all entries of a specific type
router.get('/by-type/:type', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const requestedType = req.params.type as 'summary' | 'entry';
    const results = core.filterByType(requestedType, zkbPath);
    res.json(results);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/search/tags - Get all tags
router.get('/tags', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const tags = core.getAllTags(zkbPath);
    res.json(tags);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/search/by-tag/:tag - Get entries by tag
router.get('/by-tag/:tag', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const results = core.filterByTag(req.params.tag, zkbPath);
    res.json(results);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export { router as searchRouter };
