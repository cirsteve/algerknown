/**
 * Review Command
 * Operate the governance review queue over the same HTTP API the browser
 * uses -- the CLI never touches SQLite/git/repositories directly.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { GovernanceApiError, GovernanceClient } from '../governance/http-client.js';

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function withClient<T>(fn: (client: GovernanceClient) => Promise<T>): Promise<T> {
  try {
    const client = await GovernanceClient.create();
    return await fn(client);
  } catch (err) {
    if (err instanceof GovernanceApiError) {
      console.error(chalk.red(`Error: ${err.message}`));
      if (err.body) console.error(chalk.dim(JSON.stringify(err.body)));
    } else {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
    process.exit(1);
  }
}

function printProposalSummary(proposal: Record<string, unknown>): void {
  console.log(chalk.bold(`Proposal ${proposal.id}`));
  console.log(`  status:              ${proposal.status}`);
  console.log(`  version:             ${proposal.version}`);
  console.log(`  namespace:           ${proposal.targetNamespace}`);
  console.log(`  subject:             ${proposal.targetSubject}`);
  console.log(`  current revision:    ${proposal.currentTargetRevision}`);
  console.log(`  expected revision:   ${proposal.expectedTargetRevision}`);
  if ((proposal.conflict as { stale?: boolean } | undefined)?.stale) {
    console.log(chalk.yellow('  ** stale: target revision has moved since this proposal was created **'));
  }
  console.log(chalk.dim('  canonical mutation:'));
  console.log(chalk.dim(JSON.stringify(proposal.canonicalMutation, null, 2)));
}

async function fetchAndDisplay(client: GovernanceClient, id: string): Promise<Record<string, unknown>> {
  const proposal = await client.getProposal(id);
  printProposalSummary(proposal);
  return proposal;
}

async function confirmUnlessYes(message: string, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message, default: false }]);
  return confirm;
}

export const reviewCommand = new Command('review').description('Review governed proposals (accept/reject/amend/revert) over the governance API');

reviewCommand
  .command('list')
  .description('List proposals in the review queue')
  .option('-s, --status <status>', 'Filter by status (pending, accepted, rejected, expired, deleted)')
  .option('-n, --namespace <namespace>', 'Filter by namespace')
  .option('--subject <subject>', 'Filter by subject')
  .option('--cursor <cursor>', 'Opaque pagination cursor from a previous page')
  .option('--limit <limit>', 'Max items per page', (v) => Number(v))
  .option('--json', 'Print raw JSON')
  .action(async (options) => {
    await withClient(async (client) => {
      const page = await client.listProposals({
        status: options.status,
        namespace: options.namespace,
        subject: options.subject,
        cursor: options.cursor,
        limit: options.limit,
      });
      if (options.json) {
        printJson(page);
        return;
      }
      for (const item of page.items as Record<string, unknown>[]) {
        console.log(`${item.id}  ${String(item.status).padEnd(9)} v${item.version}  ${item.targetNamespace}  ${item.createdAt}`);
      }
      if (page.nextCursor) {
        console.log(chalk.dim(`\nNext page: agn review list --cursor ${page.nextCursor}`));
      }
    });
  });

reviewCommand
  .command('show <id>')
  .description('Show full detail for a proposal')
  .option('--json', 'Print raw JSON')
  .action(async (id, options) => {
    await withClient(async (client) => {
      const proposal = await client.getProposal(id);
      if (options.json) {
        printJson(proposal);
        return;
      }
      printProposalSummary(proposal);
    });
  });

reviewCommand
  .command('history <id>')
  .description('Show the review event history for a proposal')
  .action(async (id) => {
    await withClient(async (client) => {
      const history = await client.getProposalHistory(id);
      printJson(history.events);
    });
  });

reviewCommand
  .command('accept <id>')
  .description('Accept a pending proposal, applying its governed write')
  .option('-y, --yes', 'Skip the confirmation prompt (does not weaken auth, attestation, rails, version, or idempotency)')
  .option('-m, --note <note>', 'Optional review note')
  .action(async (id, options) => {
    await withClient(async (client) => {
      const proposal = await fetchAndDisplay(client, id);
      const proceed = await confirmUnlessYes(`Accept proposal ${id} at version ${proposal.version}?`, options.yes);
      if (!proceed) {
        console.log(chalk.dim('Cancelled.'));
        return;
      }
      const result = await client.acceptProposal(id, {
        expectedVersion: proposal.version as number,
        expectedTargetRevision: proposal.currentTargetRevision as number | null,
        reviewNote: options.note,
        idempotencyKey: randomUUID(),
      });
      console.log(chalk.green(`✓ Accepted proposal ${id} -- resulting revision ${result.resultingRevision}`));
    });
  });

reviewCommand
  .command('reject <id>')
  .description('Reject a pending proposal')
  .requiredOption('-r, --reason <reason>', 'Reason for rejection')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (id, options) => {
    await withClient(async (client) => {
      const proposal = await fetchAndDisplay(client, id);
      const proceed = await confirmUnlessYes(`Reject proposal ${id} at version ${proposal.version}?`, options.yes);
      if (!proceed) {
        console.log(chalk.dim('Cancelled.'));
        return;
      }
      const result = await client.rejectProposal(id, { expectedVersion: proposal.version as number, reason: options.reason, idempotencyKey: randomUUID() });
      console.log(chalk.green(`✓ Rejected proposal ${id} (now version ${result.version})`));
    });
  });

reviewCommand
  .command('expire <id>')
  .description('Mark a pending proposal expired')
  .requiredOption('-n, --note <note>', 'Note explaining the expiry')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (id, options) => {
    await withClient(async (client) => {
      const proposal = await fetchAndDisplay(client, id);
      const proceed = await confirmUnlessYes(`Expire proposal ${id} at version ${proposal.version}?`, options.yes);
      if (!proceed) {
        console.log(chalk.dim('Cancelled.'));
        return;
      }
      const result = await client.expireProposal(id, { expectedVersion: proposal.version as number, note: options.note, idempotencyKey: randomUUID() });
      console.log(chalk.green(`✓ Expired proposal ${id} (now version ${result.version})`));
    });
  });

reviewCommand
  .command('delete <id>')
  .description('Delete a proposal record')
  .requiredOption('-r, --reason <reason>', 'Reason for deletion')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (id, options) => {
    await withClient(async (client) => {
      const proposal = await fetchAndDisplay(client, id);
      const proceed = await confirmUnlessYes(`Delete proposal ${id} at version ${proposal.version}? This cannot be undone.`, options.yes);
      if (!proceed) {
        console.log(chalk.dim('Cancelled.'));
        return;
      }
      const result = await client.deleteProposal(id, { expectedVersion: proposal.version as number, reason: options.reason, idempotencyKey: randomUUID() });
      console.log(chalk.green(`✓ Deleted proposal ${id} (now version ${result.version})`));
    });
  });

reviewCommand
  .command('revert <id>')
  .description('Revert an accepted proposal, applying an attributed inverse mutation')
  .requiredOption('-r, --reason <reason>', 'Reason for the revert')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .action(async (id, options) => {
    await withClient(async (client) => {
      const proposal = await fetchAndDisplay(client, id);
      const proceed = await confirmUnlessYes(`Revert proposal ${id} (currently at revision ${proposal.resultingRevision})?`, options.yes);
      if (!proceed) {
        console.log(chalk.dim('Cancelled.'));
        return;
      }
      const result = await client.revertProposal(id, { reason: options.reason, idempotencyKey: randomUUID() });
      console.log(chalk.green(`✓ Reverted proposal ${id} -- new revision ${result.newRevision}`));
    });
  });

reviewCommand
  .command('amend <id>')
  .description('Amend a pending proposal with an RFC 6902 JSON Patch against its nodeMutations/edgeMutations')
  .requiredOption('-n, --note <note>', 'Note explaining the amendment (recorded locally in terminal output; the durable amend action carries no note field)')
  .option('--patch-file <path>', 'Path to a JSON file containing the patch operations (reads stdin if omitted)')
  .action(async (id, options) => {
    await withClient(async (client) => {
      const proposal = await fetchAndDisplay(client, id);
      const raw = options.patchFile ? fs.readFileSync(options.patchFile, 'utf-8') : await readStdin();
      let patch: unknown;
      try {
        patch = JSON.parse(raw);
      } catch {
        console.error(chalk.red('Error: patch input is not valid JSON.'));
        process.exit(1);
      }
      console.log(chalk.dim(`Amendment note: ${options.note}`));
      const result = await client.amendProposal(id, { expectedVersion: proposal.version as number, patch: patch as unknown[], idempotencyKey: randomUUID() });
      console.log(chalk.green(`✓ Amended proposal ${id} -- now version ${result.version}`));
    });
  });
