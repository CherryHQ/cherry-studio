import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/databases', () => ({
  default: {
    tables: []
  }
}))

import { hashSnapshot, mergeSnapshots, stableStringify } from '../DataSyncService'

describe('DataSyncService', () => {
  it('stableStringify should sort object keys deterministically', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('hashSnapshot should be stable for the same semantic snapshot', () => {
    const snapshotA = {
      version: 1,
      generatedAt: 1,
      deviceId: 'device-a',
      localStorage: {
        'persist:cherry-studio': '{"settings":"{}"}'
      },
      indexedDB: {
        topics: [{ id: 'topic-1', updated_at: '2026-01-01T00:00:00.000Z', value: 'A' }]
      }
    }

    const snapshotB = {
      generatedAt: 1,
      version: 1,
      deviceId: 'device-a',
      indexedDB: {
        topics: [{ value: 'A', updated_at: '2026-01-01T00:00:00.000Z', id: 'topic-1' }]
      },
      localStorage: {
        'persist:cherry-studio': '{"settings":"{}"}'
      }
    }

    expect(hashSnapshot(snapshotA as any)).toBe(hashSnapshot(snapshotB as any))
  })

  it('mergeSnapshots should prefer the newer record per row when timestamps exist', () => {
    const local = {
      version: 1,
      generatedAt: 10,
      deviceId: 'device-a',
      localStorage: {
        'persist:cherry-studio': '{"settings":"local"}'
      },
      indexedDB: {
        topics: [
          { id: 'topic-1', updated_at: '2026-01-01T00:00:00.000Z', value: 'local' },
          { id: 'topic-2', updated_at: '2026-01-01T00:00:00.000Z', value: 'only-local' }
        ]
      }
    }

    const remote = {
      version: 1,
      generatedAt: 20,
      deviceId: 'device-b',
      localStorage: {
        'persist:cherry-studio': '{"settings":"remote"}'
      },
      indexedDB: {
        topics: [
          { id: 'topic-1', updated_at: '2026-01-02T00:00:00.000Z', value: 'remote' },
          { id: 'topic-3', updated_at: '2026-01-02T00:00:00.000Z', value: 'only-remote' }
        ]
      }
    }

    const merged = mergeSnapshots(local as any, remote as any)
    const topicMap = Object.fromEntries(merged.indexedDB.topics.map((topic) => [topic.id, topic.value]))

    expect(merged.localStorage['persist:cherry-studio']).toBe('{"settings":"remote"}')
    expect(topicMap['topic-1']).toBe('remote')
    expect(topicMap['topic-2']).toBe('only-local')
    expect(topicMap['topic-3']).toBe('only-remote')
  })
})
