/**
 * Link/Unlink Commands
 * Manage relationships between entries
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { addLink, removeLink, entryExists, type Relationship } from '@algerknown/core';

const VALID_RELATIONSHIPS: Relationship[] = [
  'evolved_into',
  'evolved_from',
  'informs',
  'informed_by',
  'part_of',
  'contains',
  'blocked_by',
  'blocks',
  'supersedes',
  'superseded_by',
  'references',
  'referenced_by',
  'depends_on',
  'dependency_of',
  'enables',
  'enabled_by',
];

export const linkCommand = new Command('link')
  .description('Add a link between two entries')
  .argument('<from>', 'Source entry ID')
  .argument('<to>', 'Target entry ID')
  .argument('<relationship>', `Relationship type: ${VALID_RELATIONSHIPS.join(', ')}`)
  .option('-n, --notes <notes>', 'Optional notes about the relationship')
  .action((from, to, relationship, options) => {
    try {
      // Validate entries exist
      if (!entryExists(from)) {
        console.error(chalk.red(`Error: Source entry not found: ${from}`));
        process.exit(1);
      }

      if (!entryExists(to)) {
        console.error(chalk.red(`Error: Target entry not found: ${to}`));
        process.exit(1);
      }

      // Validate relationship
      if (!VALID_RELATIONSHIPS.includes(relationship)) {
        console.error(chalk.red(`Error: Invalid relationship: ${relationship}`));
        console.error(chalk.dim(`Valid relationships: ${VALID_RELATIONSHIPS.join(', ')}`));
        process.exit(1);
      }

      const added = addLink(from, to, relationship, options.notes);

      if (added) {
        console.log(chalk.green(`✓ Added link: ${from} ${chalk.yellow(relationship)} → ${to}`));
      } else {
        console.log(chalk.yellow(`Link already exists: ${from} ${relationship} → ${to}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

export const unlinkCommand = new Command('unlink')
  .description('Remove a link between two entries')
  .argument('<from>', 'Source entry ID')
  .argument('<to>', 'Target entry ID')
  .option('-r, --relationship <relationship>', 'Only remove links with this relationship')
  .action((from, to, options) => {
    try {
      if (!entryExists(from)) {
        console.error(chalk.red(`Error: Source entry not found: ${from}`));
        process.exit(1);
      }

      const removed = removeLink(from, to, options.relationship);

      if (removed > 0) {
        console.log(chalk.green(`✓ Removed ${removed} link(s) from ${from} to ${to}`));
      } else {
        console.log(chalk.yellow(`No links found from ${from} to ${to}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });
