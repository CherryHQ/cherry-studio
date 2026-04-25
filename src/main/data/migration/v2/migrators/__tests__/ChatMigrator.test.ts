import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import { ChatMigrator } from '../ChatMigrator'
import type { NewMessage, NewTopic, OldBlock, OldMainTextBlock, OldMessage, OldTopic } from '../mappings/ChatMappings'

interface PreparedTopicData {
  topic: NewTopic
  messages: NewMessage[]
  pinned: boolean
}

/** Create a minimal OldMainTextBlock */
function block(id: string, messageId: string): OldMainTextBlock {
  return {
    id,
    messageId,
    type: 'main_text',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success',
    content: `Content of ${id}`
  }
}

/** Create a minimal OldMessage */
function msg(id: string, role: 'user' | 'assistant', blockIds: string[], extra: Partial<OldMessage> = {}): OldMessage {
  return {
    id,
    role,
    assistantId: 'ast-1',
    topicId: 't1',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success',
    blocks: blockIds,
    ...extra
  }
}

/** Create a minimal OldTopic */
function topic(id: string, messages: OldMessage[]): OldTopic {
  return {
    id,
    assistantId: 'ast-1',
    name: 'Test Topic',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    messages
  }
}

/** Set up ChatMigrator internal state and call prepareTopicData. */
function prepareTopic(oldTopic: OldTopic, blocks: OldBlock[]): PreparedTopicData | null {
  const migrator = new ChatMigrator()
  // Access private fields via index signature to avoid `as any`
  const m = migrator as unknown as Record<string, unknown>
  m['blockLookup'] = new Map(blocks.map((b) => [b.id, b]))
  m['assistantLookup'] = new Map()
  m['topicMetaLookup'] = new Map()
  m['topicAssistantLookup'] = new Map()
  m['skippedMessages'] = 0
  m['seenMessageIds'] = new Set()
  m['blockStats'] = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }

  const fn = m['prepareTopicData'] as (t: OldTopic) => PreparedTopicData | null
  return fn.call(migrator, oldTopic)
}

/** Build a Map<id, message> from result messages for easy lookup */
function toMsgMap(messages: NewMessage[]): Map<string, NewMessage> {
  return new Map(messages.map((m) => [m.id, m]))
}

/** Assert no migrated message has a dangling parentId */
function assertNoDanglingParentIds(messages: NewMessage[]): void {
  const migratedIds = new Set(messages.map((m) => m.id))
  for (const m of messages) {
    if (m.parentId) {
      expect(migratedIds.has(m.parentId), `message ${m.id} has dangling parentId ${m.parentId}`).toBe(true)
    }
  }
}

