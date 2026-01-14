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

// POST /api/links - Create a link between entries
router.post('/', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const { sourceId, targetId, relationship, notes } = req.body;
    
    if (!sourceId || !targetId || !relationship) {
      return res.status(400).json({ 
        error: 'sourceId, targetId, and relationship are required' 
      });
    }
    
    const added = core.addLink(sourceId, targetId, relationship as core.Relationship, notes, zkbPath);
    
    res.status(added ? 201 : 200).json({ 
      message: added ? 'Link created' : 'Link already exists',
      sourceId,
      targetId,
      relationship 
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// DELETE /api/links - Remove a link between entries
router.delete('/', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const { sourceId, targetId, relationship } = req.body;
    
    if (!sourceId || !targetId || !relationship) {
      return res.status(400).json({ 
        error: 'sourceId, targetId, and relationship are required' 
      });
    }
    
    const removed = core.removeLink(sourceId, targetId, relationship as core.Relationship, zkbPath);
    
    res.json({ 
      message: removed ? 'Link removed' : 'Link not found',
      sourceId,
      targetId,
      relationship 
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/links/:id - Get all links for an entry
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const entry = core.readEntry(req.params.id, zkbPath);
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    res.json(entry.links || []);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/links/:id/graph - Get link graph for visualization
router.get('/:id/graph', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const depth = parseInt(req.query.depth as string) || 2;
    const index = core.getIndex(zkbPath);
    
    const visited = new Set<string>();
    const nodes: Array<{ id: string; type?: string; topic?: string }> = [];
    const edges: Array<{ source: string; target: string; relationship: string }> = [];
    
    const explore = (entryId: string, currentDepth: number) => {
      if (currentDepth > depth || visited.has(entryId)) return;
      visited.add(entryId);
      
      // Get entry info
      const entry = core.readEntry(entryId, zkbPath);
      if (!entry) return;
      
      const indexEntry = index.entries[entryId];
      nodes.push({
        id: entryId,
        type: indexEntry?.type,
        topic: entry.topic,
      });
      
      // Get links
      if (entry.links) {
        for (const link of entry.links) {
          edges.push({
            source: entryId,
            target: link.id,
            relationship: link.relationship,
          });
          explore(link.id, currentDepth + 1);
        }
      }
    };
    
    explore(req.params.id, 0);
    
    res.json({ nodes, edges });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export { router as linksRouter };
