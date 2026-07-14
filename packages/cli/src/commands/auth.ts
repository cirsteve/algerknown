/**
 * Auth Command
 * Store, inspect, and remove the CLI reviewer secret in the OS keychain
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  detectKeychainProvider,
  KEYCHAIN_SERVICE,
  UnsupportedKeychainPlatformError,
  KeychainOperationError,
} from '../auth/index.js';

function resolveAccount(): string | undefined {
  const account = process.env.GOVERNANCE_REVIEWER_ID ?? process.env.ALGERKNOWN_REVIEWER_ID;
  return account && account.trim().length > 0 ? account.trim() : undefined;
}

function requireAccount(): string {
  const account = resolveAccount();
  if (!account) {
    console.error(
      chalk.red(
        'Error: set GOVERNANCE_REVIEWER_ID (or ALGERKNOWN_REVIEWER_ID) to the reviewer account before using the keychain.',
      ),
    );
    process.exit(1);
  }
  return account;
}

const storeReviewerSecretCommand = new Command('store-reviewer-secret')
  .description('Store the reviewer secret in the platform keychain')
  .action(async () => {
    const account = requireAccount();

    let provider;
    try {
      provider = detectKeychainProvider();
    } catch (error) {
      if (error instanceof UnsupportedKeychainPlatformError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }

    const { secret } = await inquirer.prompt<{ secret: string }>([
      {
        type: 'password',
        name: 'secret',
        message: 'Reviewer secret:',
        mask: '*',
        validate: (value: string) => (value.length > 0 ? true : 'Secret must not be empty'),
      },
    ]);

    try {
      await provider.set(KEYCHAIN_SERVICE, account, secret);
    } catch (error) {
      if (error instanceof KeychainOperationError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }

    console.log(chalk.green(`✓ Stored reviewer secret for "${account}" in the ${provider.name} keychain`));
  });

const statusCommand = new Command('status')
  .description('Show where the reviewer secret would be resolved from (never prints the secret itself)')
  .action(async () => {
    const account = resolveAccount();
    const hasEnvSecret = !!process.env.ALGERKNOWN_REVIEWER_SECRET;

    console.log(chalk.cyan('Reviewer credential resolution:'));
    console.log(`  ALGERKNOWN_REVIEWER_SECRET set: ${hasEnvSecret ? chalk.green('yes') : chalk.dim('no')}`);
    console.log(`  Reviewer account: ${account ? chalk.green(account) : chalk.dim('(not set)')}`);

    if (hasEnvSecret) {
      console.log(chalk.dim('  → will resolve from ALGERKNOWN_REVIEWER_SECRET'));
      return;
    }

    if (!account) {
      console.log(chalk.yellow('  → no account configured; set GOVERNANCE_REVIEWER_ID or ALGERKNOWN_REVIEWER_ID'));
      return;
    }

    try {
      const provider = detectKeychainProvider();
      const secret = await provider.get(KEYCHAIN_SERVICE, account);
      console.log(`  ${provider.name} keychain entry: ${secret ? chalk.green('present') : chalk.yellow('absent')}`);
      console.log(secret ? chalk.dim(`  → will resolve from the ${provider.name} keychain`) : chalk.yellow('  → run `agn auth store-reviewer-secret`'));
    } catch (error) {
      if (error instanceof UnsupportedKeychainPlatformError) {
        console.log(chalk.yellow(`  ${error.message}`));
        return;
      }
      throw error;
    }
  });

const deleteReviewerSecretCommand = new Command('delete-reviewer-secret')
  .description('Delete the reviewer secret from the platform keychain')
  .action(async () => {
    const account = requireAccount();

    let provider;
    try {
      provider = detectKeychainProvider();
    } catch (error) {
      if (error instanceof UnsupportedKeychainPlatformError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }

    try {
      await provider.delete(KEYCHAIN_SERVICE, account);
    } catch (error) {
      if (error instanceof KeychainOperationError) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }

    console.log(chalk.green(`✓ Deleted reviewer secret for "${account}" from the ${provider.name} keychain`));
  });

export const authCommand = new Command('auth')
  .description('Manage the CLI reviewer secret used for governance review actions')
  .addCommand(storeReviewerSecretCommand)
  .addCommand(statusCommand)
  .addCommand(deleteReviewerSecretCommand);
