import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { READY_TIMEOUT_MS } from '../protocol/constants'
import type { MainFrame } from '../protocol/frames'
import { isUtilityProcessError, type UtilityProcessError, type UtilityProcessErrorCode } from '../UtilityProcessError'
import { createHost, echoScript, rejectionOf } from './hostTestUtils'
import {
  createMemoryProcessAdapter,
  flushMicrotasks,
  type MemoryChild,
  type MemoryChildScript,
  waitUntil
} from './memoryProcessAdapter'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function expectCode(error: unknown, code: UtilityProcessErrorCode): UtilityProcessError {
  expect(isUtilityProcessError(error, code), `expected ${code}, got ${String(error)}`).toBe(true)
  return error as UtilityProcessError
}

/** Scripted child that announces ready and hands every request to `onRequest`. */
function scriptedReady(onRequest: (child: MemoryChild, frame: MainFrame) => void): MemoryChildScript {
  return (child) => {
    child.onFrame((frame) => onRequest(child, frame))
    void child.awaitConnect().then(() => child.reply({ kind: 'ready' }))
  }
}

describe('ProcessHost lifecycle', () => {
  it('spawns nothing until the first request and shares one cold start across concurrent callers', async () => {
    const { host, adapter } = createHost()
    await host.stop()
    expect(adapter.spawns).toHaveLength(0)

    const results = await Promise.all([
      host.request('ping', undefined),
      host.request('echo', 1),
      host.request('echo', 'two')
    ])

    expect(results).toEqual(['pong', 1, 'two'])
    expect(adapter.spawns).toHaveLength(1)
  })

  it('passes the definition env additions and the temp dir to the spawned child', async () => {
    const { host, adapter } = createHost({ definition: { createEnv: () => ({ MY_FLAG: '1' }) } })
    await host.request('ping', undefined)

    const { env, serviceName, entryPath } = adapter.spawns[0]
    expect(env.MY_FLAG).toBe('1')
    expect(env.TMPDIR).toBe('/tmp/cherry-test')
    expect(env.HOME).toBeUndefined()
    expect(serviceName).toBe('CherryStudio.UtilityProcess.test.echo')
    expect(entryPath).toBe('/out/utility-process/test-echo.js')
  })

  it('fails the cold start with PROCESS_START_FAILED and kills the child when ready never arrives', async () => {
    const { host, adapter } = createHost({ script: () => {} })
    const pending = rejectionOf(host.request('ping', undefined))
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 1)
    expect(adapter.spawns[0].child.killed).toBe(false)

    await vi.advanceTimersByTimeAsync(1)

    expectCode(await pending, 'PROCESS_START_FAILED')
    expect(adapter.spawns[0].child.killed).toBe(true)
  })

  it('maps a synchronous spawn failure to PROCESS_START_FAILED with the cause attached', async () => {
    const adapter = createMemoryProcessAdapter(undefined, { spawnThrows: new Error('ENOENT') })
    const { host } = createHost({ adapter })

    const error = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_START_FAILED')
    expect((error.cause as Error).message).toBe('ENOENT')
  })

  it('rejects a definition env that touches reserved variables without spawning', async () => {
    const { host, adapter } = createHost({ definition: { createEnv: () => ({ NODE_OPTIONS: '--inspect' }) } })

    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_START_FAILED')
    expect(adapter.spawns).toHaveLength(0)
  })

  it('launches the process while an async createInitData resolves, then connects with its value', async () => {
    let resolveInitData!: (value: { token: string }) => void
    const { host, adapter } = createHost({
      definition: {
        createInitData: () =>
          new Promise<{ token: string }>((resolve) => {
            resolveInitData = resolve
          })
      }
    })

    const pending = host.request('ping', undefined)
    await flushMicrotasks()
    expect(adapter.spawns).toHaveLength(1)
    expect(adapter.spawns[0].child.connectFrame).toBeNull()

    resolveInitData({ token: 'from-proxy-snapshot' })

    await expect(pending).resolves.toBe('pong')
    expect(adapter.spawns[0].child.connectFrame?.initData).toEqual({ token: 'from-proxy-snapshot' })
  })

  it('fails the cold start with PROCESS_START_FAILED when createInitData rejects', async () => {
    const { host, adapter } = createHost({
      definition: { createInitData: () => Promise.reject(new Error('proxy flush failed')) }
    })

    const error = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_START_FAILED')
    expect((error.cause as Error).message).toBe('proxy flush failed')
    expect(error.failureCount).toBe(1)
    await waitUntil(() => adapter.spawns[0].child.killed, 'child kill')
  })

  it('maps a failed child initialize to PROCESS_START_FAILED carrying the remote error', async () => {
    const { script } = echoScript({
      initialize: () => {
        throw new Error('model missing')
      }
    })
    const { host, adapter } = createHost({ script })

    const error = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_START_FAILED')
    expect(error.remote?.message).toBe('model missing')
    expect((error.cause as Error).message).toBe('model missing')
    await waitUntil(() => adapter.spawns[0].child.exited, 'child exit')
  })

  it('maps an exit before ready to PROCESS_START_FAILED with the exit code', async () => {
    const { host } = createHost({
      script: (child) => {
        void child.awaitConnect().then(() => child.exit(3))
      }
    })

    const error = expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_START_FAILED')
    expect(error.exitCode).toBe(3)
  })

  it('correlates out-of-order results by request id', async () => {
    const queued: Extract<MainFrame, { kind: 'request' }>[] = []
    const { host } = createHost({
      script: scriptedReady((child, frame) => {
        if (frame.kind !== 'request') return
        queued.push(frame)
        if (queued.length < 2) return
        for (const request of [...queued].reverse()) {
          child.reply({ kind: 'result', requestId: request.requestId, output: `result-${request.input}` })
        }
      })
    })

    const results = await Promise.all([host.request('echo', 'a'), host.request('echo', 'b')])
    expect(results).toEqual(['result-a', 'result-b'])
  })

  it('rejects in-flight requests with PROCESS_EXITED on an unrequested exit, without eager restart or replay', async () => {
    const echo = echoScript().script
    const { host, adapter } = createHost({
      script: (child, index, options) => {
        if (index > 0) return echo(child, index, options)
        void scriptedReady((c, frame) => {
          if (frame.kind === 'request') c.exit(9)
        })(child, index, options)
      }
    })

    const error = expectCode(await rejectionOf(host.request('echo', 'lost')), 'PROCESS_EXITED')
    expect(error.intentional).toBe(false)
    expect(error.exitCode).toBe(9)
    await flushMicrotasks()
    expect(adapter.spawns).toHaveLength(1)

    await expect(host.request('ping', undefined)).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
    const replayed = adapter.spawns[1].child.frames.filter(
      (frame) => frame.kind === 'request' && frame.method === 'echo'
    )
    expect(replayed).toHaveLength(0)
  })

  it('stops an idle generation after idleTimeoutMs and resets the timer on each request', async () => {
    const { host, adapter } = createHost({ definition: { idleTimeoutMs: 1000 } })
    await host.request('ping', undefined)
    const child = adapter.spawns[0].child

    await vi.advanceTimersByTimeAsync(600)
    await host.request('ping', undefined)
    await vi.advanceTimersByTimeAsync(999)
    expect(child.exited).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await waitUntil(() => child.exited, 'idle exit')
    expect(child.exitCode).toBe(0)
    expect(adapter.spawns).toHaveLength(1)
  })

  it('serves a request that arrives during the idle shutdown on the next generation', async () => {
    const { script } = echoScript({
      dispose: () => new Promise((resolve) => setTimeout(resolve, 100))
    })
    const { host, adapter } = createHost({ script, definition: { idleTimeoutMs: 1000 } })
    await host.request('ping', undefined)

    await vi.advanceTimersByTimeAsync(1000)
    const late = host.request('ping', undefined)
    await flushMicrotasks()
    expect(adapter.spawns).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(100)
    await expect(late).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
    expect(adapter.spawns[0].child.exitCode).toBe(0)
  })

  it('ignores every frame a generation emits after it has been failed', async () => {
    const echo = echoScript().script
    const { host, adapter } = createHost({
      script: (child, index, options) => {
        if (index > 0) return echo(child, index, options)
        child.onKill(() => setTimeout(() => child.exit(137), 50))
        void scriptedReady((c, frame) => {
          if (frame.kind !== 'request') return
          c.post({ bogus: true })
          c.reply({ kind: 'ready' })
          c.reply({ kind: 'result', requestId: frame.requestId, output: 'late' })
        })(child, index, options)
      }
    })

    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_PROTOCOL_ERROR')
    const next = host.request('ping', undefined)
    await vi.advanceTimersByTimeAsync(50)

    await expect(next).resolves.toBe('pong')
    expect(adapter.spawns).toHaveLength(2)
  })

  it('does not settle a request when the port closes before the process exits', async () => {
    const { host } = createHost({
      script: scriptedReady((child, frame) => {
        if (frame.kind !== 'request') return
        child.childPort.close()
        setTimeout(() => child.exit(5), 100)
      })
    })
    let settled = false
    const pending = rejectionOf(
      host.request('ping', undefined).finally(() => {
        settled = true
      })
    )
    await vi.advanceTimersByTimeAsync(99)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const error = expectCode(await pending, 'PROCESS_EXITED')
    expect(error.exitCode).toBe(5)
  })

  it('relays child log frames and stdio lines with the generation and request id', async () => {
    const { host, adapter, logger } = createHost()
    await host.request('log', 'hello from child')
    const child = adapter.spawns[0].child
    child.writeStdout('out line\n')
    child.writeStderr('err line\n')

    const relayed = logger.entries.find((entry) => entry.message.includes('hello from child'))
    expect(relayed?.level).toBe('info')
    expect(relayed?.data[0]).toMatchObject({ processId: 'test.echo', generation: 1, requestId: 1, extra: 1 })
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'debug', message: '[test.echo#1] stdout: out line' })
    )
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'warn', message: '[test.echo#1] stderr: err line' })
    )
  })

  it('blocks every request after dispose and shuts the live generation down', async () => {
    const { host, adapter } = createHost()
    await host.request('ping', undefined)

    await host.dispose()

    expect(adapter.spawns[0].child.exitCode).toBe(0)
    expectCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_BLOCKED')
    expect(adapter.spawns).toHaveLength(1)
  })
})
