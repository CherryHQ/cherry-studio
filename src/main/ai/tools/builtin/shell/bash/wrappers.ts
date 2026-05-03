/**
 * Strip "wrapper" commands so the real command underneath gets
 * allowlist / denylist treatment.
 *
 * A wrapper is a command that takes another command as a positional
 * argument: `nice -n 10 ls`, `timeout 30 curl ...`, `env FOO=bar baz`.
 * Without stripping, `nice -n 10 rm -rf /` would name-match `nice` and
 * sail through allowlist gates while actually executing `rm -rf /`.
 *
 * Stripping is recursive — `nice -n 10 timeout 30 ls` peels to `ls`.
 *
 * Returns `null` when peeling consumes everything (no real command),
 * which the classifier treats as fail-closed.
 */

import type { SimpleCommand } from './parser'

/**
 * Each entry: how many wrapper-flag args to consume after the wrapper
 * name before the real command begins.
 *
 *   nice [-n N | --adjustment=N] CMD ARGS...
 *   timeout [--signal SIG | -k SEC | --foreground | --preserve-status] DURATION CMD ARGS...
 *   time [-p | -v] CMD ARGS...
 *   env [-i | -u VAR | NAME=VALUE]... CMD ARGS...
 */
type WrapperSpec = {
  /** Predicate: a leading arg is a flag belonging to the wrapper, not part of the inner command. */
  isWrapperArg: (arg: string) => boolean
}

const WRAPPERS: Record<string, WrapperSpec> = {
  nice: { isWrapperArg: (a) => a.startsWith('-') || /^\d+$/.test(a) },
  ionice: { isWrapperArg: (a) => a.startsWith('-') || /^\d+$/.test(a) },
  timeout: {
    // timeout [--signal SIG | -k SEC | --foreground | --preserve-status] DURATION
    isWrapperArg: (a) => a.startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(a)
  },
  time: { isWrapperArg: (a) => a.startsWith('-') },
  env: { isWrapperArg: (a) => a.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a) },
  stdbuf: { isWrapperArg: (a) => a.startsWith('-') }
}

export function stripWrappers(command: SimpleCommand): SimpleCommand | null {
  let current: SimpleCommand | null = command
  // Bound the loop — even pathological inputs shouldn't peel more than a
  // handful of layers.
  for (let i = 0; i < 8 && current; i++) {
    const spec = WRAPPERS[current.name]
    if (!spec) return current
    let cursor = 0
    while (cursor < current.args.length && spec.isWrapperArg(current.args[cursor])) {
      cursor++
    }
    if (cursor >= current.args.length) return null
    const innerName = current.args[cursor]
    const innerArgs = current.args.slice(cursor + 1)
    current = { name: innerName, args: innerArgs, start: current.start, end: current.end }
  }
  return current
}
