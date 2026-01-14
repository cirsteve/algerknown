/**
 * Init Command
 * Create a new Algerknown knowledge base or update schemas in existing one
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { init, findRoot } from '@algerknown/core';

export const initCommand = new Command('init')
  .description('Initialize a new Algerknown knowledge base, or update schemas in existing one')
  .action(() => {
    const cwd = process.cwd();
    
    // Check if we're inside an existing KB
    let existingRoot: string | null = null;
    try {
      existingRoot = findRoot(cwd);
    } catch {
      // Not inside a KB, that's fine
    }

    try {
      if (existingRoot) {
        // Update schemas in the existing KB root
        init(existingRoot);
        console.log(chalk.green('✓ Updated Algerknown schemas'));
        console.log(chalk.dim(`  Schemas refreshed in ${existingRoot}/.algerknown/schemas/`));
      } else {
        // Initialize new KB in current directory
        init(cwd);
        console.log(chalk.green('✓ Initialized Algerknown knowledge base'));
        console.log(chalk.dim('  Created .algerknown/ with schemas and index'));
        console.log(chalk.dim('  Created summaries/ and entries/ directories'));
        console.log('');
        console.log(chalk.cyan('Next steps:'));
        console.log(chalk.dim('  agn add summary    Create a new topic summary'));
        console.log(chalk.dim('  agn add entry      Create a new journal entry'));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });
