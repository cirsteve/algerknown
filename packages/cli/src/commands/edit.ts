/**
 * Edit Command
 * Open an entry in the default editor
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { resolveEntryPath, readEntry, validate, entryExists } from '@algerknown/core';

export const editCommand = new Command('edit')
  .description('Edit an entry in your default editor')
  .argument('<id>', 'Entry ID to edit')
  .action(async (id) => {
    try {
      if (!entryExists(id)) {
        console.error(chalk.red(`Error: Entry not found: ${id}`));
        process.exit(1);
      }

      const entryPath = resolveEntryPath(id);
      if (!entryPath) {
        console.error(chalk.red(`Error: Could not resolve path for: ${id}`));
        process.exit(1);
      }

      // Get editor from environment
      const editor = process.env.EDITOR || process.env.VISUAL || 'vim';

      console.log(chalk.dim(`Opening ${entryPath} in ${editor}...`));

      // Spawn editor
      const child = spawn(editor, [entryPath], {
        stdio: 'inherit',
        shell: true,
      });

      child.on('exit', (code) => {
        if (code === 0) {
          // Validate after edit
          const entry = readEntry(id);
          if (entry) {
            const result = validate(entry);
            if (result.valid) {
              console.log(chalk.green(`✓ Saved ${id}`));
            } else {
              console.warn(chalk.yellow('⚠ Entry saved but has validation errors:'));
              for (const err of result.errors) {
                console.warn(chalk.yellow(`  ${err.path}: ${err.message}`));
              }
            }
          }
        } else {
          console.error(chalk.red(`Editor exited with code ${code}`));
          process.exit(code || 1);
        }
      });

      child.on('error', (err) => {
        console.error(chalk.red(`Failed to open editor: ${err.message}`));
        console.error(chalk.dim(`Set $EDITOR environment variable to your preferred editor.`));
        process.exit(1);
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });
