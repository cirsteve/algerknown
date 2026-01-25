import { Router, Request, Response } from 'express';
import * as core from '@algerknown/core';

const router = Router();

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || 'http://localhost:8000';

/**
 * Get the knowledge base root path.
 * Uses core.findRoot() which checks ALGERKNOWN_KB_ROOT env var first,
 * then falls back to walking up from cwd.
 */
const getZkbPath = (_req: Request): string => {
  return core.findRoot();
};

/**
 * Notify the RAG backend to ingest a file after creation/update.
 * This is fire-and-forget - we don't wait for indexing to complete.
 */
const notifyRagBackend = async (filePath: string): Promise<void> => {
  try {
    await fetch(`${RAG_BACKEND_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath }),
    });
  } catch (error) {
    // Log but don't fail the request if RAG backend is unavailable
    console.warn(`Failed to notify RAG backend about ${filePath}:`, error);
  }
};

// GET /api/entries - List all entries
router.get('/', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const index = core.getIndex(zkbPath);

    // Convert Record to array format for API response, including last_ingested
    const entriesList = Object.entries(index.entries).map(([id, indexEntry]) => {
      // Read the full entry to get last_ingested (not part of typed schema)
      const entry = core.readEntry(id, zkbPath) as Record<string, unknown> | null;
      return {
        id,
        path: indexEntry.path,
        type: indexEntry.type,
        last_ingested: (entry?.last_ingested as string) || null,
      };
    });

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

    // Notify RAG backend to index the new entry
    const filePath = core.resolveEntryPath(entryData.id, zkbPath);
    if (filePath) {
      notifyRagBackend(filePath);
    }

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

    // Notify RAG backend to re-index the updated entry
    const filePath = core.resolveEntryPath(updatedEntry.id, zkbPath);
    if (filePath) {
      notifyRagBackend(filePath);
    }

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
