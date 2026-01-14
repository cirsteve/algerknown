/**
 * List Command
 * Display all entries in the knowledge base
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { listEntries, readEntry, filterByType, filterByTag, filterByStatus, type Status } from '@algerknown/core';

export const listCommand = new Command('list')
  .alias('ls')
  .description('List all entries in the knowledge base')
  .option('-t, --type <type>', 'Filter by type (summary or entry)')
  .option('--tag <tag>', 'Filter by tag')
  .option('-s, --status <status>', 'Filter by status')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      let entries = listEntries();

      // Apply filters
      if (options.type) {
        const filtered = filterByType(options.type);
        const filteredIds = new Set(filtered.map((e) => e.id));
        entries = entries.filter((e) => filteredIds.has(e.id));
      }

      if (options.tag) {
        const filtered = filterByTag(options.tag);
        const filteredIds = new Set(filtered.map((e) => e.id));
        entries = entries.filter((e) => filteredIds.has(e.id));
      }

      if (options.status) {
        const filtered = filterByStatus(options.status as Status);
        const filteredIds = new Set(filtered.map((e) => e.id));
        entries = entries.filter((e) => filteredIds.has(e.id));
      }

      if (options.json) {
        // JSON output
        const fullEntries = entries.map((e) => readEntry(e.id)).filter((e) => e !== null);
        console.log(JSON.stringify(fullEntries, null, 2));
        return;
      }

      if (entries.length === 0) {
        console.log(chalk.dim('No entries found.'));
        return;
      }

      // Table output
      const table = new Table({
        head: [
          chalk.cyan('ID'),
          chalk.cyan('Type'),
          chalk.cyan('Topic'),
          chalk.cyan('Status'),
          chalk.cyan('Tags'),
        ],
        style: {
          head: [],
          border: [],
        },
      });

      for (const entry of entries) {
        const full = readEntry(entry.id);
        if (!full) continue;

        const statusColors: Record<Status, (s: string) => string> = {
          active: chalk.green,
          archived: chalk.gray,
          reference: chalk.blue,
          blocked: chalk.red,
          planned: chalk.yellow,
        };

        const statusColor = statusColors[full.status] || chalk.white;

        table.push([
          full.id,
          full.type === 'summary' ? chalk.magenta('summary') : chalk.blue('entry'),
          full.topic.slice(0, 40) + (full.topic.length > 40 ? '...' : ''),
          statusColor(full.status),
          (full.tags || []).join(', ').slice(0, 30),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.dim(`\n${entries.length} entries`));
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
