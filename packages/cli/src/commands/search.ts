/**
 * Search Command
 * Full-text search across entries
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { search, getAllTags } from '@algerknown/core';

export const searchCommand = new Command('search')
  .description('Search for entries')
  .argument('[query]', 'Search query')
  .option('--tags', 'List all tags instead of searching')
  .option('--json', 'Output as JSON')
  .action((query, options) => {
    try {
      // List tags mode
      if (options.tags) {
        const tags = getAllTags();

        if (options.json) {
          console.log(JSON.stringify(tags, null, 2));
          return;
        }

        if (tags.length === 0) {
          console.log(chalk.dim('No tags found.'));
          return;
        }

        console.log(chalk.cyan('Tags:'));
        for (const { tag, count } of tags) {
          console.log(`  ${chalk.magenta(tag)} ${chalk.dim(`(${count})`)}`);
        }
        return;
      }

      // Search mode
      if (!query) {
        console.error(chalk.red('Error: Search query required.'));
        console.error(chalk.dim('Usage: agn search <query>'));
        console.error(chalk.dim('       agn search --tags'));
        process.exit(1);
      }

      const results = search(query);

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(chalk.dim(`No results for "${query}"`));
        return;
      }

      console.log(chalk.cyan(`Results for "${query}":`));
      console.log('');

      const table = new Table({
        head: [chalk.cyan('ID'), chalk.cyan('Type'), chalk.cyan('Topic'), chalk.cyan('Match')],
        style: { head: [], border: [] },
        colWidths: [25, 10, 30, 40],
        wordWrap: true,
      });

      for (const result of results) {
        table.push([
          result.id,
          result.type === 'summary' ? chalk.magenta('summary') : chalk.blue('entry'),
          result.topic.slice(0, 28),
          result.snippet.slice(0, 38),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.dim(`\n${results.length} result(s)`));
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
