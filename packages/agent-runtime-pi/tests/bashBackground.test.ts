import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'

import { createBashTool, createPowerShellToolDefinition } from '@earendil-works/pi-coding-agent'
import { expect, it, onTestFinished } from 'vitest'

it('keeps background capability out of ordinary Bash and PowerShell schemas', () => {
  expect(createBashTool(process.cwd()).parameters.properties).not.toHaveProperty('run_in_background')
  expect(createPowerShellToolDefinition(process.cwd()).parameters.properties).not.toHaveProperty('run_in_background')
})

it('preserves native preparation, progress, nonzero completion and explicit deadlines', async () => {
  const tool = createBashTool(process.cwd(), {
    commandPrefix: 'prefix',
    spawnHook: (execution) => ({ ...execution, env: { ...execution.env, SHELL_TEST: 'prepared' } }),
    backgroundOperations: {
      async exec(command, cwd, options) {
        expect({ command, cwd }).toEqual({ command: 'prefix\ncommand', cwd: process.cwd() })
        expect(options).toMatchObject({
          toolCallId: 'native-call',
          runInBackground: true,
          timeout: 45,
          env: { SHELL_TEST: 'prepared' }
        })
        options.onData(Buffer.from('actual output'))
        return { status: 'completed', exitCode: 7 }
      }
    }
  })
  const result = await tool.execute('native-call', { command: 'command', timeout: 45, run_in_background: true })
  expect(result).toMatchObject({
    isError: true,
    structuredContent: { output: 'actual output', truncated: false, exit_code: 7 }
  })
  expect(result.structuredContent).not.toHaveProperty('status')
})

it('returns a bounded running receipt without inventing completion or accepting later output', async () => {
  let outputAfterYield: ((data: Buffer) => void) | undefined
  const tool = createBashTool(process.cwd(), {
    backgroundOperations: {
      async exec(_command, _cwd, options) {
        options.onData(Buffer.from('x'.repeat(80_000)))
        outputAfterYield = options.onData
        return { status: 'running', executionId: 'execution-1', outputCursor: 80_000 }
      }
    }
  })
  const result = await tool.execute('background-call', { command: 'command', run_in_background: true })
  expect(result.isError).not.toBe(true)
  expect(result.structuredContent).toMatchObject({
    status: 'running',
    execution_id: 'execution-1',
    output_cursor: 80_000,
    truncated: true
  })
  expect(result.structuredContent).not.toHaveProperty('exit_code')
  expect(result.structuredContent).not.toHaveProperty('full_output_path')
  const structured = result.structuredContent
  const snapshotPath =
    structured && typeof structured === 'object' && 'output_snapshot_path' in structured
      ? structured.output_snapshot_path
      : undefined
  expect(typeof snapshotPath).toBe('string')
  if (typeof snapshotPath === 'string') onTestFinished(() => rm(snapshotPath, { force: true }))
  const before = structuredClone(result)
  outputAfterYield?.(Buffer.from('later output belongs to the retained task'))
  expect(result).toEqual(before)
})

it('promotes one real process and survives cancellation after handoff', async () => {
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  let promote!: (receipt: { status: 'running'; executionId: string; outputCursor: number }) => void
  const promoted = new Promise<{ status: 'running'; executionId: string; outputCursor: number }>((resolve) => {
    promote = resolve
  })
  const child = spawn(process.execPath, ['-e', 'process.stdout.write(String(process.pid)); process.stdin.resume()'], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const exited = once(child, 'exit')
  onTestFinished(async () => {
    child.kill()
    await exited
  })
  let pidOutput = ''
  const controller = new AbortController()
  let turnOwnsProcess = true
  const tool = createBashTool(process.cwd(), {
    backgroundOperations: {
      async exec(_command, _cwd, options) {
        options.signal?.addEventListener('abort', () => {
          if (turnOwnsProcess) child.kill()
        })
        child.stdout.on('data', (data: Buffer) => {
          pidOutput += data.toString()
          options.onData(data)
          markStarted()
        })
        return promoted
      }
    }
  })
  const pending = tool.execute('promoted-call', { command: 'already running', timeout: 90 }, controller.signal)
  await started
  const pid = child.pid!
  turnOwnsProcess = false
  promote({ status: 'running', executionId: `process-${pid}`, outputCursor: pidOutput.length })
  const receipt = await pending
  controller.abort()
  expect(receipt.structuredContent).toMatchObject({
    status: 'running',
    execution_id: `process-${pid}`,
    output: String(pid)
  })
  expect(child.exitCode).toBeNull()
  expect(() => process.kill(pid, 0)).not.toThrow()
})

it('keeps backend cancellation and timeout failures as failures', async () => {
  const tool = createBashTool(process.cwd(), {
    backgroundOperations: {
      exec: async () => {
        throw new Error('timeout:2')
      }
    }
  })
  await expect(tool.execute('timed-out-call', { command: 'command' })).rejects.toThrow(
    'Command timed out after 2 seconds'
  )
})
