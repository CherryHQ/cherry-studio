import '@test-helpers/setupBashWasm'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { describe, expect, it } from 'vitest'

import { createShellExecToolEntry, SHELL_EXEC_TOOL_NAME } from '../exec'

const entry = createShellExecToolEntry()

interface ShellInput {
  command: string
  cwd?: string
  timeout?: number
}
type ShellOutput =
  | {
      kind: 'completed'
      exitCode: number
      stdout: string
      stderr: string
      durationMs: number
      truncated: boolean
    }
  | { kind: 'timed-out'; stdout: string; stderr: string; timeoutMs: number }
  | { kind: 'error'; code: string; message: string }

function callExecute(args: ShellInput, abortSignal?: AbortSignal): Promise<ShellOutput> {
  const execute = entry.tool.execute as (args: ShellInput, opts: ToolExecutionOptions) => Promise<ShellOutput>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1' },
    abortSignal: abortSignal ?? new AbortController().signal
  } as ToolExecutionOptions)
}

function callToModelOutput(output: ShellOutput): { type: string; value: string } {
  const fn = (
    entry.tool as {
      toModelOutput: (opts: { toolCallId: string; input: unknown; output: ShellOutput }) => {
        type: string
        value: string
      }
    }
  ).toModelOutput
  return fn({ toolCallId: 'tc-1', input: { command: '' }, output })
}

const isWindows = process.platform === 'win32'

describe('shell__exec entry', () => {
  it('registers under shell namespace as Compute capability', () => {
    expect(entry.name).toBe(SHELL_EXEC_TOOL_NAME)
    expect(entry.namespace).toBe('shell')
    expect(entry.capability).toBe('compute')
  })
})

describe('shell__exec execute', () => {
  it('rejects relative cwd', async () => {
    const out = await callExecute({ command: 'echo hi', cwd: 'rel/path' })
    expect(out).toEqual({ kind: 'error', code: 'relative-cwd', message: expect.stringContaining('rel/path') })
  })

  it.skipIf(isWindows)('runs a basic command and captures stdout', async () => {
    const out = await callExecute({ command: 'echo hello' })
    expect(out.kind).toBe('completed')
    if (out.kind === 'completed') {
      expect(out.exitCode).toBe(0)
      expect(out.stdout).toContain('hello')
      expect(out.stderr).toBe('')
      expect(out.truncated).toBe(false)
    }
  })

  it.skipIf(isWindows)('captures stderr separately and surfaces non-zero exit code', async () => {
    const out = await callExecute({ command: 'echo bad-thing 1>&2; exit 7' })
    expect(out.kind).toBe('completed')
    if (out.kind === 'completed') {
      expect(out.exitCode).toBe(7)
      expect(out.stderr).toContain('bad-thing')
      expect(out.stdout).toBe('')
    }
  })

  it.skipIf(isWindows)('honours absolute cwd', async () => {
    const out = await callExecute({ command: 'pwd', cwd: '/tmp' })
    expect(out.kind).toBe('completed')
    if (out.kind === 'completed') {
      // /tmp is /private/tmp on macOS; either should appear.
      expect(out.stdout).toMatch(/\/tmp/)
    }
  })

  it.skipIf(isWindows)('returns timed-out when command exceeds timeout', async () => {
    const out = await callExecute({ command: 'sleep 5', timeout: 100 })
    expect(out.kind).toBe('timed-out')
    if (out.kind === 'timed-out') {
      expect(out.timeoutMs).toBe(100)
    }
  })

  it.skipIf(isWindows)('returns aborted when caller signal fires', async () => {
    const ac = new AbortController()
    const promise = callExecute({ command: 'sleep 2' }, ac.signal)
    setTimeout(() => ac.abort(), 50)
    const out = await promise
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.code).toBe('aborted')
  })
})

describe('shell__exec toModelOutput', () => {
  it('completed → text with header + stdout', () => {
    const out = callToModelOutput({
      kind: 'completed',
      exitCode: 0,
      stdout: 'hello\n',
      stderr: '',
      durationMs: 12,
      truncated: false
    })
    expect(out.type).toBe('text')
    expect(out.value).toContain('[exit 0, 12ms]')
    expect(out.value).toContain('hello')
  })

  it('completed with stderr renders both streams under headers', () => {
    const out = callToModelOutput({
      kind: 'completed',
      exitCode: 1,
      stdout: 'out\n',
      stderr: 'err\n',
      durationMs: 5,
      truncated: false
    })
    expect(out.value).toContain('[exit 1, 5ms]')
    expect(out.value).toContain('out')
    expect(out.value).toContain('--- stderr ---')
    expect(out.value).toContain('err')
  })

  it('completed with truncated → header notes truncation', () => {
    const out = callToModelOutput({
      kind: 'completed',
      exitCode: 0,
      stdout: 'x'.repeat(10),
      stderr: '',
      durationMs: 1,
      truncated: true
    })
    expect(out.value).toContain('output truncated')
  })

  it('timed-out → error-text with what we got so far', () => {
    const out = callToModelOutput({
      kind: 'timed-out',
      stdout: 'partial-out',
      stderr: 'partial-err',
      timeoutMs: 100
    })
    expect(out.type).toBe('error-text')
    expect(out.value).toContain('timed-out after 100ms')
    expect(out.value).toContain('partial-out')
    expect(out.value).toContain('partial-err')
  })

  it('error → error-text', () => {
    const out = callToModelOutput({ kind: 'error', code: 'spawn-failed', message: 'no such shell' })
    expect(out.type).toBe('error-text')
    expect(out.value).toContain('spawn-failed')
    expect(out.value).toContain('no such shell')
  })
})
