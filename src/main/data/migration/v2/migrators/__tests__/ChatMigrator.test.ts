import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => mockLogger)
  }
}))

import { ChatMigrator } from '../ChatMigrator'
import type { NewMessage, NewTopic, OldBlock, OldMainTextBlock, OldMessage, OldTopic } from '../mappings/ChatMappings'

interface PreparedTopicData {
  topic: NewTopic
  messages: NewMessage[]
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

  it('derives missing topic timestamps from messages instead of Date.now()', () => {
    // Topic with no createdAt/updatedAt — should derive from messages, NOT
    // fall back to Date.now() (which floods the topic list with migration-time
    // entries). createdAt = min(message.createdAt), updatedAt = max.
    const b1 = block('b1', 'u1')
    const b2 = block('b2', 'a1')
    const oldTopic: OldTopic = {
      id: 't1',
      assistantId: 'ast-1',
      name: 'No Timestamps',
      createdAt: '', // missing
      updatedAt: '', // missing
      messages: [
        msg('u1', 'user', ['b1'], { createdAt: '2025-03-15T10:00:00.000Z' }),
        msg('a1', 'assistant', ['b2'], { createdAt: '2025-03-15T10:05:00.000Z' })
      ]
    }

    const result = prepareTopic(oldTopic, [b1, b2])
    expect(result).not.toBeNull()
    expect(result?.topic.createdAt).toBe(new Date('2025-03-15T10:00:00.000Z').getTime())
    expect(result?.topic.updatedAt).toBe(new Date('2025-03-15T10:05:00.000Z').getTime())
  })

  it('accepts numeric epoch-ms timestamps when deriving from messages', () => {
    // Older v1 versions stored message.createdAt as a number, not an ISO
    // string. Date.parse(number) returns NaN, so without the typeof number
    // branch these would be silently filtered and the topic would fall
    // through to Date.now().
    const b1 = block('b1', 'u1')
    const numericTs = new Date('2025-03-15T10:00:00.000Z').getTime()
    const oldTopic: OldTopic = {
      id: 't-numeric-ts',
      assistantId: 'ast-1',
      name: 'Numeric Timestamps',
      createdAt: '',
      updatedAt: '',
      // @ts-expect-error - exercising legacy numeric timestamp path
      messages: [msg('u1', 'user', ['b1'], { createdAt: numericTs })]
    }
    const result = prepareTopic(oldTopic, [b1])
    expect(result).not.toBeNull()
    expect(result?.topic.createdAt).toBe(numericTs)
    expect(result?.topic.updatedAt).toBe(numericTs)
  })

  it('falls through to parseTimestamp when no message has a parseable createdAt', () => {
    // Edge case: topic has messages but none carry a parseable createdAt.
    // messageMillis is empty, so we cannot derive timestamps; downstream
    // parseTimestamp() will fall back to Date.now(). The path is logged as
    // a warning so it's diagnosable in real-user data dumps. We still
    // produce a valid topic row (we can't drop it — the messages exist).
    const b1 = block('b1', 'u1')
    const oldTopic: OldTopic = {
      id: 't-no-derivable-ts',
      assistantId: 'ast-1',
      name: 'No Derivable TS',
      createdAt: '',
      updatedAt: '',
      messages: [msg('u1', 'user', ['b1'], { createdAt: 'not-a-date' })]
    }
    const before = Date.now()
    const result = prepareTopic(oldTopic, [b1])
    const after = Date.now()
    expect(result).not.toBeNull()
    // Both timestamps fell through to Date.now() bracketed by the test window
    expect(result?.topic.createdAt).toBeGreaterThanOrEqual(before)
    expect(result?.topic.createdAt).toBeLessThanOrEqual(after)
    expect(result?.topic.updatedAt).toBeGreaterThanOrEqual(before)
    expect(result?.topic.updatedAt).toBeLessThanOrEqual(after)
  })

  it('skips topics with no messages (empty conversations are noise)', () => {
    // v1 created an empty topic on first launch and on every abandoned "new
    // topic" click — migrating those just clutters the post-migration list.
    // They also lack a usable timestamp source (no messages to derive from),
    // so they would otherwise stack up at the migration moment.
    const oldTopic: OldTopic = {
      id: 't-empty',
      assistantId: 'ast-1',
      name: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      messages: []
    }
    expect(prepareTopic(oldTopic, [])).toBeNull()
  })

