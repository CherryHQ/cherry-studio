import { BACKGROUND_CONTEXT, withCancel } from '@earendil-works/chord/context'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { createBashTool } from '@earendil-works/pi-durable/tools'
import { afterEach, expect, it, vi } from 'vitest'

import { withDurableShellTimeout } from './durableShellTimeout'

const tool = () => withDurableShellTimeout(createBashTool())

function executionApi(onOutput: (text: string) => void) {
  const env = new NodeExecutionEnv({ cwd: process.cwd() })
  let output = ''
  const unused = (): never => {
    throw new Error('Unexpected shell API access')
  }
  const api: ToolExecutionApi = {
    get taskId() {
      return unused()
    },
    get conversationId() {
      return unused()
    },
    get callId() {
      return unused()
    },
    get registry() {
      return unused()
    },
    get models() {
      return unused()
    },
    agent: unused,
    now: Date.now,
    watchDoc: unused,
    snapshot: unused,
    snapshotAsOf: unused,
    details: unused,
    commit: unused,
    memo: unused,
    createTask: unused,
    getTask: unused,
    waitForTask: unused,
    conversation: unused,
    executeTool: unused,
    env,
    output: (chunk: string | Uint8Array) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
      output += text
      onOutput(text)
    },
    retainedOutput: () => ({ text: output, truncated: false }),
    diagnostic: () => {},
    outputWindow: undefined
  }
  return { api, env }
}

afterEach(() => vi.useRealTimers())

it.skipIf(process.platform === 'win32')(
  'times out an unfinished native command and reaps its child after output',
  async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const started = Promise.withResolvers<number>()
    const { context, cancel } = withCancel(BACKGROUND_CONTEXT)
    const { api, env } = executionApi((text) => {
      const pid = /child:(\d+)/.exec(text)?.[1]
      if (pid) started.resolve(Number(pid))
    })
    const execution = tool().execute(
      { command: 'sleep 600 & child=$!; echo "child:$child"; wait "$child"' },
      api,
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
      cancel()
      await outcome
      await env.cleanup(BACKGROUND_CONTEXT)
    }
  }
)

it.skipIf(process.platform === 'win32')(
  'honors longer explicit deadlines and returns successful native output',
  async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ready = Promise.withResolvers<void>()
    const { context, cancel } = withCancel(BACKGROUND_CONTEXT)
    const { api, env } = executionApi((text) => {
      if (text.includes('ready')) ready.resolve()
    })
    const execution = tool().execute({ command: 'echo ready; sleep 0.2; echo completed', timeout: 600 }, api, context)
    try {
      await ready.promise
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await execution).toMatchObject({
        structuredOutput: { exitCode: 0, output: expect.stringContaining('completed') }
      })
    } finally {
      cancel()
      await env.cleanup(BACKGROUND_CONTEXT)
    }
  }
)

it.skipIf(process.platform === 'win32')('retains native validation and explicit short deadlines', async () => {
  const { api, env } = executionApi(() => {})
  try {
    await expect(tool().execute({ command: 'echo invalid', timeout: 0 }, api, BACKGROUND_CONTEXT)).rejects.toThrow(
      'Invalid timeout'
    )
    await expect(tool().execute({ command: 'sleep 600', timeout: 0.05 }, api, BACKGROUND_CONTEXT)).rejects.toThrow(
      'timed out after 0.05 seconds'
    )
  } finally {
    await env.cleanup(BACKGROUND_CONTEXT)
  }
})
