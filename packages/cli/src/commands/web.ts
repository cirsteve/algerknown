/**
 * Web Command
 * Start the web UI server for the current knowledge base
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { findRoot } from '@algerknown/core';
import { spawn } from 'child_process';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const webCommand = new Command('web')
  .description('Start the web UI for the current knowledge base')
  .option('-p, --port <port>', 'Server port', '3001')
  .action((options) => {
    const cwd = process.cwd();
    
    // Verify we're inside a knowledge base
    let kbRoot: string;
    try {
      kbRoot = findRoot(cwd);
    } catch {
      console.error(chalk.red('Error: Not inside an Algerknown knowledge base.'));
      console.error(chalk.dim('Run "agn init" to create one.'));
      process.exit(1);
    }

    console.log(chalk.cyan('Starting Algerknown web UI...'));
    console.log(chalk.dim(`Knowledge base: ${kbRoot}`));
    console.log(chalk.dim(`Server port: ${options.port}`));
    console.log('');

    // Find the web package directory using require.resolve
    let webPackageDir: string;
    try {
      const webPackageJson = require.resolve('@algerknown/web/package.json');
      webPackageDir = path.dirname(webPackageJson);
    } catch {
      console.error(chalk.red('Error: Could not find @algerknown/web package.'));
      console.error(chalk.dim('Make sure dependencies are installed: npm install'));
      process.exit(1);
    }
    
    // Set environment and start the server
    const env = {
      ...process.env,
      ZKB_PATH: kbRoot,
      PORT: options.port,
    };

    // Try to start the web server
    const serverScript = path.join(webPackageDir, 'dist/server/index.js');
    
    try {
      const child = spawn('node', [serverScript], {
        env,
        stdio: 'inherit',
        cwd: webPackageDir,
      });

      child.on('error', (err) => {
        console.error(chalk.red(`Failed to start server: ${err.message}`));
        console.error(chalk.dim('Make sure @algerknown/web is built: npm run build'));
        process.exit(1);
      });

      child.on('exit', (code) => {
        process.exit(code || 0);
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });
