import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import { bool, obj } from '@earendil-works/pi-schema'
import { expect, it } from 'vitest'

import { createScriptedHost } from '@cherrystudio/agent-behavior'

import { conversationId, pages } from '../src/behavior/history'
import { openDurableHarness } from './behaviorHarness'

it('preserves image positions, structured program output and UI details through text offload and reopen', async () => {
  const image = { type: 'image' as const, mimeType: 'image/png', data: 'aW1hZ2U=' }
  const first = 'first '.repeat(900)
  const last = 'last '.repeat(1000)
  const host = createScriptedHost({
    settings: {
      goalDefaults: { maxGoalRounds: 5, maxGoalRoundsCeiling: 10, blockedAfter: 2 },
      autonomy: 'auto',
      permissionMode: 'bypassPermissions',
      attendance: 'stream',
      maxBackground: 2,
      offloadThreshold: 4000
    }
  })
  const h = await openDurableHarness(host, [
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
              output: [image, { type: 'text', text: first }, image, { type: 'text', text: last }],
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
  ])
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
    const entries = await h
      .native()
      .commit(
        (tx) =>
          pages((cursor) =>
            tx.scanEntries({ conversationId: conversationId(thread), order: 'ascending' }, 256, cursor)
          ),
        context
      )
    const result = entries.flatMap((entry) => entry.model ?? []).find((message) => message.role === 'toolResult')
    expect(host.saved.map((file) => file.content)).toEqual([first, last])
    expect(result).toMatchObject({
      content: [
        image,
        { type: 'text', text: expect.stringContaining(`outputs/${host.saved[0].name}`) },
        image,
        { type: 'text', text: expect.stringContaining(`outputs/${host.saved[1].name}`) }
      ],
      details: { visible: true },
      isError: false
    })
    const program = entries
      .flatMap((entry) => entry.model ?? [])
      .find((message) => message.role === 'toolResult' && message.toolName === 'program')
    expect(program).toMatchObject({ content: [{ type: 'text', text: '{"complete":true}' }], isError: false })
  }
  await verify()
  await h.harness.restart()
  await verify()
  expect(h.errors).toEqual([])
})
