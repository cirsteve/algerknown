/**
 * Config Module
 * Finds .algerknown root directory and initializes new knowledge bases
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ALGERKNOWN_DIR = '.algerknown';
const INDEX_FILE = 'index.yaml';
const SCHEMAS_DIR = 'schemas';

/**
 * Walk up from the given directory to find index.yaml
 * Similar to how git finds .git/
 * 
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Path to the knowledge base root (directory containing index.yaml)
 * @throws Error if no index.yaml is found
 */
export function findRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const indexPath = path.join(current, INDEX_FILE);
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return current;
    }
    current = path.dirname(current);
  }

  throw new Error(
    `Not inside an Algerknown knowledge base. Run 'agn init' to create one.`
  );
}

/**
 * Get the path to the .algerknown directory
 */
export function getAlgerknownDir(root: string): string {
  return path.join(root, ALGERKNOWN_DIR);
}

/**
 * Get the path to the index.yaml file (at root, not in .algerknown)
 */
export function getIndexPath(root: string): string {
  return path.join(root, INDEX_FILE);
}

/**
 * Get the path to the schemas directory
 */
export function getSchemasDir(root: string): string {
  return path.join(root, ALGERKNOWN_DIR, SCHEMAS_DIR);
}

/**
 * Get the path to a specific schema file
 */
export function getSchemaPath(root: string, schemaName: string): string {
  return path.join(getSchemasDir(root), schemaName);
}

/**
 * Get the path to the summaries directory
 */
export function getSummariesDir(root: string): string {
  return path.join(root, 'summaries');
}

/**
 * Get the path to the entries directory
 */
export function getEntriesDir(root: string): string {
  return path.join(root, 'entries');
}

/**
 * Default schemas to include in a new knowledge base
 */
const DEFAULT_INDEX = `# yaml-language-server: $schema=./.algerknown/schemas/index.schema.json
version: "1.0.0"

entries: {}
`;

const INDEX_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://algerknown.dev/schemas/index.schema.json",
  "title": "Algerknown Index",
  "description": "Index file mapping entry IDs to file paths",
  "type": "object",
  "required": ["version", "entries"],
  "properties": {
    "version": {
      "type": "string",
      "description": "Schema version",
      "pattern": "^\\\\d+\\\\.\\\\d+\\\\.\\\\d+$"
    },
    "entries": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/$defs/indexEntry"
      }
    }
  },
  "$defs": {
    "indexEntry": {
      "type": "object",
      "required": ["path", "type"],
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative path to the entry file"
        },
        "type": {
          "type": "string",
          "enum": ["summary", "entry"],
          "description": "Entry type"
        }
      }
    }
  }
}`;

const SUMMARY_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://algerknown.dev/schemas/summary.schema.json",
  "title": "Algerknown Summary",
  "description": "A topic summary aggregating learnings, decisions, and artifacts",
  "type": "object",
  "required": ["id", "type", "topic", "status", "summary"],
  "properties": {
    "id": {
      "type": "string",
      "description": "Unique identifier for this summary",
      "pattern": "^[a-z0-9-]+$"
    },
    "type": {
      "type": "string",
      "const": "summary"
    },
    "topic": {
      "type": "string",
      "description": "Human-readable topic name"
    },
    "date_range": {
      "$ref": "#/$defs/dateRange"
    },
    "status": {
      "$ref": "#/$defs/status"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "uniqueItems": true
    },
    "summary": {
      "type": "string",
      "description": "Brief description of the topic"
    },
    "learnings": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/learning"
      }
    },
    "decisions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/decision"
      }
    },
    "artifacts": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/artifact"
      }
    },
    "open_questions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "resources": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/resource"
      }
    },
    "links": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/link"
      }
    }
  },
  "$defs": {
    "dateRange": {
      "type": "object",
      "required": ["start"],
      "properties": {
        "start": {
          "type": "string",
          "pattern": "^\\\\d{4}(-\\\\d{2})?(-\\\\d{2})?$",
          "description": "Start date (YYYY, YYYY-MM, or YYYY-MM-DD)"
        },
        "end": {
          "type": "string",
          "pattern": "^\\\\d{4}(-\\\\d{2})?(-\\\\d{2})?$",
          "description": "End date (YYYY, YYYY-MM, or YYYY-MM-DD)"
        }
      }
    },
    "status": {
      "type": "string",
      "enum": ["active", "archived", "reference", "blocked", "planned"],
      "description": "Current status of the topic"
    },
    "learning": {
      "type": "object",
      "required": ["insight"],
      "properties": {
        "insight": {
          "type": "string",
          "description": "The key learning or insight"
        },
        "context": {
          "type": "string",
          "description": "How this was discovered"
        },
        "relevance": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "IDs of related entries"
        }
      }
    },
    "decision": {
      "type": "object",
      "required": ["decision"],
      "properties": {
        "decision": {
          "type": "string",
          "description": "What was decided"
        },
        "rationale": {
          "type": "string",
          "description": "Why this decision was made"
        },
        "trade_offs": {
          "type": "string",
          "description": "What was sacrificed or risked"
        },
        "date": {
          "type": "string",
          "format": "date"
        },
        "superseded_by": {
          "type": "string",
          "description": "ID of decision that replaced this one"
        }
      }
    },
    "artifact": {
      "type": "object",
      "required": ["path"],
      "properties": {
        "repo": {
          "type": "string",
          "description": "Repository URL or name"
        },
        "path": {
          "type": "string",
          "description": "Path within the repo"
        },
        "notes": {
          "type": "string"
        },
        "commit": {
          "type": "string",
          "description": "Specific commit hash"
        }
      }
    },
    "resource": {
      "type": "object",
      "required": ["url"],
      "properties": {
        "url": {
          "type": "string",
          "format": "uri"
        },
        "title": {
          "type": "string"
        },
        "notes": {
          "type": "string"
        }
      }
    },
    "link": {
      "type": "object",
      "required": ["id", "relationship"],
      "properties": {
        "id": {
          "type": "string",
          "description": "ID of the linked entry"
        },
        "relationship": {
          "$ref": "#/$defs/relationship"
        },
        "notes": {
          "type": "string"
        }
      }
    },
    "relationship": {
      "type": "string",
      "enum": [
        "evolved_into",
        "evolved_from",
        "informs",
        "informed_by",
        "part_of",
        "contains",
        "blocked_by",
        "blocks",
        "supersedes",
        "superseded_by",
        "references",
        "referenced_by",
        "depends_on",
        "dependency_of",
        "enables",
        "enabled_by"
      ],
      "description": "How entries relate to each other. Bidirectional pairs allow expressing relationships from either direction."
    }
  }
}`;

