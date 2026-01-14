/**
 * Show Command
 * Display a single entry
 */

import { Command } from 'commander';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { readEntry, getLinks, getBacklinks, entryExists, isSummary, isEntry } from '@algerknown/core';

export const showCommand = new Command('show')
  .description('Display details of an entry')
  .argument('<id>', 'Entry ID to show')
  .option('--json', 'Output as JSON')
  .option('--yaml', 'Output as YAML')
  .option('--links', 'Show only links')
  .action((id, options) => {
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

      // JSON output
      if (options.json) {
        console.log(JSON.stringify(entry, null, 2));
        return;
      }

      // YAML output
      if (options.yaml) {
        console.log(yaml.dump(entry, { indent: 2 }));
        return;
      }

      // Links only
      if (options.links) {
        const links = getLinks(id);
        const backlinks = getBacklinks(id);

        console.log(chalk.cyan('Outgoing links:'));
        if (links.length === 0) {
          console.log(chalk.dim('  (none)'));
        } else {
          for (const link of links) {
            console.log(`  ${chalk.yellow(link.relationship)} → ${link.id}`);
            if (link.notes) console.log(chalk.dim(`    ${link.notes}`));
          }
        }

        console.log('');
        console.log(chalk.cyan('Incoming links (backlinks):'));
        if (backlinks.length === 0) {
          console.log(chalk.dim('  (none)'));
        } else {
          for (const { fromId, link } of backlinks) {
            console.log(`  ${fromId} → ${chalk.yellow(link.relationship)}`);
            if (link.notes) console.log(chalk.dim(`    ${link.notes}`));
          }
        }
        return;
      }

      // Formatted output
      console.log('');
      console.log(chalk.bold.white(entry.topic));
      console.log(chalk.dim(`${entry.type} · ${entry.id}`));
      console.log('');

      // Status
      const statusColors: Record<string, (s: string) => string> = {
        active: chalk.green,
        archived: chalk.gray,
        reference: chalk.blue,
        blocked: chalk.red,
        planned: chalk.yellow,
      };
      const statusColor = statusColors[entry.status] || chalk.white;
      console.log(`${chalk.cyan('Status:')} ${statusColor(entry.status)}`);

      // Tags
      if (entry.tags && entry.tags.length > 0) {
        console.log(`${chalk.cyan('Tags:')} ${entry.tags.map((t) => chalk.magenta(t)).join(', ')}`);
      }

      // Type-specific fields
      if (isSummary(entry)) {
        console.log('');
        console.log(chalk.cyan('Summary:'));
        console.log(entry.summary);

        if (entry.date_range) {
          console.log('');
          console.log(`${chalk.cyan('Date Range:')} ${entry.date_range.start}${entry.date_range.end ? ` → ${entry.date_range.end}` : ''}`);
        }

        if (entry.learnings && entry.learnings.length > 0) {
          console.log('');
          console.log(chalk.cyan('Learnings:'));
          for (const learning of entry.learnings) {
            console.log(`  • ${learning.insight}`);
            if (learning.context) console.log(chalk.dim(`    ${learning.context}`));
          }
        }

        if (entry.decisions && entry.decisions.length > 0) {
          console.log('');
          console.log(chalk.cyan('Decisions:'));
          for (const decision of entry.decisions) {
            console.log(`  • ${decision.decision}`);
            if (decision.rationale) console.log(chalk.dim(`    Rationale: ${decision.rationale}`));
            if (decision.trade_offs) console.log(chalk.dim(`    Trade-offs: ${decision.trade_offs}`));
          }
        }

        if (entry.open_questions && entry.open_questions.length > 0) {
          console.log('');
          console.log(chalk.cyan('Open Questions:'));
          for (const q of entry.open_questions) {
            console.log(`  ? ${q}`);
          }
        }
      }

      if (isEntry(entry)) {
        console.log(`${chalk.cyan('Date:')} ${entry.date}`);

        if (entry.time_hours) {
          console.log(`${chalk.cyan('Time:')} ${entry.time_hours} hours`);
        }

        if (entry.context) {
          console.log('');
          console.log(chalk.cyan('Context:'));
          console.log(entry.context);
        }

        if (entry.approach) {
          console.log('');
          console.log(chalk.cyan('Approach:'));
          console.log(entry.approach);
        }

        if (entry.outcome) {
          console.log('');
          console.log(chalk.cyan('Outcome:'));
          if (entry.outcome.worked && entry.outcome.worked.length > 0) {
            console.log(chalk.green('  Worked:'));
            for (const w of entry.outcome.worked) console.log(`    ✓ ${w}`);
          }
          if (entry.outcome.failed && entry.outcome.failed.length > 0) {
            console.log(chalk.red('  Failed:'));
            for (const f of entry.outcome.failed) console.log(`    ✗ ${f}`);
          }
          if (entry.outcome.surprised && entry.outcome.surprised.length > 0) {
            console.log(chalk.yellow('  Surprised:'));
            for (const s of entry.outcome.surprised) console.log(`    ! ${s}`);
          }
        }
      }

      // Links
      const links = getLinks(id);
      if (links.length > 0) {
        console.log('');
        console.log(chalk.cyan('Links:'));
        for (const link of links) {
          console.log(`  ${chalk.yellow(link.relationship)} → ${link.id}`);
        }
      }

      // Backlinks
      const backlinks = getBacklinks(id);
      if (backlinks.length > 0) {
        console.log('');
        console.log(chalk.cyan('Backlinks:'));
        for (const { fromId } of backlinks) {
          console.log(`  ← ${fromId}`);
        }
      }

      console.log('');
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });
