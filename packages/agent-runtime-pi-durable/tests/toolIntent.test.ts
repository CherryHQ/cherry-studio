import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import { obj, str } from '@earendil-works/pi-schema'
import { expect, it } from 'vitest'

import { conversationId, lineageEntries } from '../src/behavior/history'
import { openDurableHarness } from './behaviorHarness'

async function callWithIntent(modelId?: string) {
  const executed: unknown[] = []
  const gated: unknown[] = []
  const h = await openDurableHarness(
    (ports) =>
      ports.toolGate.register({
        before: async (call) => {
          gated.push(call.args)
          return {}
        },
        after: async () => undefined
      }),
    [
      defineExtension({
        name: 'strict',
        tools: [
          defineTool({
            name: 'strict',
            description: 'Rejects unknown arguments',
            parameters: obj({ path: str() }),
            replay: 'safe',
            async execute(args) {
              executed.push(args)
              return { output: [{ type: 'text', text: 'done' }] }
            }
          })
        ]
      })
    ],
    { modelId }
  )
  const thread = await h.harness.createThread()
  h.harness.script(thread, [
    { text: '', toolCalls: [{ name: 'strict', args: { path: 'a.ts', intent: 'find where the key is loaded' } }] },
    { text: 'done' }
  ])
  await h.harness.sendUser(thread, 'Look')
  await h.harness.settle()

  const messages = (await h.native().commit((tx) => lineageEntries(tx, conversationId(thread)), context)).flatMap(
    (entry) => entry.model ?? []
  )
  const declared = messages.flatMap((message) => (message.role === 'system' ? (message.toolsAdded ?? []) : []))
  return {
    declared: declared.find((tool) => tool.name === 'strict')?.parameters,
    system: JSON.stringify(messages.filter((message) => message.role === 'system')),
    call: messages
      .flatMap((message) => (message.role === 'assistant' ? message.content : []))
      .find((part) => part.type === 'toolCall'),
    result: messages.find((message) => message.role === 'toolResult'),
    executed,
    gated,
    errors: h.errors
  }
}

it('offers a DeepSeek agent’s tools an intent and runs, gates and validates the call without it', async () => {
  const run = await callWithIntent('deepseek-v4.1-flash')

  expect(run.declared).toMatchObject({ properties: { path: { type: 'string' }, intent: { type: 'string' } } })
  expect(run.system).toContain('`intent`')
  expect(run.executed).toEqual([{ path: 'a.ts' }])
  expect(run.gated).toEqual([{ path: 'a.ts' }])
  expect(run.call).toMatchObject({ arguments: { path: 'a.ts', intent: 'find where the key is loaded' } })
  expect(run.result).toMatchObject({ isError: false })
  expect(run.errors).toEqual([])
})

it('offers other agents no intent, yet still runs a call that carries one', async () => {
  const run = await callWithIntent()

  expect(run.declared).not.toHaveProperty('properties.intent')
  expect(run.system).not.toContain('`intent`')
  expect(run.executed).toEqual([{ path: 'a.ts' }])
  expect(run.result).toMatchObject({ isError: false })
  expect(run.errors).toEqual([])
})
