import { spawn } from 'child_process'
import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('child_process', { spy: true })
vi.mock('registry-js', () => ({
  HKEY: { HKEY_LOCAL_MACHINE: 'machine', HKEY_CURRENT_USER: 'user' },
  RegistryValueType: { REG_SZ: 'string', REG_EXPAND_SZ: 'expand' },
  enumerateValuesSafe: vi.fn(() => [{ name: 'Path', type: 'string', data: 'C:\\capture' }])
}))

describe('shell environment cancellation', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const actual = await vi.importActual<{ spawn: typeof spawn }>('child_process')
    // Run a controlled native process instead of sourcing the test host's profiles.
    vi.mocked(spawn).mockImplementation((_command, _args, options) =>
      actual.spawn(process.execPath, ['-e', 'console.log("CAPTURE=ready")'], options)
    )
  })

  afterEach(() => {
    for (const { value: child } of vi.mocked(spawn).mock.results) {
      if (!child?.pid) continue
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    vi.restoreAllMocks()
  })

  it.each(['before', 'during'])('skips registry work and discards a capture cancelled %s acquisition', async (when) => {
    const { getShellEnv } = await import('../shellEnv')
    const { enumerateValuesSafe } = await import('registry-js')
    const controller = new AbortController()
    if (when === 'before') controller.abort()
    const pending = getShellEnv(controller.signal).then(
      () => 'resolved',
      (error) => error.name
    )
    controller.abort()

    expect(enumerateValuesSafe).not.toHaveBeenCalled()
    expect(await pending).toBe('AbortError')
    const env = await getShellEnv()
    if (process.platform === 'win32') {
      expect(enumerateValuesSafe).toHaveBeenCalledTimes(2)
      expect((env.Path ?? env.PATH).includes('C:\\capture')).toBe(true)
    } else {
      expect(env.CAPTURE).toBe('ready')
    }
  })

  it('preserves an uncancelled refresh sharing the same capture', async () => {
    const { getShellEnv, refreshShellEnv } = await import('../shellEnv')
    const { enumerateValuesSafe } = await import('registry-js')
    const controller = new AbortController()
    const pending = getShellEnv(controller.signal).then(
      () => 'resolved',
      (error) => error.name
    )
    const refresh = refreshShellEnv()
    controller.abort()

    expect(await pending).toBe('AbortError')
    await refresh
    await getShellEnv()
    expect(process.platform === 'win32' ? enumerateValuesSafe : spawn).toHaveBeenCalledTimes(
      process.platform === 'win32' ? 2 : 1
    )
  })

  it.skipIf(process.platform === 'win32')(
    'drains the login process tree when the last Hook session closes',
    async () => {
      const actual = await vi.importActual<{ spawn: typeof spawn }>('child_process')
      const descendant = `
      const server = require('node:net').createServer()
      server.listen(0, '127.0.0.1', () => console.log(server.address().port))
      setTimeout(() => server.close(), 30000)
    `
      let port = ''
      vi.mocked(spawn).mockImplementationOnce((_command, _args, options) => {
        const child = actual.spawn(
          process.execPath,
          [
            '-e',
            `
        require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {
          stdio: ['ignore', 'inherit', 'inherit']
        })
        setTimeout(() => {}, 30000)
      `
          ],
          options
        )
        child.stdout?.on('data', (chunk) => {
          port += chunk.toString()
        })
        return child
      })
      const { AgentHookSession } = await import('../../ai/agentSession/AgentHookSession')
      const { getShellEnv } = await import('../shellEnv')
      const sessions = [1, 2].map(
        (id) =>
          new AgentHookSession({
            sessionId: String(id),
            agentId: 'test',
            runtime: 'pi',
            getCwd: tmpdir,
            getConfiguration: () => ({
              hooks: [
                { id: randomUUID(), name: '', event: 'preToolUse', enabled: true, command: 'exit 0', timeoutMs: 1000 }
              ]
            })
          })
      )
      const pending = sessions.map((session) => session.invoke({ event: 'preToolUse' }))
      try {
        await expect.poll(() => vi.mocked(spawn).mock.results.length).toBe(1)
        const child = vi.mocked(spawn).mock.results[0].value
        await expect.poll(() => Number(port), { timeout: 10_000 }).toBeGreaterThan(0)
        await sessions[0].close()
        expect(await pending[0]).toMatchObject({ denied: true })
        expect(child.exitCode ?? child.signalCode).toBeNull()

        const closing = sessions[1].close()
        // A new caller must not join the cancelled capture while its process exits.
        const next = getShellEnv()
        await closing
        expect(await pending[1]).toMatchObject({ denied: true })
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
        expect(child.stdout?.destroyed && child.stderr?.destroyed).toBe(true)
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
              })
          )
          .toMatchObject({ code: 'ECONNREFUSED' })
        expect((await next).CAPTURE).toBe('ready')
        expect(spawn).toHaveBeenCalledTimes(2)
      } finally {
        await Promise.all(sessions.map((session) => session.close()))
        await Promise.allSettled(pending)
      }
    }
  )
})
