/**
 * Delete Command
 * Remove an entry from the knowledge base
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { deleteEntry, readEntry, entryExists } from '@algerknown/core';

export const deleteCommand = new Command('delete')
  .alias('rm')
  .description('Delete an entry from the knowledge base')
  .argument('<id>', 'Entry ID to delete')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (id, options) => {
    try {
      if (!entryExists(id)) {
        console.error(chalk.red(`Error: Entry not found: ${id}`));
        process.exit(1);
      }

      const entry = readEntry(id);
      if (!entry) {
        console.error(chalk.red(`Error: Could not read entry: ${id}`));
        process.exit(1);
      }

      // Confirm unless --force
      if (!options.force) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Delete ${entry.type} "${entry.topic}" (${id})?`,
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.dim('Cancelled.'));
          return;
        }
      }

      const deleted = deleteEntry(id);
      if (deleted) {
        console.log(chalk.green(`✓ Deleted ${id}`));
      } else {
        console.error(chalk.red(`Error: Failed to delete ${id}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });
