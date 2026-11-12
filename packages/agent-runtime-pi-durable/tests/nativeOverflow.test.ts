import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import { obj } from '@earendil-works/pi-schema'
import { expect, it } from 'vitest'

import { openDurableHarness } from './behaviorHarness'

it('recovers from a provider context overflow after a parallel tool batch', async () => {
  const h = await openDurableHarness(
    () => {},
    [
      defineExtension({
        name: 'pages',
        tools: [
          defineTool({
            name: 'page',
            description: 'Read a page',
            parameters: obj({}),
            replay: 'safe',
            execute: async () => ({ output: [{ type: 'text', text: 'page data '.repeat(200) }] })
          })
        ]
      })
    ],
    {
      settings: {
        retry: { enabled: false },
        compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 1000 }
      }
    }
  )
  const thread = await h.harness.createThread()
  h.harness.script(thread, [
    { text: 'Earlier answer' },
    { text: '', toolCalls: Array.from({ length: 20 }, () => ({ name: 'page', args: {} })) },
    {
      error:
        "400: This model's maximum context length is 1048576 tokens. Please reduce the length of the messages or completion."
    },
    { text: 'Earlier work and tool results' },
    { text: 'Recovered answer' }
  ])
  await h.harness.sendUser(thread, 'Earlier request')
  await h.harness.settle()
  await h.harness.sendUser(thread, 'Read all pages')
  await h.harness.settle()
  const facts = await h.harness.withCall(thread, (ports) => ports.ledger.read(thread))
  expect(h.errors).toEqual([])
  expect(facts.history.some((entry) => entry.kind === 'compaction')).toBe(true)
  expect(facts.history.some((entry) => entry.kind === 'assistant' && entry.text === 'Recovered answer')).toBe(true)
})
