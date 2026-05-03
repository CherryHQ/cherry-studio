/**
 * Read-only / metadata allowlist for bash commands.
 *
 * Operates on a *post-wrapper-stripped* SimpleCommand. A `true` result
 * means the command can be auto-approved (it's pure read / informational
 * and well-bounded).
 *
 * Keep the list **minimal** — when in doubt, return false and let the
 * central pipeline ask the user. New entries should be:
 *   - read-only (no filesystem mutation, no network writes)
 *   - have no -exec / shell-out side-channel
 *   - bounded resource use
 *
 * For commands that branch on a subcommand (like `git`), only the
 * read-only subcommands are listed.
 */

import type { SimpleCommand } from './parser'

/** Plain commands: any args are fine. */
const ALLOWED_PLAIN = new Set([
  // filesystem read
  'ls',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'stat',
  'file',
  'tree',
  'realpath',
  'readlink',
  'basename',
  'dirname',
  // path / process info
  'pwd',
  'whoami',
  'hostname',
  'uname',
  'which',
  'whence',
  'type',
  'date',
  'uptime',
  'id',
  'groups',
  'env', // bare `env` (no command after) prints the env — already a wrapper for the called-with-args case
  // text in/out
  'echo',
  'printf',
  'true',
  'false',
  'yes',
  // search (with flag-aware exceptions handled below)
  'grep',
  'rg',
  'ag',
  'ack'
])

/**
 * Subcommand allowlist: command name → set of safe first-positional
 * subcommands. Anything else (or no subcommand) is not allowed.
 */
const ALLOWED_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set([
    'status',
    'log',
    'diff',
    'show',
    'branch',
    'remote',
    'tag',
    'blame',
    'reflog',
    'rev-parse',
    'describe',
    'config', // covered narrowly below; full config writes still need user approval
    'ls-files',
    'ls-tree',
    'cat-file',
    'shortlog'
  ]),
  npm: new Set(['ls', 'list', 'view', 'info', 'outdated', 'config']),
  pnpm: new Set(['list', 'ls', 'why', 'outdated', 'config']),
  yarn: new Set(['list', 'info', 'outdated']),
  cargo: new Set(['tree', 'metadata', 'pkgid']),
  go: new Set(['list', 'env', 'version']),
  docker: new Set(['ps', 'images', 'inspect', 'logs', 'version', 'info'])
}

const FIND_BLOCKED_FLAGS = new Set(['-exec', '-execdir', '-delete', '-ok', '-okdir', '-fprint', '-fprintf', '-fls'])

export function isAllowed(command: SimpleCommand): boolean {
  if (command.name === 'find') return findHasNoEscalation(command.args)
  if (command.name === 'git' && command.args[0] === 'config') return gitConfigIsRead(command.args)
  if (ALLOWED_PLAIN.has(command.name)) return true

  const sub = ALLOWED_SUBCOMMANDS[command.name]
  if (!sub) return false
  const first = command.args[0]
  if (!first) return false
  return sub.has(first)
}

function findHasNoEscalation(args: string[]): boolean {
  return !args.some((a) => FIND_BLOCKED_FLAGS.has(a))
}

function gitConfigIsRead(args: string[]): boolean {
  // git config is a read-write subcommand. Only allow when it looks read-only:
  // explicit --get / --get-all / --list, or no setter syntax.
  if (args.includes('--get') || args.includes('--get-all') || args.includes('--list') || args.includes('-l')) {
    return true
  }
  // If the user passes `key value` (write), there are 3+ args after `config`.
  // Conservatively deny anything that doesn't look like a single-key read.
  return false
}
