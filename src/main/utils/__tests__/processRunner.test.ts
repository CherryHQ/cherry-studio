import { getEventListeners } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import crossSpawn from 'cross-spawn'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getShellEnv } from '../shellEnv'

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn() }))
vi.mock('cross-spawn', { spy: true })

import { executeCommand, terminateProcessTree, waitForProcessExit } from '../processRunner'

const printStdout = ['-e', "process.stdout.write('command output')"]

describe('executeCommand', () => {
  afterEach(async () => {
    for (const { value: child } of vi.mocked(crossSpawn).mock.results) {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        await terminateProcessTree(child, true, 'processRunner test')
        await waitForProcessExit(child, 2000)
      }
    }
    vi.clearAllMocks()
  })

  it('returns stdout when capture is omitted', async () => {
    await expect(executeCommand(process.execPath, printStdout, { env: process.env })).resolves.toBe('command output')
  })

  it('discards stdout when capture is explicitly disabled', async () => {
    await expect(executeCommand(process.execPath, printStdout, { capture: false, env: process.env })).resolves.toBe('')
  })

  it('returns structured output and exit status', async () => {
    const controller = new AbortController()
    const result = await executeCommand(
      process.execPath,
      ['-e', "process.stdout.write('output'); process.exitCode = 7"],
      {
        env: process.env,
        signal: controller.signal,
        result: 'structured'
      }
    )
    expect(result).toMatchObject({ code: 7, stdout: 'output', stderr: '', output: 'output' })
    expect(result.failure).toBeUndefined()
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('terminates a command whose captured stdout exceeds the configured limit', async () => {
    await expect(
      executeCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(64))"], {
        capture: true,
        env: process.env,
        maxOutputBytes: 16
      })
    ).rejects.toThrow('output exceeded 16 bytes')
  })

  it('preserves legacy rejection with stderr or the exit code', async () => {
    await expect(
      executeCommand(process.execPath, ['-e', "process.stderr.write('command denied'); process.exitCode = 7"], {
        env: process.env
      })
    ).rejects.toThrow('command denied')
    await expect(
      executeCommand(process.execPath, ['-e', 'process.exitCode = 7'], { env: process.env })
    ).rejects.toThrow('Command failed with code 7')
  })

  it('uses the captured shell environment when no environment is supplied', async () => {
    vi.mocked(getShellEnv).mockResolvedValueOnce({ COMMAND_TEST_VALUE: 'shell' })
    await expect(
      executeCommand(process.execPath, ['-e', 'process.stdout.write(process.env.COMMAND_TEST_VALUE)'])
    ).resolves.toBe('shell')
  })

  it('uses the supplied cwd, environment and UTF-8 stdin without putting input in command arguments', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'process-runner test-'))
    const input = "中文 $(exit 0); 'quotes'"
    try {
      const result = await executeCommand(
        process.execPath,
        [
          '-e',
          `
        let input = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', chunk => { input += chunk })
        process.stdin.on('end', () => {
          process.stdout.write(JSON.stringify({ cwd: process.cwd(), env: process.env.COMMAND_TEST_VALUE, input }), () => {
            process.stderr.write('denied', () => { process.exitCode = 7 })
          })
        })
      `
        ],
        { env: { ...process.env, COMMAND_TEST_VALUE: 'explicit' }, cwd, stdin: input, result: 'structured' }
      )
      expect(result.code).toBe(7)
      expect(result.failure).toBeUndefined()
      expect(JSON.parse(result.stdout)).toEqual({ cwd: await realpath(cwd), env: 'explicit', input })
      expect(result.stderr).toBe('denied')
      expect(result.output).toContain(input)
      expect(vi.mocked(crossSpawn).mock.calls[0][1]).not.toContain(input)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('decodes UTF-8 only after collecting all chunks', async () => {
    const result = await executeCommand(
      process.execPath,
      [
        '-e',
        `
      const bytes = Buffer.from('中文🙂')
      let index = 0
      const timer = setInterval(() => {
        process.stdout.write(bytes.subarray(index, ++index))
        if (index === bytes.length) clearInterval(timer)
      }, 10)
    `
      ],
      { env: process.env }
    )
    expect(result).toBe('中文🙂')
  })

  it('does not launch an already cancelled command or one cancelled during environment lookup', async () => {
    const controller = new AbortController()
    let releaseEnv!: (env: Record<string, string>) => void
    vi.mocked(getShellEnv).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseEnv = resolve
      })
    )
    const pending = executeCommand(process.execPath, printStdout, { signal: controller.signal, result: 'structured' })
    controller.abort()
    releaseEnv({})
    expect(await pending).toMatchObject({ code: null, output: '', failure: expect.stringContaining('cancelled') })
    await expect(executeCommand(process.execPath, printStdout, { signal: controller.signal })).rejects.toThrow(
      'cancelled'
    )
    expect(crossSpawn).not.toHaveBeenCalled()
  })

  it('cancels a running command and waits for its exit before returning', async () => {
    const controller = new AbortController()
    const pending = executeCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: process.env,
      signal: controller.signal,
      result: 'structured'
    })
    await expect.poll(() => vi.mocked(crossSpawn).mock.results[0]?.value?.pid).toBeDefined()
    const child = vi.mocked(crossSpawn).mock.results[0].value
    controller.abort()
    expect(await pending).toMatchObject({ code: null, failure: expect.stringContaining('cancelled') })
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(child.stdin?.destroyed).toBe(true)
    expect(child.stdout?.destroyed).toBe(true)
    expect(child.stderr?.destroyed).toBe(true)
  })

  it('cancels descendants as well as the directly spawned process', async () => {
    const descendant = `
      const server = require('node:net').createServer()
      server.listen(0, '127.0.0.1', () => { process.stdout.write(String(server.address().port)) })
      setTimeout(() => server.close(), 30000)
    `
    const controller = new AbortController()
    const pending = executeCommand(
      process.execPath,
      [
        '-e',
        `
      require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] })
      setTimeout(() => {}, 30000)
    `
      ],
      { env: process.env, signal: controller.signal, result: 'structured' }
    )
    const child = vi.mocked(crossSpawn).mock.results[0].value
    expect(vi.mocked(crossSpawn).mock.calls[0][2]).toMatchObject({
      detached: process.platform !== 'win32',
      windowsHide: true
    })
    let port = ''
    child.stdout?.on('data', (chunk) => {
      port += chunk.toString()
    })
    await expect.poll(() => Number(port), { timeout: 10_000 }).toBeGreaterThan(0)
    controller.abort()
    expect(await pending).toMatchObject({ failure: expect.stringContaining('cancelled') })
    expect(mockMainLoggerService.error.mock.calls).toEqual([])
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    // Descendant socket teardown can lag the parent's exit on Windows.
    await expect
      .poll(
        () =>
          new Promise<Error | null>((resolve) => {
            const socket = createConnection({ host: '127.0.0.1', port: Number(port) })
            socket.setTimeout(2000, () => socket.destroy(new Error('Probe timed out')))
            socket.once('connect', () => {
              socket.destroy()
              resolve(null)
            })
            socket.once('error', resolve)
          }),
        { timeout: 5000 }
      )
      .toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('returns a bounded combined output and terminates on overflow from either stream', async () => {
    const result = await executeCommand(
      process.execPath,
      [
        '-e',
        `
      process.stdout.write('12345678', () => { process.stderr.write('abcdefghijk') })
      setInterval(() => {}, 1000)
    `
      ],
      { env: process.env, maxOutputBytes: 16, result: 'structured' }
    )
    expect(result).toMatchObject({ code: null, failure: expect.stringContaining('output exceeded 16 bytes') })
    expect(Buffer.byteLength(result.output)).toBe(16)
    expect(result.stdout.length + result.stderr.length).toBe(16)
    const child = vi.mocked(crossSpawn).mock.results[0].value
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('returns a timeout only after terminating the command', async () => {
    const result = await executeCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: process.env,
      timeout: 100,
      result: 'structured'
    })
    expect(result.failure).toContain('timed out')
    const child = vi.mocked(crossSpawn).mock.results[0].value
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('reports launch failures and closes its streams', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'process-runner-missing-'))
    try {
      const result = await executeCommand(path.join(cwd, 'missing-executable'), [], {
        env: process.env,
        stdin: 'input',
        result: 'structured'
      })
      expect(result).toMatchObject({ code: null, failure: expect.stringContaining('ENOENT') })
      const child = vi.mocked(crossSpawn).mock.results[0].value
      expect(child.stdin?.destroyed).toBe(true)
      expect(child.stdout?.destroyed).toBe(true)
      expect(child.stderr?.destroyed).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
