#!/usr/bin/env node
/**
 * Algerknown CLI
 * Command-line interface for managing personal knowledge bases
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { editCommand } from './commands/edit.js';
import { deleteCommand } from './commands/delete.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { linkCommand, unlinkCommand } from './commands/link.js';
import { searchCommand } from './commands/search.js';
import { validateCommand } from './commands/validate.js';

const program = new Command();

program
  .name('agn')
  .description('Algerknown - Personal knowledge base management')
  .version('0.1.0');

// Register commands
program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(editCommand);
program.addCommand(deleteCommand);
program.addCommand(listCommand);
program.addCommand(showCommand);
program.addCommand(linkCommand);
program.addCommand(unlinkCommand);
program.addCommand(searchCommand);
program.addCommand(validateCommand);

program.parse();
