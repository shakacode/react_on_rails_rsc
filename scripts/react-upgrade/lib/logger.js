import chalk from 'chalk';

let verbose = false;

export function setVerbose(value) {
  verbose = value;
}

export function info(message) {
  console.log(chalk.green('✓') + ' ' + message);
}

export function warn(message) {
  console.log(chalk.yellow('⚠') + ' ' + message);
}

export function error(message) {
  console.error(chalk.red('✗') + ' ' + message);
}

export function debug(message) {
  if (verbose) {
    console.log(chalk.blue('[DEBUG]') + ' ' + message);
  }
}

export function step(message) {
  console.log('\n' + chalk.bold(message));
}

export function prompt(message) {
  process.stdout.write(message);
}

export const logger = {
  info,
  warn,
  error,
  debug,
  step,
  prompt,
  setVerbose,
};
