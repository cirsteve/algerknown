import { Router, Request, Response } from 'express';
import * as core from '@algerknown/core';

const router = Router();

// Default ZKB path from environment, or current working directory
const DEFAULT_ZKB_PATH = process.env.ZKB_PATH || process.cwd();

const getZkbPath = (req: Request): string => {
  const zkbPath = req.headers['x-zkb-path'] as string;
  return zkbPath || DEFAULT_ZKB_PATH;
};

// GET /api/entries - List all entries
router.get('/', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const index = core.getIndex(zkbPath);
    
    // Convert Record to array format for API response
    const entriesList = Object.entries(index.entries).map(([id, entry]) => ({
      id,
      path: entry.path,
      type: entry.type,
    }));
    
    res.json(entriesList);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/entries/:id - Get a specific entry
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const entry = core.readEntry(req.params.id, zkbPath);
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    res.json(entry);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// POST /api/entries - Create a new entry
router.post('/', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const entryData = req.body as core.AnyEntry;
    
    if (!entryData.id || !entryData.type) {
      return res.status(400).json({ error: 'id and type are required' });
    }
    
    // Validate entry
    const validation = core.validate(entryData, zkbPath);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }
    
    // Write entry file - this also adds to index
    core.writeEntry(entryData, zkbPath);
    
    res.status(201).json(entryData);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// PUT /api/entries/:id - Update an entry
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const existingEntry = core.readEntry(req.params.id, zkbPath);
    
    if (!existingEntry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    const updatedEntry = {
      ...existingEntry,
      ...req.body,
      id: req.params.id, // Preserve ID
    } as core.AnyEntry;
    
    // Validate
    const validation = core.validate(updatedEntry, zkbPath);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }
    
    // Write updated entry
    core.writeEntry(updatedEntry, zkbPath);
    
    res.json(updatedEntry);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// DELETE /api/entries/:id - Delete an entry
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const entry = core.readEntry(req.params.id, zkbPath);
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    // Delete entry
    core.deleteEntry(req.params.id, zkbPath);
    
    res.json({ message: 'Entry deleted', id: req.params.id });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export { router as entriesRouter };
