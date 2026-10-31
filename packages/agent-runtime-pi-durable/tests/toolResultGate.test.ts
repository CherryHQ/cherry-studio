import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { Type } from '@earendil-works/pi-ai'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'

import { conversationId, lineageEntries } from '../src/behavior/history'
import { openDurableHarness } from './behaviorHarness'

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
            parameters: Type.Object({}),
            replay: 'safe',
            structuredOutputSchema: Type.Object({ complete: Type.Boolean() }),
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
            parameters: Type.Object({}),
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
