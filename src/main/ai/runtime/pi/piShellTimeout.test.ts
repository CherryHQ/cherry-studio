import { createBashToolDefinition, type ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { afterEach, expect, it, vi } from 'vitest'

import { withPiShellTimeout } from './piShellTimeout'

const context = { cwd: process.cwd() } as ExtensionToolContext
const tool = () => withPiShellTimeout(createBashToolDefinition(context.cwd, { exposeSessionEnvironment: false }))

afterEach(() => vi.useRealTimers())

it('terminates a command that produced its result but left a child alive', async () => {
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
})

it('honors an explicit longer deadline and preserves successful output', async () => {
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
})

it('preserves native validation and explicit short timeouts', async () => {
  await expect(
    tool().execute('invalid', { command: 'echo invalid', timeout: 0 }, undefined, undefined, context)
  ).rejects.toThrow('Invalid timeout')
  await expect(
    tool().execute('short', { command: 'sleep 600', timeout: 0.05 }, undefined, undefined, context)
  ).rejects.toThrow('timed out after 0.05 seconds')
})
