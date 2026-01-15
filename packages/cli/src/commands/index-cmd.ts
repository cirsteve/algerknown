/**
 * Index Command
 * Scan entries/ and summaries/ directories and add missing files to index.yaml
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { findRoot, getIndex, saveIndex, getAlgerknownDir } from '@algerknown/core';

interface IndexEntry {
  path: string;
  type: 'entry' | 'summary';
}

interface YamlFile {
  id?: string;
  type?: string;
}

function scanDirectory(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => path.join(dir, f));
}

function readYamlHeader(filePath: string): YamlFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as YamlFile;
    return parsed;
  } catch {
    return null;
  }
}

export const indexCommand = new Command('index')
  .description('Scan and add missing entries/summaries to index.yaml')
  .option('--dry-run', 'Show what would be added without modifying index.yaml')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      const root = findRoot();
      const algerknownDir = getAlgerknownDir(root);
      const index = getIndex(root);
      
      const entriesDir = path.join(root, 'entries');
      const summariesDir = path.join(root, 'summaries');
      
      const entryFiles = scanDirectory(entriesDir);
      const summaryFiles = scanDirectory(summariesDir);
      
      const toAdd: { id: string; entry: IndexEntry; file: string }[] = [];
      
      // Scan entries
      for (const file of entryFiles) {
        const parsed = readYamlHeader(file);
        if (!parsed?.id) {
          if (!options.json) {
            console.warn(chalk.yellow(`⚠ Skipping ${path.basename(file)}: no 'id' field`));
          }
          continue;
        }
        
        if (!index.entries[parsed.id]) {
          // Path relative to .algerknown directory
          const relativePath = path.relative(algerknownDir, file);
          const entryType = (parsed.type === 'summary' ? 'summary' : 'entry') as 'entry' | 'summary';
          toAdd.push({
            id: parsed.id,
            entry: {
              path: relativePath,
              type: entryType,
            },
            file: path.basename(file),
          });
        }
      }
      
      // Scan summaries
      for (const file of summaryFiles) {
        const parsed = readYamlHeader(file);
        if (!parsed?.id) {
          if (!options.json) {
            console.warn(chalk.yellow(`⚠ Skipping ${path.basename(file)}: no 'id' field`));
          }
          continue;
        }
        
        if (!index.entries[parsed.id]) {
          // Path relative to .algerknown directory
          const relativePath = path.relative(algerknownDir, file);
          const summaryType = (parsed.type === 'entry' ? 'entry' : 'summary') as 'entry' | 'summary';
          toAdd.push({
            id: parsed.id,
            entry: {
              path: relativePath,
              type: summaryType,
            },
            file: path.basename(file),
          });
        }
      }
      
      if (options.json) {
        console.log(JSON.stringify({
          added: toAdd.map(t => ({ id: t.id, type: t.entry.type, file: t.file })),
          count: toAdd.length,
          dryRun: options.dryRun || false,
        }, null, 2));
        return;
      }
      
      if (toAdd.length === 0) {
        console.log(chalk.green('✓ Index is up to date'));
        return;
      }
      
      // Add entries to index
      for (const item of toAdd) {
        index.entries[item.id] = item.entry;
        if (options.dryRun) {
          console.log(chalk.dim(`+ ${item.id} (${item.entry.type})`));
        } else {
          console.log(chalk.green(`+ ${item.id}`) + chalk.dim(` (${item.entry.type})`));
        }
      }
      
      if (options.dryRun) {
        console.log('');
        console.log(chalk.yellow(`Would add ${toAdd.length} entries (dry run)`));
      } else {
        saveIndex(index, root);
        console.log('');
        console.log(chalk.green(`✓ Added ${toAdd.length} entries to index.yaml`));
      }
      
    } catch (error) {
      if ((error as Error).message.includes('Not inside')) {
        console.error(chalk.red('Error: Not inside an Algerknown knowledge base.'));
        console.error(chalk.dim('Run "agn init" first.'));
      } else {
        console.error(chalk.red(`Error: ${(error as Error).message}`));
      }
      process.exit(1);
    }
  });