  it('keeps empty topic when user pinned it (user-intent signal)', () => {
    // A pinned empty topic is "user touched this" — the user explicitly
    // pinned a placeholder. Dropping it would lose intentional state.
    const oldTopic: OldTopic = {
      id: 't-pinned-empty',
      assistantId: 'ast-1',
      name: 'Pinned Empty',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      messages: [],
      pinned: true
    }
    const result = prepareTopic(oldTopic, [])
    expect(result).not.toBeNull()
    expect(result?.topic.isPinned).toBe(true)
  })

  it('keeps empty topic when user manually renamed it', () => {
    // isNameManuallyEdited is set by the rename UI — also a clear
    // user-intent signal that should survive the empty-topic skip.
    const oldTopic: OldTopic = {
      id: 't-renamed-empty',
      assistantId: 'ast-1',
      name: 'My Renamed Topic',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      messages: [],
      isNameManuallyEdited: true
    }
    expect(prepareTopic(oldTopic, [])).not.toBeNull()
  })

  it('keeps empty topic when user wrote a topic-level prompt', () => {
    // A user-written topic prompt before the first message is a clear
    // intent signal — losing it would discard the system prompt the user typed.
    const oldTopic: OldTopic = {
      id: 't-prompt-empty',
      assistantId: 'ast-1',
      name: 'Prompt Empty',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      messages: [],
      prompt: 'You are a haiku coach.'
    }
    expect(prepareTopic(oldTopic, [])).not.toBeNull()
  })

  it('still drops empty topic when prompt is whitespace only', () => {
    // Whitespace prompt is not a real user signal — auto-init or stray edit.
    const oldTopic: OldTopic = {
      id: 't-blank-prompt-empty',
      assistantId: 'ast-1',
      name: 'Blank Prompt',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      messages: [],
      prompt: '   '
    }
    expect(prepareTopic(oldTopic, [])).toBeNull()
  })

  it('falls back to DEFAULT_ASSISTANT_ID when topic.assistantId is empty', () => {
    // Without this fallback, a topic with no assistantId becomes
    // `assistantId: null`, and the renderer's `useAssistant('')` then
    // dispatches `PATCH /assistants/` (empty id) on every reasoning-effort
    // sync — server 400s, SWR retries, infinite loop.
    const b1 = block('b1', 'u1')
    const oldTopic: OldTopic = {
      id: 't1',
      assistantId: '', // empty
      name: 'Orphan Topic',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      messages: [msg('u1', 'user', ['b1'])]
    }

    const result = prepareTopic(oldTopic, [b1])
    expect(result).not.toBeNull()
    expect(result?.topic.assistantId).toBe('default')
  })

  it('falls back to DEFAULT_ASSISTANT_ID when topic.assistantId points to missing FK', () => {
    // validAssistantIds set up to *not* include 'orphaned-id', so the FK check
    // fires and falls the topic back onto DEFAULT_ASSISTANT_ID instead of
    // leaving it dangling.
    const oldTopic: OldTopic = {
      id: 't1',
      assistantId: 'orphaned-id',
      name: 'Bad FK Topic',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      messages: [msg('u1', 'user', ['b1'])]
    }

    const migrator = new ChatMigrator()
    const m = migrator as unknown as Record<string, unknown>
    m['blockLookup'] = new Map([['b1', block('b1', 'u1')]])
    m['assistantLookup'] = new Map()
    m['topicMetaLookup'] = new Map()
    m['topicAssistantLookup'] = new Map()
    m['skippedMessages'] = 0
    m['orphanedAssistantTopics'] = 0
    m['seenMessageIds'] = new Set()
    m['blockStats'] = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }
    // FK validation set: only 'default' valid, orphan must fall back
    m['validAssistantIds'] = new Set(['default'])

    const fn = m['prepareTopicData'] as (t: OldTopic) => PreparedTopicData | null
    const result = fn.call(migrator, oldTopic)
    expect(result?.topic.assistantId).toBe('default')
  })
})

