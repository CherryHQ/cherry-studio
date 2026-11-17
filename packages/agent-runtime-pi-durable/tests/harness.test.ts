import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { ToolResultEntry } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'

import { harnessContract } from '@cherrystudio/agent-behavior'

import { lineageEntries, pages } from '../src/behavior/history'
import { openDurableHarness } from './behaviorHarness'

const cases = [
  'a fork answers each call of its fork point with the placeholder result',
  'a message that starts a child run first answers the calls its last reply left open',
  'an explicit child fork answers open calls as interrupted, not as still running'
]

it.each(cases)('keeps repaired results readable by the native SDK when %s', async (name) => {
  const opened: Awaited<ReturnType<typeof openDurableHarness>>[] = []
  await harnessContract
    .find((test) => test.name === name)!
    .run(async (install) => {
      const h = await openDurableHarness(install)
      opened.push(h)
      return h.harness
    })
  for (const h of opened) {
    await h.harness.settle()
    async function verify() {
      const results = await h.native().commit(async (tx) => {
        const conversations = await pages((cursor) => tx.scanConversations({}, 256, cursor))
        const entries = (await Promise.all(conversations.map((conversation) => lineageEntries(tx, conversation.id))))
          .flat()
          .filter((entry) => entry.model?.some((message) => message.role === 'toolResult'))
        return Promise.all(entries.map((entry) => tx.entry(ToolResultEntry, entry.id)))
      }, context)
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result).toBeDefined()
        expect(Array.isArray(result?.data.diagnostics)).toBe(true)
      }
    }
    await verify()
    await h.harness.restart()
    await verify()
    expect(h.errors).toEqual([])
  }
})