const ENTRY_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://algerknown.dev/schemas/entry.schema.json",
  "title": "Algerknown Entry",
  "description": "A journal entry capturing work done at a specific point in time",
  "type": "object",
  "required": ["id", "type", "date", "topic", "status"],
  "properties": {
    "id": {
      "type": "string",
      "description": "Unique identifier, typically YYYY-MM-DD-slug",
      "pattern": "^[a-z0-9-]+$"
    },
    "type": {
      "type": "string",
      "const": "entry"
    },
    "date": {
      "type": "string",
      "format": "date",
      "description": "Date of the entry (YYYY-MM-DD)"
    },
    "topic": {
      "type": "string",
      "description": "Human-readable topic name"
    },
    "status": {
      "$ref": "summary.schema.json#/$defs/status"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "uniqueItems": true
    },
    "time_hours": {
      "type": "number",
      "minimum": 0,
      "description": "Approximate hours spent"
    },
    "context": {
      "type": "string",
      "description": "What problem was being solved, what was already known"
    },
    "approach": {
      "type": "string",
      "description": "What was tried, methodology used"
    },
    "outcome": {
      "$ref": "#/$defs/outcome"
    },
    "commits": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Related git commit hashes"
    },
    "resources": {
      "type": "array",
      "items": {
        "$ref": "summary.schema.json#/$defs/resource"
      }
    },
    "links": {
      "type": "array",
      "items": {
        "$ref": "summary.schema.json#/$defs/link"
      }
    }
  },
  "$defs": {
    "outcome": {
      "type": "object",
      "properties": {
        "worked": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "What succeeded"
        },
        "failed": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "What didn't work"
        },
        "surprised": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Unexpected findings"
        }
      }
    }
  }
}`;

/**
 * Initialize a new Algerknown knowledge base
 * 
 * @param targetDir - Directory to initialize (defaults to cwd)
 * @throws Error if already fully initialized (has index.yaml)
 */
export function init(targetDir: string = process.cwd()): void {
  const resolvedDir = path.resolve(targetDir);
  const algerknownPath = path.join(resolvedDir, ALGERKNOWN_DIR);
  const indexPath = path.join(resolvedDir, INDEX_FILE);  // index.yaml at root
  const schemasPath = path.join(algerknownPath, SCHEMAS_DIR);

  const hasIndex = fs.existsSync(indexPath);

  // If index.yaml exists, it's already initialized
  // But we still allow re-running to update schemas
  if (hasIndex) {
    // Just update schemas, don't touch index or content directories
    updateSchemas(targetDir);
    return;
  }

  // Create directory structure
  fs.mkdirSync(schemasPath, { recursive: true });
  fs.mkdirSync(path.join(resolvedDir, 'summaries'), { recursive: true });
  fs.mkdirSync(path.join(resolvedDir, 'entries'), { recursive: true });

  // Write index.yaml (only if it doesn't exist)
  if (!hasIndex) {
    fs.writeFileSync(indexPath, DEFAULT_INDEX, 'utf-8');
  }

  // Write all schemas
  writeSchemas(schemasPath);
}

/**
 * Update schemas in an existing knowledge base
 * 
 * @param targetDir - Directory containing .algerknown (defaults to cwd)
 */
export function updateSchemas(targetDir: string = process.cwd()): void {
  const resolvedDir = path.resolve(targetDir);
  const schemasPath = path.join(resolvedDir, ALGERKNOWN_DIR, SCHEMAS_DIR);

  // Create schemas directory if it doesn't exist
  fs.mkdirSync(schemasPath, { recursive: true });

  writeSchemas(schemasPath);
}

/**
 * Write all schema files to a directory
 */
function writeSchemas(schemasPath: string): void {
  fs.writeFileSync(
    path.join(schemasPath, 'index.schema.json'),
    INDEX_SCHEMA,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(schemasPath, 'summary.schema.json'),
    SUMMARY_SCHEMA,
    'utf-8'
  );

  fs.writeFileSync(
    path.join(schemasPath, 'entry.schema.json'),
    ENTRY_SCHEMA,
    'utf-8'
  );
}

/**
 * Check if currently inside an Algerknown knowledge base
 */
export function isInsideKnowledgeBase(startDir: string = process.cwd()): boolean {
  try {
    findRoot(startDir);
    return true;
  } catch {
    return false;
  }
}
