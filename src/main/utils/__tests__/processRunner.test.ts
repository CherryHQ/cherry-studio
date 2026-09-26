import { randomUUID } from 'node:crypto'
import { getEventListeners } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import crossSpawn from 'cross-spawn'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getShellEnv } from '../shellEnv'

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn() }))
vi.mock('cross-spawn', { spy: true })

import { CommandOutputLimitError, executeCommand, terminateProcessTree, waitForProcessExit } from '../processRunner'

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

  it('terminates a command whose captured stdout exceeds the configured limit', async () => {
    await expect(
      executeCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(64))"], {
        capture: true,
        env: process.env,
        maxOutputBytes: 16
      })
    ).rejects.toThrow(CommandOutputLimitError)
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
    const signal = new AbortController().signal
    try {
      await writeFile(path.join(cwd, 'marker.txt'), 'working directory')
      const result = await executeCommand(
        process.execPath,
        [
          '-e',
          `
        let input = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', chunk => { input += chunk })
        process.stdin.on('end', () => {
          const marker = require('node:fs').readFileSync('marker.txt', 'utf8')
          process.stdout.write(JSON.stringify({ marker, env: process.env.COMMAND_TEST_VALUE, input }), () => {
            process.stderr.write('denied', () => { process.exitCode = 7 })
          })
        })
      `
        ],
        { env: { ...process.env, COMMAND_TEST_VALUE: 'explicit' }, cwd, stdin: input, signal, result: 'structured' }
      )
      expect(result).toMatchObject({ code: 7, stderr: 'denied', failure: undefined })
      expect(JSON.parse(result.stdout)).toEqual({ marker: 'working directory', env: 'explicit', input })
      expect(result.output).toContain(input)
      expect(vi.mocked(crossSpawn).mock.calls[0][1]).not.toContain(input)
      expect(getEventListeners(signal, 'abort')).toHaveLength(0)
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

  it.each(['structured', 'stdout'])('cancels environment lookup without launching a command (%s)', async (mode) => {
    const controller = new AbortController()
    const env = Promise.withResolvers<Record<string, string>>()
    vi.mocked(getShellEnv).mockImplementationOnce((signal) => {
      signal?.addEventListener('abort', () => env.reject(signal.reason), { once: true })
      return env.promise
    })
    const run = () =>
      mode === 'structured'
        ? executeCommand(process.execPath, printStdout, { signal: controller.signal, result: 'structured' })
        : executeCommand(process.execPath, printStdout, { signal: controller.signal })
    let settled = false
    const pending = run()
      .catch((error) => error)
      .finally(() => {
        settled = true
      })
    try {
      controller.abort()
      await expect.poll(() => settled).toBe(true)
      for (const result of [await pending, await run().catch((error) => error)]) {
        if (mode === 'structured') {
          expect(result).toMatchObject({ code: null, output: '', failure: expect.stringContaining('cancelled') })
        } else {
          expect(result).toBeInstanceOf(Error)
          expect(result.message).toContain('cancelled')
        }
      }
    } finally {
      env.resolve({})
      await pending
    }
    expect(crossSpawn).not.toHaveBeenCalled()
    expect(getShellEnv).toHaveBeenCalledTimes(1)
  })

  it('cancels the process tree and releases streams before returning', async () => {
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
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(child.stdin?.destroyed && child.stdout?.destroyed && child.stderr?.destroyed).toBe(true)
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
    const result = await executeCommand(path.join(tmpdir(), `missing-command-${randomUUID()}`), [], {
      env: process.env,
      stdin: 'input',
      result: 'structured'
    })
    expect(result).toMatchObject({ code: null, failure: expect.stringContaining('ENOENT') })
    const child = vi.mocked(crossSpawn).mock.results[0].value
    expect(child.stdin?.destroyed && child.stdout?.destroyed && child.stderr?.destroyed).toBe(true)
  })
})
