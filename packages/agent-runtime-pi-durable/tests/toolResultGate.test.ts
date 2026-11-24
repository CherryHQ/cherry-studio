import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension, defineTool, ToolResultEntry } from '@earendil-works/pi-durable'
import { bool, obj } from '@earendil-works/pi-schema'
import { expect, it } from 'vitest'

import { conversationId, lineageEntries } from '../src/behavior/history'
import { openDurableHarness } from './behaviorHarness'

it.each([null, false, []])('keeps native invalid_arguments rejection for a gate rewrite of %j', async (args) => {
  let executions = 0
  const h = await openDurableHarness(
    (ports) => ports.toolGate.register({ before: async () => ({ args }), after: async (_call, result) => result }),
    [
      defineExtension({
        name: 'rewritten-input',
        tools: [
          defineTool({
            name: 'requires-object',
            description: 'Requires an object input',
            parameters: obj({ ok: bool() }),
            async execute() {
              executions++
              return { output: [{ type: 'text', text: 'executed' }] }
            }
          })
        ]
      })
    ]
  )
  const thread = await h.harness.createThread()
  h.harness.script(thread, [
    { text: '', toolCalls: [{ name: 'requires-object', args: { ok: true } }] },
    { text: 'done' }
  ])
  await h.harness.sendUser(thread, 'Use the tool')
  await h.harness.settle()
  const entries = await h.native().commit((tx) => lineageEntries(tx, conversationId(thread)), context)
  const result = entries.find((entry) => ToolResultEntry.is(entry))
  if (!result || !ToolResultEntry.is(result)) throw new Error('Native tool result is missing')
  expect(executions).toBe(0)
  expect(result.data.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'invalid_arguments' })])
})

it('preserves image positions, structured program output and UI details through text offload and reopen', async () => {
  const image = { type: 'image' as const, mimeType: 'image/png', data: 'aW1hZ2U=' }
  const h = await openDurableHarness(
    (ports) =>
      ports.toolGate.register({
        before: async () => ({}),
        after: async (_call, result) => ({ ...result, text: `stored:${result.text}` })
      }),
    [
      defineExtension({
        name: 'mixed',
        tools: [
          defineTool({
            name: 'mixed',
            description: 'Mixed output',
            parameters: obj({}),
            replay: 'safe',
            structuredOutputSchema: obj({ complete: bool() }),
            async execute() {
              return {
                output: [image, { type: 'text', text: 'first' }, image, { type: 'text', text: 'last' }],
                structuredOutput: { complete: true },
                details: { visible: true }
              }
            }
          }),
          defineTool({
            name: 'program',
            description: 'Program consumer',
            parameters: obj({}),
            replay: 'safe',
            async execute(_args, api, callContext) {
              const result = await api.executeTool('mixed', {}, callContext)
              return { output: [{ type: 'text', text: JSON.stringify(result.structuredOutput) }] }
            }
          })
        ]
      })
    ]
  )
  const thread = await h.harness.createThread()
  h.harness.script(thread, [
    {
      text: '',
      toolCalls: [
        { name: 'mixed', args: {} },
        { name: 'program', args: {} }
      ]
    },
    { text: 'done' }
  ])
  await h.harness.sendUser(thread, 'Run mixed')
  await h.harness.settle()
  async function verify() {
    const entries = await h.native().commit((tx) => lineageEntries(tx, conversationId(thread)), context)
    const result = entries.flatMap((entry) => entry.model ?? []).find((message) => message.role === 'toolResult')
    expect(result).toMatchObject({
      content: [image, { type: 'text', text: 'stored:first' }, image, { type: 'text', text: 'stored:last' }],
      details: { visible: true },
      isError: false
    })
    const program = entries
      .flatMap((entry) => entry.model ?? [])
      .find((message) => message.role === 'toolResult' && message.toolName === 'program')
    expect(program).toMatchObject({ content: [{ type: 'text', text: 'stored:{"complete":true}' }], isError: false })
  }
  await verify()
  await h.harness.restart()
  await verify()
  expect(h.errors).toEqual([])
})
