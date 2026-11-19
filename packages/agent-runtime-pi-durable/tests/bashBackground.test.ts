import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { createBashTool, createPowerShellTool, type BackgroundBashExec } from '@earendil-works/pi-durable/tools'
import { obj } from '@earendil-works/pi-schema'
import { expect, it } from 'vitest'

import { conversationId, lineageEntries } from '../src/behavior/history'
import { openDurableHarness } from './behaviorHarness'

it('keeps background capability out of ordinary Bash and PowerShell schemas', () => {
  expect(createBashTool().parameters).not.toHaveProperty('properties.run_in_background')
  expect(createPowerShellTool().parameters).not.toHaveProperty('properties.run_in_background')
})

it('stores one typed running result through the native Harness and reopens without executing it again', async () => {
  const calls: Parameters<BackgroundBashExec>[1][] = []
  const environment = new NodeExecutionEnv({ cwd: process.cwd() })
  const bash = createBashTool({
    commandPrefix: 'prefix',
    prepare: (execution) => {
      execution.env.SHELL_TEST = 'prepared'
    },
    background: async (command, options, callContext) => {
      expect(command).toBe('prefix\ncommand')
      expect(options).toMatchObject({
        cwd: process.cwd(),
        env: { SHELL_TEST: 'prepared' },
        timeout: 45,
        runInBackground: true
      })
      calls.push(options)
      options.onOutput?.('still running', callContext, { stream: 'stdout' })
      return { ok: true, value: { status: 'running', executionId: 'execution-1', outputCursor: 13 } }
    }
  })
  const inspect = defineTool({
    name: 'inspect',
    description: 'Inspect the programmatic Bash result',
    parameters: obj({}),
    async execute(_args, api, callContext) {
      const result = await api.executeTool(
        'bash',
        { command: 'command', timeout: 45, run_in_background: true },
        callContext
      )
      return { output: [{ type: 'text', text: JSON.stringify(result.structuredOutput) }] }
    }
  })
  const h = await openDurableHarness(() => {}, [defineExtension({ name: 'shell', tools: [bash, inspect] })], {
    env: () => environment
  })
  const thread = await h.harness.createThread()
  h.harness.script(thread, [{ text: '', toolCalls: [{ name: 'inspect', args: {} }] }, { text: 'Started' }])
  await h.harness.sendUser(thread, 'Start the command')
  await h.harness.settle()
  const results = () =>
    h
      .native()
      .commit(
        async (tx) =>
          (await lineageEntries(tx, conversationId(thread)))
            .flatMap((entry) => entry.model ?? [])
            .filter((entry) => entry.role === 'toolResult'),
        context
      )
  const before = await results()
  expect(before).toHaveLength(1)
  expect(before[0]).toMatchObject({
    isError: false,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: 'running',
          executionId: 'execution-1',
          outputCursor: 13,
          output: 'still running',
          truncated: false
        })
      }
    ]
  })
  expect(calls).toHaveLength(1)
  expect(calls[0].callId).toBeTruthy()
  expect(calls[0].taskId).toBeTruthy()
  calls[0].onOutput?.('late output', context, { stream: 'stdout' })
  expect(await results()).toEqual(before)
  await h.harness.restart()
  expect(await results()).toEqual(before)
  expect(calls).toHaveLength(1)
  expect(h.errors).toEqual([])
})

it('preserves foreground output and nonzero failures with the background backend enabled', async () => {
  const bash = createBashTool({
    background: async (_command, options, callContext) => {
      expect(options.runInBackground).toBe(false)
      options.onOutput?.('native failure', callContext, { stream: 'stderr' })
      return { ok: true, value: { exitCode: 7 } }
    }
  })
  const h = await openDurableHarness(() => {}, [defineExtension({ name: 'shell', tools: [bash] })], {
    env: () => new NodeExecutionEnv({ cwd: process.cwd() })
  })
  const thread = await h.harness.createThread()
  h.harness.script(thread, [
    { text: '', toolCalls: [{ name: 'bash', args: { command: 'command' } }] },
    { text: 'Failed' }
  ])
  await h.harness.sendUser(thread, 'Run the command')
  await h.harness.settle()
  const results = await h
    .native()
    .commit(
      async (tx) =>
        (await lineageEntries(tx, conversationId(thread)))
          .flatMap((entry) => entry.model ?? [])
          .filter((entry) => entry.role === 'toolResult'),
      context
    )
  expect(results).toHaveLength(1)
  expect(results[0]).toMatchObject({ isError: true })
  expect(JSON.stringify(results[0])).toContain('native failure')
  expect(JSON.stringify(results[0])).toContain('Command exited with code 7')
  expect(h.errors).toEqual([])
})
