import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

import { setupTestDatabase } from '@test-helpers/db'
import { afterAll, expect, it } from 'vitest'

import { runtimeId, type RuntimeMessage } from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { PiMessageMetadata } from '@main/ai/runtime/pi/PiMessageMetadata'

import { RootMessageProjection } from '../RootMessageProjection'
import { ThreadProjection } from '../ThreadProjection'

const dbh = setupTestDatabase()
const reports: object[] = []
afterAll(() => {
  if (process.env.PROJECTION_COST_REPORT)
    writeFileSync(process.env.PROJECTION_COST_REPORT, JSON.stringify(reports, null, 2))
})

// Fixed replay separates projection work from model/network speed; timings are evidence, not CI thresholds.
it.each([
  [20, 1],
  [1000, 1],
  [20, 10],
  [1000, 10]
])(
  'retains output with %i history messages on %i independent threads',
  async (historySize, threadCount) => {
    const workspaceId = randomUUID()
    const sessionId = randomUUID()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Cost', type: 'user', path: '/test', orderKey: 'a0' })
      .run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Cost', orderKey: 'a0' }).run()
    const context = contexts.preparePiBranch(sessionId)
    const history = Array.from(
      { length: historySize },
      (_, index) =>
        ({
          id: `history-${index}`,
          role: 'assistant',
          metadata: { completeness: 'complete' },
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'mcp__test__read',
              toolCallId: `tool-${index}`,
              state: 'output-available',
              input: {},
              output: { content: [{ type: 'text', text: JSON.stringify({ text: 'x'.repeat(1024) }) }] }
            }
          ]
        }) satisfies RuntimeMessage
    )
    let decorated = 0
    let forwarded = 0
    const projections = Array.from({ length: threadCount }, (_, index) => {
      const root = new RootMessageProjection(context.id)
      const metadata = new PiMessageMetadata()
      const view = new ThreadProjection(
        { backendId: runtimeId('pi'), id: runtimeId(`thread-${index}`) },
        context.id,
        (update) => {
          forwarded += update.messages.length
          root.accept(update, 'reply')
        },
        (message) => {
          decorated++
          return metadata.decorate(message)
        }
      )
      return { root, view }
    })
    try {
      for (const { root, view } of projections) {
        for (const message of history)
          root.accept(
            {
              contextId: context.id,
              messages: [{ ...message, metadata: undefined }],
              live: [message.id],
              removed: [],
              replaces: {}
            },
            message.id
          )
        await view.accept({
          type: 'snapshot',
          coverage: 'current-view',
          messages: history,
          inputs: [],
          activity: { scope: 'foreground', state: 'active' }
        })
      }
      decorated = 0
      forwarded = 0
      const timings: number[] = []
      const cpu = process.cpuUsage()
      const start = performance.now()
      for (let step = 1; step <= 40; step++) {
        for (const { view } of projections) {
          const before = performance.now()
          await view.accept({
            type: 'message.upsert',
            message: {
              id: 'live',
              role: 'assistant',
              metadata: { completeness: 'partial' },
              parts: [{ type: 'text', text: 'delta '.repeat(step), state: 'streaming' }]
            }
          })
          timings.push(performance.now() - before)
        }
      }
      const elapsedMs = performance.now() - start
      const usage = process.cpuUsage(cpu)
      timings.sort((a, b) => a - b)
      expect(forwarded, 'A live update must not forward unrelated history').toBe(timings.length)
      expect(decorated, 'A live update must not redecorate unrelated history').toBe(timings.length)
      reports.push({
        historySize,
        threadCount,
        events: timings.length,
        decorated,
        forwarded,
        elapsedMs,
        cpuMs: (usage.user + usage.system) / 1000,
        p50Ms: timings[Math.floor(timings.length / 2)],
        p95Ms: timings[Math.floor(timings.length * 0.95)]
      })
      for (const { root } of projections) {
        expect(root.parts('reply')).toEqual([{ type: 'text', text: 'delta '.repeat(40), state: 'streaming' }])
        expect(root.parts('history-0')).toEqual(history[0].parts)
      }
    } finally {
      await Promise.all(projections.map(({ view }) => view.close()))
    }
  },
  30000
)