describe('ChatMigrator.prepareTopicData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('produces valid parentId chain for simple sequential messages', () => {
    const b1 = block('b1', 'u1')
    const b2 = block('b2', 'a1')
    const messages = [msg('u1', 'user', ['b1']), msg('a1', 'assistant', ['b2'])]

    const result = prepareTopic(topic('t1', messages), [b1, b2])

    expect(result).not.toBeNull()
    const msgMap = toMsgMap(result?.messages ?? [])
    expect(msgMap.get('u1')?.parentId).toBeNull()
    expect(msgMap.get('a1')?.parentId).toBe('u1')
  })

  it('resolves parentId through first-pass skipped messages (no blocks)', () => {
    // u1 → a1 (no blocks, skipped) → u2
    // u2's parentId should resolve through a1 to u1
    const b1 = block('b1', 'u1')
    const b3 = block('b3', 'u2')
    const messages = [
      msg('u1', 'user', ['b1']),
      msg('a1', 'assistant', []), // no blocks → skipped in first pass
      msg('u2', 'user', ['b3'])
    ]

    const result = prepareTopic(topic('t1', messages), [b1, b3])

    expect(result).not.toBeNull()
    const msgMap = toMsgMap(result?.messages ?? [])
    // a1 should be skipped
    expect(msgMap.has('a1')).toBe(false)
    // u2's parentId should resolve through skipped a1 to u1
    expect(msgMap.get('u2')?.parentId).toBe('u1')
  })

  it('resolves parentId through second-pass skipped messages (transform failure)', () => {
    // u1 → a1 (has block IDs but blocks not in lookup → 0 resolved blocks → skipped) → u2
    const b1 = block('b1', 'u1')
    const b3 = block('b3', 'u2')
    const messages = [
      msg('u1', 'user', ['b1']),
      msg('a1', 'assistant', ['missing-block']), // block ID exists but not in lookup → 0 resolved blocks → skipped
      msg('u2', 'user', ['b3'])
    ]

    const result = prepareTopic(topic('t1', messages), [b1, b3])

    expect(result).not.toBeNull()
    const msgMap = toMsgMap(result?.messages ?? [])
    expect(msgMap.has('a1')).toBe(false)
    // u2's parentId should resolve to u1
    expect(msgMap.get('u2')?.parentId).toBe('u1')
  })

  it('handles askId pointing to deleted user message (preserves sibling relationship)', () => {
    // deleted-user-msg was the user message, a1 and a2 have askId pointing to it
    const b0 = block('b0', 'prev')
    const b1 = block('b1', 'a1')
    const b2 = block('b2', 'a2')
    const messages = [
      msg('prev', 'assistant', ['b0']),
      msg('a1', 'assistant', ['b1'], { askId: 'deleted-user-msg' }),
      msg('a2', 'assistant', ['b2'], { askId: 'deleted-user-msg' })
    ]

    const result = prepareTopic(topic('t1', messages), [b0, b1, b2])

    expect(result).not.toBeNull()
    const msgMap = toMsgMap(result?.messages ?? [])
    // Both orphaned siblings share 'prev' as common parent
    expect(msgMap.get('a1')?.parentId).toBe('prev')
    expect(msgMap.get('a2')?.parentId).toBe('prev')
  })

  it('produces no dangling parentId across mixed edge cases', () => {
    // Mix of all edge cases: deleted askId target, missing blocks, valid messages
    const b1 = block('b1', 'u1')
    const b3 = block('b3', 'a2')
    const b4 = block('b4', 'u2')
    const messages = [
      msg('u1', 'user', ['b1']),
      msg('a1', 'assistant', [], { askId: 'u1' }), // no blocks → skipped
      msg('a2', 'assistant', ['b3'], { askId: 'u1' }), // only one with askId survives → not a group
      msg('u2', 'user', ['b4'])
    ]

    const result = prepareTopic(topic('t1', messages), [b1, b3, b4])

    expect(result).not.toBeNull()
    assertNoDanglingParentIds(result?.messages ?? [])
  })

  it('all parentIds reference migrated messages (comprehensive invariant)', () => {
    // Complex scenario with multiple skip reasons
    const b1 = block('b1', 'u1')
    const b2 = block('b2', 'a1')
    const b4 = block('b4', 'a3')
    const b5 = block('b5', 'u2')
    const b6 = block('b6', 'a4')
    const messages = [
      msg('u1', 'user', ['b1']),
      msg('a1', 'assistant', ['b2'], { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', ['missing-block'], { askId: 'u1' }), // unresolved block → skipped
      msg('a3', 'assistant', ['b4'], { askId: 'deleted-msg' }), // askId target missing
      msg('u2', 'user', ['b5']),
      msg('a4', 'assistant', ['b6'])
    ]

    const result = prepareTopic(topic('t1', messages), [b1, b2, b4, b5, b6])

    expect(result).not.toBeNull()
    assertNoDanglingParentIds(result?.messages ?? [])
  })

  it('resolves multi-hop ancestor chain when consecutive messages are skipped', () => {
    // u1 → a1 (no blocks, skipped) → u2 (no blocks, skipped) → a2 (has blocks)
    // a2's parentId should resolve through u2 → a1 → u1
    const b1 = block('b1', 'u1')
    const b4 = block('b4', 'a2')
    const messages = [
      msg('u1', 'user', ['b1']),
      msg('a1', 'assistant', []), // skipped: no blocks
      msg('u2', 'user', []), // skipped: no blocks
      msg('a2', 'assistant', ['b4'])
    ]

    const result = prepareTopic(topic('t1', messages), [b1, b4])

    expect(result).not.toBeNull()
    const msgMap = toMsgMap(result?.messages ?? [])
    expect(msgMap.has('a1')).toBe(false)
    expect(msgMap.has('u2')).toBe(false)
    // a2 should resolve through the chain to u1
    expect(msgMap.get('a2')?.parentId).toBe('u1')
  })
})

