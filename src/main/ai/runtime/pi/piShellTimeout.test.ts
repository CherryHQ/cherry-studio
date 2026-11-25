import { createBashToolDefinition, type ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { afterEach, expect, it, vi } from 'vitest'

import { withPiShellTimeout } from './piShellTimeout'

const context = { cwd: process.cwd() } as ExtensionToolContext
const tool = () => withPiShellTimeout(createBashToolDefinition(context.cwd, { exposeSessionEnvironment: false }))

afterEach(() => vi.useRealTimers())

it.skipIf(process.platform === 'win32')(
  'terminates a command that produced its result but left a child alive',
  async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const started = Promise.withResolvers<number>()
    const controller = new AbortController()
    const execution = tool().execute(
      'hanging-command',
      { command: 'sleep 600 & child=$!; echo "child:$child"; wait "$child"' },
      controller.signal,
      (result) => {
        for (const part of result.content) {
          if (part.type !== 'text') continue
          const pid = /child:(\d+)/.exec(part.text)?.[1]
          if (pid) started.resolve(Number(pid))
        }
      },
      context
    )
    const outcome = execution.catch((error: unknown) => error)
    try {
      const pid = await started.promise
      process.kill(pid, 0)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await outcome).toMatchObject({ message: expect.stringContaining('timed out after 120 seconds') })
      vi.useRealTimers()
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
    } finally {
      controller.abort()
      await outcome
    }
  }
)

it.skipIf(process.platform === 'win32')(
  'honors an explicit longer deadline and preserves successful output',
  async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ready = Promise.withResolvers<void>()
    const controller = new AbortController()
    const execution = tool().execute(
      'long-command',
      { command: 'echo ready; sleep 0.2; echo completed', timeout: 600 },
      controller.signal,
      (result) => {
        if (result.content.some((part) => part.type === 'text' && part.text.includes('ready'))) ready.resolve()
      },
      context
    )
    try {
      await ready.promise
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await execution).toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('completed') }] })
    } finally {
      controller.abort()
    }
  }
)

it.skipIf(process.platform === 'win32')('preserves native validation and explicit short timeouts', async () => {
  await expect(
    tool().execute('invalid', { command: 'echo invalid', timeout: 0 }, undefined, undefined, context)
  ).rejects.toThrow('Invalid timeout')
  await expect(
    tool().execute('short', { command: 'sleep 600', timeout: 0.05 }, undefined, undefined, context)
  ).rejects.toThrow('timed out after 0.05 seconds')
})

it.skipIf(process.platform === 'win32')(
  'aborts the real shell process tree promptly despite an explicit long timeout',
  async () => {
    const ready = Promise.withResolvers<number[]>()
    const controller = new AbortController()
    let output = ''
    const bounded = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Wait exceeded ${ms} ms`)), ms)
          })
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    const execution = tool().execute(
      'aborted-command',
      {
        // A failed run must not leave a long-lived child process behind.
        command: 'sleep 30 & child=$!; echo "shell:$$ child:$child"; wait "$child"; echo POST_WAIT_SENTINEL',
        timeout: 600
      },
      controller.signal,
      (result) => {
        for (const part of result.content) {
          if (part.type !== 'text') continue
          output += part.text
          const match = /shell:(\d+) child:(\d+)/.exec(part.text)
          if (match) {
            ready.resolve([Number(match[1]), Number(match[2])])
          }
        }
      },
      context
    )
    const outcome = execution.catch((error: unknown) => error)
    try {
      const runningPids = await bounded(ready.promise, 5000)
      // Signal 0 checks PID liveness, not whether the process still belongs to this test.
      for (const pid of runningPids) process.kill(pid, 0)
      const abortedAt = performance.now()
      controller.abort()
      await expect(bounded(execution, 5000)).rejects.toThrow('Command aborted')
      expect(performance.now() - abortedAt).toBeLessThan(3000)
      await vi.waitFor(
        () => {
          for (const pid of runningPids) {
            expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
          }
        },
        { timeout: 2000 }
      )
      expect(output).not.toContain('POST_WAIT_SENTINEL')
    } finally {
      controller.abort()
      await bounded(outcome, 2000)
    }
  },
  15_000
)