describe('ChatMigrator.prepare with state.defaultAssistant.topics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts topic metadata from state.defaultAssistant.topics[]', async () => {
    // Topics under state.defaultAssistant.topics[] (a slot separate from
    // state.assistants[].topics[]) used to be silently dropped — they showed
    // up as "Unnamed Topic" with no timestamps post-migration.
    const migrator = new ChatMigrator()
    const ctx = {
      sources: {
        dexieExport: {
          tableExists: vi.fn().mockResolvedValue(true),
          readTable: vi.fn().mockResolvedValue([]),
          createStreamReader: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
            readSample: vi.fn().mockResolvedValue([]),
            readInBatches: vi.fn()
          })
        },
        reduxState: {
          getCategory: vi.fn().mockReturnValue({
            assistants: [{ id: 'ast-1', topics: [{ id: 'topic-A', name: 'A' }] }],
            defaultAssistant: {
              id: 'default',
              topics: [{ id: 'topic-X', name: 'X', pinned: true }]
            }
          })
        }
      }
    }
    await migrator.prepare(ctx as any)

    const internal = migrator as unknown as {
      topicMetaLookup: Map<string, { name?: string; pinned?: boolean }>
      topicAssistantLookup: Map<string, string>
    }
    // Both topics should be registered
    expect(internal.topicMetaLookup.has('topic-A')).toBe(true)
    expect(internal.topicMetaLookup.has('topic-X')).toBe(true)
    expect(internal.topicMetaLookup.get('topic-X')?.name).toBe('X')
    expect(internal.topicMetaLookup.get('topic-X')?.pinned).toBe(true)
    // defaultAssistant's topic maps to the default-assistant id
    expect(internal.topicAssistantLookup.get('topic-X')).toBe('default')
    expect(internal.topicAssistantLookup.get('topic-A')).toBe('ast-1')
  })
})

describe('ChatMigrator validate orphan-ratio diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeStubDb(targetTopicCount: number) {
    // All count queries → constant; all sample queries → []. Tracks call order
    // so the first count query (topicTable) returns the desired target topic count.
    const select = vi.fn()
    let firstCountReturned = false
    select.mockImplementation((arg) => {
      if (arg) {
        const get = vi.fn().mockImplementation(() => {
          if (!firstCountReturned) {
            firstCountReturned = true
            return Promise.resolve({ count: targetTopicCount })
          }
          return Promise.resolve({ count: 0 })
        })
        return {
          from: vi.fn().mockReturnValue({
            get,
            where: vi.fn().mockReturnValue({ get })
          })
        }
      }
      return {
        from: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue([]) })
        })
      }
    })
    return { select }
  }

  it('warns when orphanedAssistantTopics / topicCount > 0.5', async () => {
    const migrator = new ChatMigrator()
    const m = migrator as unknown as Record<string, unknown>
    m['topicCount'] = 100
    m['skippedTopics'] = 100 // expectedTopics = 0 → no count_low error
    m['orphanedAssistantTopics'] = 60 // 60/100 = 0.6 > 0.5
    m['skippedMessages'] = 0
    m['blockStats'] = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }
    m['promotedToRootCount'] = 0

    const ctx = { db: makeStubDb(0) }
    await migrator.validate(ctx as any)

    const warned = mockLogger.warn.mock.calls.some((call) =>
      String(call[0]).includes('High orphan-assistant ratio: 60/100')
    )
    expect(warned).toBe(true)
  })

  it('does not warn when orphan ratio is at or below 0.5', async () => {
    const migrator = new ChatMigrator()
    const m = migrator as unknown as Record<string, unknown>
    m['topicCount'] = 100
    m['skippedTopics'] = 100
    m['orphanedAssistantTopics'] = 50 // exactly 0.5, not > 0.5
    m['skippedMessages'] = 0
    m['blockStats'] = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }
    m['promotedToRootCount'] = 0

    const ctx = { db: makeStubDb(0) }
    await migrator.validate(ctx as any)

    const warned = mockLogger.warn.mock.calls.some((call) => String(call[0]).includes('High orphan-assistant ratio'))
    expect(warned).toBe(false)
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
        searchableText: '',
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
