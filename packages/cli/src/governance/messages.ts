import chalk from 'chalk';

/** Prints the standard "governed, use `agn review`" refusal and exits 1. */
export function reportGovernedRefusal(entryId: string, namespace: string | undefined): never {
  console.error(chalk.red(`Error: "${entryId}" is governed${namespace ? ` (namespace "${namespace}")` : ''} and cannot be mutated directly.`));
  console.error(chalk.dim('Use `agn review list` to find its pending proposal, or submit a change through the governance API.'));
  process.exit(1);
}
