/**
 * Hard denylist for bash commands.
 *
 * Operates on a *post-wrapper-stripped* SimpleCommand. A `true` result
 * means "deny outright, no rule can override". The user-rule layer of
 * the central pipeline is consulted *after* this — but a deny here
 * also short-circuits at the tool-hook level (Layer 3 returns 'deny').
 *
 * Adding a new entry here means: under no circumstances should this
 * pattern run, even if the user explicitly wrote an allow rule for it.
 * Reserve for things that are dangerous regardless of intent
 * (interpreters, root-targeting destructive commands, disk wipers).
 */

import type { SimpleCommand } from './parser'

const DENIED_NAMES = new Set([
  'eval',
  'sudo',
  'su',
  'doas',
  'exec',
  // fork bomb shorthand
  ':'
])

const FILESYSTEM_DESTRUCTORS = new Set(['mkfs', 'fdisk', 'parted', 'shred'])

/** Exact-match dangerous targets (root, glob-root, home shorthands). */
const DANGEROUS_EXACT = new Set(['/', '/*', '~', '$HOME'])

/** Path prefixes — any arg equal to or descending from `<prefix>` is dangerous. */
const DANGEROUS_PREFIXES = ['/etc', '/usr', '/bin', '/sbin', '/var', '/boot', '/lib', '/lib64']

function isDangerousTarget(arg: string): boolean {
  if (DANGEROUS_EXACT.has(arg)) return true
  return DANGEROUS_PREFIXES.some((p) => arg === p || arg.startsWith(`${p}/`))
}

export function isDenied(command: SimpleCommand): boolean {
  if (DENIED_NAMES.has(command.name)) return true

  // mkfs.* family
  if (command.name.startsWith('mkfs.') || FILESYSTEM_DESTRUCTORS.has(command.name)) return true

  if (command.name === 'rm') return command.args.some(isDangerousTarget)

  if (command.name === 'chmod' || command.name === 'chown') {
    return command.args.some(isDangerousTarget)
  }

  if (command.name === 'dd') return ddWritesDevice(command.args)

  return false
}

function ddWritesDevice(args: string[]): boolean {
  // dd is usually fine for file copies. Deny when output target points
  // at a device node — that's the disk-wipe shape.
  return args.some((a) => a.startsWith('of=/dev/'))
}
