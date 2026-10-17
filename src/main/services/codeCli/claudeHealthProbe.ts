import { execFile } from 'child_process'
import path from 'node:path'
import { promisify } from 'util'

import { getRawShellEnv } from '@main/utils/shellEnv'

const execFileAsync = promisify(execFile)

// Bounded `--version` run: proves the binary starts without needing auth or a session.
const PROBE_TIMEOUT_MS = 10_000
const DETAIL_LIMIT = 500

// Windows fatal application-exit range (0xC0000000-0xCFFFFFFF): access violations surface
// as decimal codes with no signal and empty output, which no output pattern can match.

export type ClaudeStartupProbeReason = 'startup-crash' | 'spawn' | 'timeout' | 'exit'

export interface ClaudeStartupProbeFailure {
  reason: ClaudeStartupProbeReason
  detail: string
}

export type ClaudeStartupProbeResult = { ok: true } | { ok: false; failure: ClaudeStartupProbeFailure }

const NTSTATUS_ERROR_MIN = 0xc0000000
const NTSTATUS_ERROR_MAX = 0xcfffffff

// Native-crash markers as seen in --version output. Tested against captured output only:
// the rejection message embeds the command line, so a crash token in the install path
// must never count as crash evidence. No `bun` alternative: a mere runtime mention proves nothing.
const CRASH_OUTPUT_PATTERN = /segmentation fault|segfault|sigsegv|sigabrt|access violation|0xc000|panic|fatal error/i

interface ProbeErrorShape {
  code?: unknown
  signal?: unknown
  killed?: unknown
  stdout?: unknown
  stderr?: unknown
}

/** Pure classifier so the crash-vs-auth-vs-exit boundary is unit-testable without spawning. */
export function classifyClaudeStartupError(error: unknown): ClaudeStartupProbeFailure {
  const shaped = (error ?? {}) as ProbeErrorShape
  const detail = error instanceof Error ? error.message : String(error)

  // Kill state only: output text may mention timeouts (e.g. a network-timeout hint) on instant exits.
  if (shaped.killed === true || shaped.code === 'ETIMEDOUT') {
    return { reason: 'timeout', detail }
  }
  if (
    shaped.code === 'ENOENT' ||
    shaped.code === 'EACCES' ||
    shaped.code === 'EPERM' ||
    (typeof shaped.code === 'string' && shaped.code.startsWith('spawn')) ||
    /failed to spawn|spawn .* enoent/is.test(detail)
  ) {
    return { reason: 'spawn', detail }
  }
  if (typeof shaped.signal === 'string' && shaped.signal.length > 0) {
    return { reason: 'startup-crash', detail }
  }
  if (typeof shaped.code === 'number' && shaped.code >= NTSTATUS_ERROR_MIN && shaped.code <= NTSTATUS_ERROR_MAX) {
    return { reason: 'startup-crash', detail }
  }
  const output = `${typeof shaped.stdout === 'string' ? shaped.stdout : ''}\n${typeof shaped.stderr === 'string' ? shaped.stderr : ''}`
  if (CRASH_OUTPUT_PATTERN.test(output)) {
    return { reason: 'startup-crash', detail }
  }
  return { reason: 'exit', detail }
}

export async function probeClaudeExecutable(executablePath: string, cwd?: string): Promise<ClaudeStartupProbeResult> {
  // npm-global shims (.cmd/.bat) need cmd.exe, and a shell concatenates its
  // command line unquoted — quote a spaced shim path so it still resolves.
  const needsShell = ['.cmd', '.bat'].includes(path.extname(executablePath).toLowerCase())
  // cmd.exe expands %…% even inside quotes — double it like the launch does,
  // or a path such as "100% tools" corrupts the probe.
  const command =
    needsShell && process.platform === 'win32'
      ? `"${executablePath.replace(/%/g, '%%')}"`
      : needsShell
        ? `"${executablePath}"`
        : executablePath
  // Discovery resolves system binaries on the login-shell PATH and the terminal
  // launches with that same env; probe with it too, not the stale process env.
  const env = await getRawShellEnv()
  try {
    await execFileAsync(command, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      killSignal: 'SIGKILL',
      shell: needsShell,
      env,
      ...(cwd ? { cwd } : {})
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, failure: classifyClaudeStartupError(error) }
  }
}

function truncateDetail(detail: string): string {
  return detail.length > DETAIL_LIMIT ? `${detail.slice(0, DETAIL_LIMIT)}…` : detail
}

/** Actionable failure text: names the binary and offers the managed-binary recovery path. */
export function describeClaudeStartupFailure(executablePath: string, failure: ClaudeStartupProbeFailure): string {
  const prefix =
    failure.reason === 'startup-crash'
      ? `The selected Claude Code system binary "${executablePath}" crashed during startup`
      : failure.reason === 'timeout'
        ? `The selected Claude Code system binary "${executablePath}" did not respond during the startup check`
        : failure.reason === 'spawn'
          ? `The selected Claude Code system binary "${executablePath}" could not be started`
          : `The selected Claude Code system binary "${executablePath}" failed the startup check`
  return `${prefix} (${truncateDetail(failure.detail)}). Switch to the managed Claude binary, reinstall a tested version, or select another executable.`
}
