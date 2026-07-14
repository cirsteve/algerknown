import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export interface MigrationDefinition {
  id: string;
  sql: string;
}

function loadSql(filename: string): string {
  return readFileSync(join(here, filename), 'utf8');
}

/** Ordered migrations shipped with the adapter; ids sort in application order. */
export const MIGRATIONS: MigrationDefinition[] = [{ id: '0001_init', sql: loadSql('0001_init.sql') }];