describe('ChatMigrator pin migration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('captures pinned flag from Redux topic metadata onto PreparedTopicData', () => {
    // Dexie topic row has no `pinned` column; the v1 source stores pin state
    // on the Redux side under assistant.topics[].pinned. The migrator must
    // merge that flag into PreparedTopicData so insertStagedTopics can later
    // emit a `pin` row — without this flag the legacy pinned topic silently
    // becomes unpinned post-migration.
    const b1 = block('b1', 'u1')
    const messages = [msg('u1', 'user', ['b1'])]
    const oldTopic = topic('t1', messages)

    const migrator = new ChatMigrator()
    const m = migrator as unknown as Record<string, unknown>
    m['blockLookup'] = new Map([['b1', b1]])
    m['assistantLookup'] = new Map()
    // Redux meta says it's pinned even though Dexie source doesn't carry the flag.
    m['topicMetaLookup'] = new Map([['t1', { pinned: true }]])
    m['topicAssistantLookup'] = new Map()
    m['skippedMessages'] = 0
    m['blockStats'] = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }

    const fn = m['prepareTopicData'] as (t: OldTopic) => PreparedTopicData | null
    const result = fn.call(migrator, oldTopic)

    expect(result).not.toBeNull()
    expect(result?.pinned).toBe(true)
  })

  it('defaults pinned to false when source has no pinned flag', () => {
    const b1 = block('b1', 'u1')
    const result = prepareTopic(topic('t1', [msg('u1', 'user', ['b1'])]), [b1])
    expect(result).not.toBeNull()
    expect(result?.pinned).toBe(false)
  })

  it('lets Redux pinned=false override Dexie pinned=true (Redux is authoritative)', () => {
    // The merge order is `topicMeta.pinned ?? oldTopic.pinned`, so an explicit
    // false in Redux wins over a stale true on the Dexie side.
    const b1 = block('b1', 'u1')
    const oldTopic: OldTopic = {
      id: 't1',
      assistantId: 'ast-1',
      name: 'X',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      messages: [msg('u1', 'user', ['b1'])],
      pinned: true
    }

    const migrator = new ChatMigrator()
    const m = migrator as unknown as Record<string, unknown>
    m['blockLookup'] = new Map([['b1', b1]])
    m['assistantLookup'] = new Map()
    m['topicMetaLookup'] = new Map([['t1', { pinned: false }]])
    m['topicAssistantLookup'] = new Map()
    m['skippedMessages'] = 0
    m['blockStats'] = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }

    const fn = m['prepareTopicData'] as (t: OldTopic) => PreparedTopicData | null
    const result = fn.call(migrator, oldTopic)
    expect(result?.pinned).toBe(false)
  })
})

describe('ChatMigrator model reference sanitization', () => {
  it('nulls out dangling migrated message model ids', () => {
    const migrator = new ChatMigrator() as unknown as Record<string, unknown>
    migrator['validModelIds'] = new Set(['openai::gpt-4'])

    const messages: NewMessage[] = [
      {
        id: 'm1',
        parentId: null,
        topicId: 't1',
        role: 'assistant',
        data: { blocks: [] },
        searchableText: null,
        status: 'success',
        siblingsGroupId: 0,
        modelId: 'cherryai::qwen',
        modelSnapshot: null,
        traceId: null,
        stats: null,
        createdAt: 1,
        updatedAt: 1
      }
    ]

    const dropped = (migrator['sanitizeMessageModelReferences'] as (messages: NewMessage[]) => number).call(
      migrator,
      messages
    )

    expect(dropped).toBe(1)
    expect(messages[0].modelId).toBeNull()
  })
})
