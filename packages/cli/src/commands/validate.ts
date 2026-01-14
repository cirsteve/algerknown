/**
 * Validate Command
 * Validate all entries against their schemas
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { validateAll, formatErrors } from '@algerknown/core';

export const validateCommand = new Command('validate')
  .description('Validate all entries against their schemas')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      const results = validateAll();

      if (options.json) {
        const output: Record<string, { valid: boolean; errors: string[] }> = {};
        for (const [id, result] of results) {
          output[id] = {
            valid: result.valid,
            errors: result.errors.map((e) => `${e.path}: ${e.message}`),
          };
        }
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      let validCount = 0;
      let invalidCount = 0;

      for (const [id, result] of results) {
        if (result.valid) {
          validCount++;
        } else {
          invalidCount++;
          console.log(chalk.red(`✗ ${id}`));
          for (const errMsg of formatErrors(result)) {
            console.log(chalk.dim(`    ${errMsg}`));
          }
        }
      }

      console.log('');
      if (invalidCount === 0) {
        console.log(chalk.green(`✓ All ${validCount} entries are valid`));
      } else {
        console.log(chalk.yellow(`${validCount} valid, ${chalk.red(`${invalidCount} invalid`)}`));
        process.exit(1);
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
