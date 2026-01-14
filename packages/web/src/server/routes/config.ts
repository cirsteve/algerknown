import { Router, Request, Response } from 'express';
import * as core from '@algerknown/core';
import * as path from 'path';
import * as fs from 'fs';

const router = Router();

const getZkbPath = (req: Request): string => {
  const zkbPath = req.headers['x-zkb-path'] as string;
  if (!zkbPath) {
    throw new Error('x-zkb-path header required');
  }
  return zkbPath;
};

// GET /api/config - Get knowledge base configuration
router.get('/', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const index = core.getIndex(zkbPath);
    const entryCount = Object.keys(index.entries).length;
    
    res.json({
      version: index.version,
      entryCount,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/config/schemas - Get available schemas
router.get('/schemas', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const schemasDir = core.getSchemasDir(zkbPath);
    
    if (!fs.existsSync(schemasDir)) {
      return res.json([]);
    }
    
    const schemaFiles = fs.readdirSync(schemasDir)
      .filter(f => f.endsWith('.json'));
    
    const schemas = schemaFiles.map(file => {
      const content = JSON.parse(fs.readFileSync(path.join(schemasDir, file), 'utf-8'));
      return {
        file,
        title: content.title,
        description: content.description,
        $id: content.$id,
      };
    });
    
    res.json(schemas);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// POST /api/config/validate - Validate entire knowledge base
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const zkbPath = getZkbPath(req);
    const allResults = core.validateAll(zkbPath);
    
    // validateAll returns Map<string, ValidationResult>
    const errors: Array<{ entryId: string; errors: core.ValidationError[] }> = [];
    
    allResults.forEach((result, entryId) => {
      if (!result.valid) {
        errors.push({ entryId, errors: result.errors });
      }
    });
    
    res.json({
      valid: errors.length === 0,
      totalChecked: allResults.size,
      errors,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export { router as configRouter };
