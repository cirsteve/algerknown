/**
 * Init Command
 * Create a new Algerknown knowledge base
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { init, isInsideKnowledgeBase } from '@algerknown/core';

export const initCommand = new Command('init')
  .description('Initialize a new Algerknown knowledge base in the current directory')
  .option('-f, --force', 'Overwrite existing knowledge base')
  .action((options) => {
    const cwd = process.cwd();

    if (isInsideKnowledgeBase(cwd) && !options.force) {
      console.error(chalk.red('Error: Already inside an Algerknown knowledge base.'));
      console.error(chalk.dim('Use --force to reinitialize.'));
      process.exit(1);
    }

    try {
      init(cwd);
      console.log(chalk.green('✓ Initialized Algerknown knowledge base'));
      console.log(chalk.dim(`  Created .algerknown/ with schemas and index`));
      console.log(chalk.dim(`  Created summaries/ and entries/ directories`));
      console.log('');
      console.log(chalk.cyan('Next steps:'));
      console.log(chalk.dim('  agn add summary    Create a new topic summary'));
      console.log(chalk.dim('  agn add entry      Create a new journal entry'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });
