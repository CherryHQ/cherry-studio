import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { bench, describe } from 'vitest'

import { reconcileSessionListItems } from './sessionListItemSharing'

function createSessions(count: number, renamedId?: string): AgentSessionEntity[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `benchmark-session-${index}`
    return {
      id,
      agentId: 'benchmark-agent',
      modelId: null,
      name: id === renamedId ? `Renamed ${id}` : `Session ${index}`,
      isNameManuallyEdited: id === renamedId,
      description: '',
      workspaceId: 'benchmark-workspace',
      workspace: {
        id: 'benchmark-workspace',
        name: 'Benchmark Workspace',
        path: '/tmp/cherry-studio-session-list-benchmark',
        type: 'user',
        orderKey: 'a',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      orderKey: String(index).padStart(5, '0'),
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  })
}

function countReusedItems(previous: readonly unknown[], next: readonly unknown[]): number {
  let reused = 0
  for (let index = 0; index < next.length; index++) {
    if (next[index] === previous[index]) reused++
  }
  return reused
}

function createScenario(count: number) {
  const initialSessions = createSessions(count)
  const initial = reconcileSessionListItems(initialSessions, new Map())
  const equalRefreshSessions = createSessions(count)
  const renamedId = `benchmark-session-${Math.floor(count / 2)}`
  const renamedSessions = createSessions(count, renamedId)
  const pinned = new Map([[renamedId, `benchmark-pin-${renamedId}`]])

  const equalRefresh = reconcileSessionListItems(equalRefreshSessions, new Map(), initial)
  const pinUpdate = reconcileSessionListItems(equalRefreshSessions, pinned, initial)
  const nameUpdate = reconcileSessionListItems(renamedSessions, new Map(), initial)

  const equalReused = countReusedItems(initial.items, equalRefresh.items)
  const pinReused = countReusedItems(initial.items, pinUpdate.items)
  const nameReused = countReusedItems(initial.items, nameUpdate.items)
  if (equalReused !== count || pinReused !== count - 1 || nameReused !== count - 1) {
    throw new Error('Session list benchmark scenario does not preserve the expected memo-row inputs')
  }

  return { equalRefreshSessions, initial, pinned, renamedSessions }
}

let benchmarkSink: readonly unknown[] = []

for (const count of [200, 1000]) {
  describe(`${count} session list items`, () => {
    const scenario = createScenario(count)

    bench(`equal refresh (${count}/${count} item refs reused; 0 memo-row invalidations)`, () => {
      benchmarkSink = reconcileSessionListItems(scenario.equalRefreshSessions, new Map(), scenario.initial).items
    })

    bench(`pin update (${count - 1}/${count} item refs reused; 1 memo-row invalidation)`, () => {
      benchmarkSink = reconcileSessionListItems(scenario.equalRefreshSessions, scenario.pinned, scenario.initial).items
    })

    bench(`name update (${count - 1}/${count} item refs reused; 1 memo-row invalidation)`, () => {
      benchmarkSink = reconcileSessionListItems(scenario.renamedSessions, new Map(), scenario.initial).items
    })
  })
}

void benchmarkSink
