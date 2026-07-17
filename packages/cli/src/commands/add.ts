/**
 * Add Command
 * Create new summaries or entries
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as fs from 'node:fs';
import yaml from 'js-yaml';
import {
  writeEntry,
  validate,
  entryExists,
  type Summary,
  type Entry,
  type Status,
} from '@algerknown/core';

const STATUS_CHOICES: Status[] = ['active', 'archived', 'reference', 'blocked', 'planned'];

/**
 * Generate a slug from a string
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Prompt for summary creation
 */
async function createSummary(): Promise<Summary> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'topic',
      message: 'Topic:',
      validate: (input) => input.trim().length > 0 || 'Topic is required',
    },
    {
      type: 'input',
      name: 'id',
      message: 'ID (slug):',
      default: (ans: { topic: string }) => slugify(ans.topic),
      validate: (input) => {
        if (!/^[a-z0-9-]+$/.test(input)) {
          return 'ID must be lowercase letters, numbers, and hyphens only';
        }
        if (entryExists(input)) {
          return 'An entry with this ID already exists';
        }
        return true;
      },
    },
    {
      type: 'list',
      name: 'status',
      message: 'Status:',
      choices: STATUS_CHOICES,
      default: 'active',
    },
    {
      type: 'input',
      name: 'summary',
      message: 'Summary (brief description):',
      validate: (input) => input.trim().length > 0 || 'Summary is required',
    },
    {
      type: 'input',
      name: 'tags',
      message: 'Tags (comma-separated):',
      filter: (input: string) =>
        input
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0),
    },
  ]);

  const summary: Summary = {
    id: answers.id,
    type: 'summary',
    topic: answers.topic,
    status: answers.status,
    summary: answers.summary,
  };

  if (answers.tags.length > 0) {
    summary.tags = answers.tags;
  }

  return summary;
}

/**
 * Prompt for entry creation
 */
async function createEntry(): Promise<Entry> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'topic',
      message: 'Topic:',
      validate: (input) => input.trim().length > 0 || 'Topic is required',
    },
    {
      type: 'input',
      name: 'date',
      message: 'Date (YYYY-MM-DD):',
      default: today(),
      validate: (input) => /^\d{4}-\d{2}-\d{2}$/.test(input) || 'Invalid date format',
    },
    {
      type: 'input',
      name: 'id',
      message: 'ID (slug):',
      default: (ans: { topic: string; date: string }) => `${ans.date}-${slugify(ans.topic)}`,
      validate: (input) => {
        if (!/^[a-z0-9-]+$/.test(input)) {
          return 'ID must be lowercase letters, numbers, and hyphens only';
        }
        if (entryExists(input)) {
          return 'An entry with this ID already exists';
        }
        return true;
      },
    },
    {
      type: 'list',
      name: 'status',
      message: 'Status:',
      choices: STATUS_CHOICES,
      default: 'active',
    },
    {
      type: 'input',
      name: 'context',
      message: 'Context (what problem was being solved):',
    },
    {
      type: 'input',
      name: 'approach',
      message: 'Approach (what was tried):',
    },
    {
      type: 'input',
      name: 'tags',
      message: 'Tags (comma-separated):',
      filter: (input: string) =>
        input
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0),
    },
    {
      type: 'number',
      name: 'time_hours',
      message: 'Time spent (hours):',
      default: 0,
    },
  ]);

  const entry: Entry = {
    id: answers.id,
    type: 'entry',
    date: answers.date,
    topic: answers.topic,
    status: answers.status,
  };

  if (answers.context) entry.context = answers.context;
  if (answers.approach) entry.approach = answers.approach;
  if (answers.tags.length > 0) entry.tags = answers.tags;
  if (answers.time_hours > 0) entry.time_hours = answers.time_hours;

  return entry;
}

/**
 * Read raw YAML from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export const addCommand = new Command('add')
  .description('Add a new summary or entry')
  .argument('[type]', 'Type of entry to create: summary or entry')
  .option('--raw', 'Read raw YAML from stdin')
  .action(async (type, options) => {
    try {
      let entry: Summary | Entry;

      if (options.raw) {
        // Read from stdin
        const input = await readStdin();
        entry = yaml.load(input) as Summary | Entry;

        if (!entry || !entry.id || !entry.type) {
          console.error(chalk.red('Error: Invalid YAML input. Must include id and type.'));
          process.exit(1);
        }
      } else {
        // Interactive mode
        if (!type) {
          const { entryType } = await inquirer.prompt([
            {
              type: 'list',
              name: 'entryType',
              message: 'What would you like to create?',
              choices: [
                { name: 'Summary (topic overview)', value: 'summary' },
                { name: 'Entry (journal/log)', value: 'entry' },
              ],
            },
          ]);
          type = entryType;
        }

        if (type === 'summary') {
          entry = await createSummary();
        } else if (type === 'entry') {
          entry = await createEntry();
        } else {
          console.error(chalk.red(`Error: Unknown type "${type}". Use "summary" or "entry".`));
          process.exit(1);
        }
      }

      // Validate
      const result = validate(entry);
      if (!result.valid) {
        console.error(chalk.red('Validation errors:'));
        for (const err of result.errors) {
          console.error(chalk.red(`  ${err.path}: ${err.message}`));
        }
        process.exit(1);
      }

      // Write
      writeEntry(entry);
      console.log(chalk.green(`✓ Created ${entry.type}: ${entry.id}`));
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
