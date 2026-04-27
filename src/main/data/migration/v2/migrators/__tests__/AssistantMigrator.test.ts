import { entityTagTable } from '@data/db/schemas/tagging'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { AssistantMigrator, mergeOldAssistants } from '../AssistantMigrator'
import type { OldAssistant } from '../mappings/AssistantMappings'

function createMockContext(reduxData: Record<string, unknown> = {}) {
  const reduxState = new ReduxStateReader(reduxData)

  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState,
      dexieExport: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() },
      dexieSettings: { keys: vi.fn().mockReturnValue([]), get: vi.fn() }
    },
    db: {
      transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation(() => {
              const returningResult = Promise.resolve([])
              const onConflictResult = {
                returning: vi.fn().mockResolvedValue([]),
                then: (resolve: (v: unknown) => unknown) => returningResult.then(resolve)
              }
              return {
                onConflictDoNothing: vi.fn().mockReturnValue(onConflictResult),
                returning: vi.fn().mockResolvedValue([]),
                then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve)
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue(
              // Returns empty array for tag queries (tag IDs lookup)
              Object.assign([], { then: (r: (v: unknown) => unknown) => Promise.resolve([]).then(r) })
            )
          })
        }
        await fn(tx)
        return tx
      }),
      select: vi.fn().mockImplementation((arg) => {
        if (arg && typeof arg === 'object' && 'id' in arg) {
          return {
            from: vi.fn().mockResolvedValue([{ id: 'openai::gpt-4' }])
          }
        }

        return {
          from: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ count: 0 }),
            limit: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue([])
            })
          })
        }
      })
    },
    sharedData: new Map(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
  }
}

const SAMPLE_ASSISTANTS = [
  {
    id: 'ast-1',
    name: 'Assistant One',
    prompt: 'You are helpful',
    emoji: '🤖',
    model: { id: 'gpt-4', provider: 'openai' },
    mcpServers: [{ id: 'srv-1' }],
    knowledge_bases: [{ id: 'kb-1' }]
  },
  {
    id: 'ast-2',
    name: 'Assistant Two',
    enableWebSearch: true
  }
]

const SAMPLE_PRESETS = [
  {
    id: 'preset-1',
    name: 'Preset One',
    prompt: 'You are a coder'
  }
]

describe('AssistantMigrator', () => {
  let migrator: AssistantMigrator

  beforeEach(() => {
    migrator = new AssistantMigrator()
    migrator.setProgressCallback(vi.fn())
  })

  it('should have correct metadata', () => {
    expect(migrator.id).toBe('assistant')
    expect(migrator.name).toBe('Assistant')
    expect(migrator.order).toBe(2)
  })

  describe('prepare', () => {
    it('should count source assistants', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 2, warnings: undefined })
    })

    it('should merge assistants and presets', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: SAMPLE_PRESETS } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 3, warnings: undefined })
    })

    it('should handle empty assistants array', async () => {
      const ctx = createMockContext({ assistants: { assistants: [], presets: [] } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 0, warnings: undefined })
    })

    it('should handle missing assistants category', async () => {
      const ctx = createMockContext({})
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 0, warnings: ['No assistants data found'] })
    })

    it('should filter out assistants without id', async () => {
      const assistants = [{ id: 'ast-1', name: 'valid' }, { name: 'no-id' }, { id: '', name: 'empty-id' }]
      const ctx = createMockContext({ assistants: { assistants, presets: [] } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        itemCount: 1,
        warnings: ['Skipped assistant without valid id: no-id', 'Skipped assistant without valid id: empty-id']
      })
    })

    it('should merge duplicate-id assistants instead of skipping', async () => {
      // Two id='dup-1' entries merge field-by-field, primary (first) wins on
      // non-empty values — see mergeOldAssistants. Merge is silent (logged
      // at info level) — the v1 initialState seeds id='default' in both
      // assistants[0] and defaultAssistant, so user-facing warnings would
      // fire on every migration.
      const assistants = [
        { id: 'dup-1', name: 'first', prompt: 'p1' },
        { id: 'dup-1', name: '', prompt: 'p2-overridden', emoji: '🌟' },
        { id: 'ast-2', name: 'unique' }
      ]
      const ctx = createMockContext({ assistants: { assistants, presets: [] } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        itemCount: 2,
        warnings: undefined
      })
    })

    it('should handle non-array assistants value', async () => {
      const ctx = createMockContext({ assistants: { assistants: 'not-an-array', presets: [] } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 0, warnings: undefined })
    })

    it('should fail when all assistants are skipped but source had data', async () => {
      // All assistants lack valid IDs — every one gets skipped
      const assistants = [{ name: 'no-id-1' }, { name: 'no-id-2' }]
      const ctx = createMockContext({ assistants: { assistants, presets: [] } })
      const result = await migrator.prepare(ctx as any)
      expect(result.success).toBe(false)
      expect(result.itemCount).toBe(0)
    })

    it('should include state.defaultAssistant as a migration source', async () => {
      // The v1 slice's `state.defaultAssistant` lives in its own slot, not in
      // `state.assistants[]`. Without explicit handling, customizations on the
      // default assistant slot are lost on migration.
      const ctx = createMockContext({
        assistants: {
          assistants: [{ id: 'ast-1', name: 'User Assistant' }],
          presets: [],
          defaultAssistant: { id: 'default', name: 'Customized Default', prompt: 'Custom prompt' }
        }
      })
      const result = await migrator.prepare(ctx as any)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2) // ast-1 + default
    })

    it('should merge defaultAssistant with same-id entry from assistants[] (primary wins)', async () => {
      // v1 initial state seeds id='default' in BOTH `assistants[0]` and
      // `defaultAssistant`. Reducers update one or the other independently.
      // Migration should merge field-by-field — assistants[] wins on
      // non-empty values; defaultAssistant fills the gaps.
      const ctx = createMockContext({
        assistants: {
          assistants: [
            // assistants[0] holds the live edits — user changed model + settings here
            {
              id: 'default',
              name: 'My Default',
              prompt: '', // not set on this slot
              model: { id: 'gpt-4', provider: 'openai' }
            }
          ],
          presets: [],
          // defaultAssistant slot has the prompt the user set via reset/onboarding
          defaultAssistant: {
            id: 'default',
            name: 'Factory Default',
            prompt: 'You are helpful',
            emoji: '😀'
          }
        }
      })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 1, warnings: undefined })

      const internal = migrator as unknown as { preparedResults: { assistant: Record<string, unknown> }[] }
      const merged = internal.preparedResults[0].assistant
      expect(merged.id).toBe('default')
      expect(merged.name).toBe('My Default') // assistants[] wins on populated field
      expect(merged.prompt).toBe('You are helpful') // defaultAssistant fills empty gap
      expect(merged.emoji).toBe('😀') // defaultAssistant fills missing field
      expect(merged.modelId).toBe('openai::gpt-4') // assistants[]-only field preserved
    })

    it('should preserve secondary populated arrays when primary has empty arrays', async () => {
      // Primary has `mcpServers: []` (default-empty, never touched), secondary
      // has `mcpServers: [s1]` (user-configured via the slot). The merge must
      // not let an empty array from primary clobber a populated one from
      // secondary — see mergeOldAssistants `isPresent` array rule.
      const ctx = createMockContext({
        assistants: {
          assistants: [
            {
              id: 'default',
              name: 'Slot Primary',
              mcpServers: [],
              knowledge_bases: [],
              tags: []
            }
          ],
          presets: [],
          defaultAssistant: {
            id: 'default',
            name: 'Slot Secondary',
            mcpServers: [{ id: 'srv-1' }],
            knowledge_bases: [{ id: 'kb-1' }],
            tags: ['t1']
          }
        }
      })
      const result = await migrator.prepare(ctx as any)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)

      const internal = migrator as unknown as {
        preparedResults: {
          assistant: Record<string, unknown>
          mcpServers: { mcpServerId: string }[]
          knowledgeBases: { knowledgeBaseId: string }[]
          tags: string[]
        }[]
      }
      const r = internal.preparedResults[0]
      expect(r.mcpServers.map((s) => s.mcpServerId)).toEqual(['srv-1'])
      expect(r.knowledgeBases.map((kb) => kb.knowledgeBaseId)).toEqual(['kb-1'])
      expect(r.tags).toEqual(['t1'])
    })
  })

  describe('mergeOldAssistants', () => {
    // Direct unit tests against the merge function. The migrator-level tests
    // exercise the merge through prepare() but can only assert against the
    // typed AssistantInsert row produced by transformAssistant — fields not
    // in OldAssistant aren't observable that way. These tests pin the
    // contracts documented in README-AssistantMigrator.md directly.
    type WithExtras = OldAssistant & Record<string, unknown>

    it('preserves unenumerated fields via object spread (primary wins on overlap)', () => {
      const primary: WithExtras = {
        id: 'default',
        name: 'Primary',
        legacyExperimentFlag: 'fromPrimary'
      }
      const secondary: WithExtras = {
        id: 'default',
        name: '',
        legacyExperimentFlag: 'fromSecondary', // overlap → primary wins
        secondaryOnlyField: 'kept' // unique → secondary survives
      }
      const merged = mergeOldAssistants(primary, secondary) as WithExtras
      expect(merged.legacyExperimentFlag).toBe('fromPrimary')
      expect(merged.secondaryOnlyField).toBe('kept')
      expect(merged.id).toBe('default')
      expect(merged.name).toBe('Primary')
    })

    it('treats empty arrays as absent so secondary populated arrays survive', () => {
      const primary: OldAssistant = {
        id: 'default',
        mcpServers: [],
        knowledge_bases: [],
        tags: []
      }
      const secondary: OldAssistant = {
        id: 'default',
        mcpServers: [{ id: 's1' }],
        knowledge_bases: [{ id: 'kb1' }],
        tags: ['t1']
      }
      const merged = mergeOldAssistants(primary, secondary)
      expect(merged.mcpServers).toEqual([{ id: 's1' }])
      expect(merged.knowledge_bases).toEqual([{ id: 'kb1' }])
      expect(merged.tags).toEqual(['t1'])
    })

    it('treats empty plain objects as absent (defaultModel / customParameters)', () => {
      const primary: OldAssistant = {
        id: 'default',
        // Default-seeded empty model object — should not clobber secondary
        defaultModel: {},
        settings: {
          // Nested empty object inside settings
          defaultModel: {},
          temperature: 0.5
        }
      }
      const secondary: OldAssistant = {
        id: 'default',
        defaultModel: { id: 'gpt-4', provider: 'openai' },
        settings: {
          defaultModel: { id: 'claude', provider: 'anthropic' },
          temperature: 0.9
        }
      }
      const merged = mergeOldAssistants(primary, secondary)
      expect(merged.defaultModel).toEqual({ id: 'gpt-4', provider: 'openai' })
      // Settings shallow-merge: primary's empty defaultModel falls through;
      // primary's temperature (0.5) wins because it's populated.
      expect(merged.settings?.defaultModel).toEqual({ id: 'claude', provider: 'anthropic' })
      expect(merged.settings?.temperature).toBe(0.5)
    })

    it('preserves boolean false on primary (explicit user choice)', () => {
      const primary: OldAssistant = { id: 'default', enableWebSearch: false }
      const secondary: OldAssistant = { id: 'default', enableWebSearch: true }
      const merged = mergeOldAssistants(primary, secondary)
      expect(merged.enableWebSearch).toBe(false)
    })

    it('falls through to secondary when primary boolean is undefined', () => {
      const primary: OldAssistant = { id: 'default' }
      const secondary: OldAssistant = { id: 'default', enableWebSearch: true }
      const merged = mergeOldAssistants(primary, secondary)
      expect(merged.enableWebSearch).toBe(true)
    })

    it('shallow-merges settings per-key (first non-empty wins)', () => {
      const primary: OldAssistant = {
        id: 'default',
        settings: { temperature: 0.7, maxTokens: undefined, topP: 1.0 }
      }
      const secondary: OldAssistant = {
        id: 'default',
        settings: { temperature: 0.2, maxTokens: 4096, topP: 0.5, contextCount: 10 }
      }
      const merged = mergeOldAssistants(primary, secondary)
      expect(merged.settings?.temperature).toBe(0.7) // primary wins
      expect(merged.settings?.maxTokens).toBe(4096) // primary undefined, secondary fills
      expect(merged.settings?.topP).toBe(1.0) // primary wins
      expect(merged.settings?.contextCount).toBe(10) // secondary-only key kept
    })

    it('returns primary settings when secondary has none, and vice versa', () => {
      expect(mergeOldAssistants({ id: 'a', settings: { temperature: 0.5 } }, { id: 'a' }).settings).toEqual({
        temperature: 0.5
      })
      expect(mergeOldAssistants({ id: 'a' }, { id: 'a', settings: { temperature: 0.5 } }).settings).toEqual({
        temperature: 0.5
      })
    })
  })

  describe('execute', () => {
    it('should insert assistants into database', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      ctx.sharedData.set('mcpServerIdMapping', new Map([['srv-1', 'new-srv-uuid']]))
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result).toStrictEqual({ success: true, processedCount: 2 })
      expect(ctx.db.transaction).toHaveBeenCalled()
    })

    it('should store assistantIds in sharedData', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      ctx.sharedData.set('mcpServerIdMapping', new Map([['srv-1', 'new-srv-uuid']]))
      await migrator.prepare(ctx as any)
      await migrator.execute(ctx as any)
      const ids = ctx.sharedData.get('assistantIds') as Set<string>
      expect(ids).toBeInstanceOf(Set)
      expect(ids.has('ast-1')).toBe(true)
      expect(ids.has('ast-2')).toBe(true)
      // Backstop guarantee: DEFAULT_ASSISTANT_ID is always in the FK whitelist
      // even when no v1 source produced an id='default' row.
      expect(ids.has('default')).toBe(true)
    })

    it('inserts the default-assistant backstop row when no v1 source has id=default', async () => {
      // Captures the values handed to tx.insert to verify the canonical
      // payload was inserted. Failing this lets verifyForeignKeys() abort
      // the migration when ChatMigrator emits topics with assistantId='default'.
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      ctx.sharedData.set('mcpServerIdMapping', new Map([['srv-1', 'new-srv-uuid']]))

      const inserted: unknown[][] = []
      ctx.db.transaction = vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: unknown) => {
              inserted.push(Array.isArray(vals) ? vals : [vals])
              return {
                onConflictDoNothing: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([]),
                  then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
                }),
                returning: vi.fn().mockResolvedValue([]),
                then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi
              .fn()
              .mockReturnValue(Object.assign([], { then: (r: (v: unknown) => unknown) => Promise.resolve([]).then(r) }))
          })
        }
        await fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result.success).toBe(true)

      // The flat list of every inserted row across all batches.
      const allRows = inserted.flat() as { id?: string; name?: string }[]
      const defaultRow = allRows.find((r) => r && typeof r === 'object' && r.id === 'default')
      expect(defaultRow).toBeDefined()
      expect(defaultRow?.name).toBe('Default Assistant')
    })

    it('does not double-insert the default-assistant row when v1 already provides id=default', async () => {
      const ctx = createMockContext({
        assistants: {
          assistants: [{ id: 'default', name: 'User Customized Default', prompt: 'Custom' }],
          presets: []
        }
      })

      const inserted: unknown[][] = []
      ctx.db.transaction = vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: unknown) => {
              inserted.push(Array.isArray(vals) ? vals : [vals])
              return {
                onConflictDoNothing: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([]),
                  then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
                }),
                returning: vi.fn().mockResolvedValue([]),
                then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi
              .fn()
              .mockReturnValue(Object.assign([], { then: (r: (v: unknown) => unknown) => Promise.resolve([]).then(r) }))
          })
        }
        await fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      await migrator.execute(ctx as any)

      const allRows = inserted.flat() as { id?: string; name?: string }[]
      const defaultRows = allRows.filter((r) => r && typeof r === 'object' && r.id === 'default')
      // Exactly one — the v1 user-customized row, no backstop on top.
      expect(defaultRows).toHaveLength(1)
      expect(defaultRows[0]?.name).toBe('User Customized Default')
    })

    it('handles empty v1 assistants by inserting only the backstop default row', async () => {
      // No v1 sources at all — the migrator must still ensure the default
      // row exists so ChatMigrator's FK fallback resolves and
      // verifyForeignKeys() succeeds.
      const ctx = createMockContext({ assistants: { assistants: [], presets: [] } })

      const inserted: unknown[][] = []
      ctx.db.transaction = vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: unknown) => {
              inserted.push(Array.isArray(vals) ? vals : [vals])
              return {
                onConflictDoNothing: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([]),
                  then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
                }),
                returning: vi.fn().mockResolvedValue([]),
                then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi
              .fn()
              .mockReturnValue(Object.assign([], { then: (r: (v: unknown) => unknown) => Promise.resolve([]).then(r) }))
          })
        }
        await fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      // processedCount counts user rows; the backstop is not counted.
      expect(result).toStrictEqual({ success: true, processedCount: 0 })

      const allRows = inserted.flat() as { id?: string; name?: string }[]
      const defaultRows = allRows.filter((r) => r && typeof r === 'object' && r.id === 'default')
      expect(defaultRows).toHaveLength(1)

      // Shared FK whitelist still includes the default id.
      const ids = ctx.sharedData.get('assistantIds') as Set<string>
      expect(ids.has('default')).toBe(true)
    })

    it('should return failure when transaction throws', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      ctx.db.transaction = vi.fn().mockRejectedValue(new Error('SQLITE_CONSTRAINT'))
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result.success).toBe(false)
      expect(result.error).toContain('SQLITE_CONSTRAINT')
      expect(result.processedCount).toBe(0)
    })

    it('should fail when mcpServerIdMapping is missing from sharedData and MCP rows exist', async () => {
      const assistantsWithMcp = [{ id: 'ast-1', name: 'Has MCP', mcpServers: [{ id: 'srv-1' }, { id: 'srv-2' }] }]
      const ctx = createMockContext({ assistants: { assistants: assistantsWithMcp, presets: [] } })
      // Do NOT set mcpServerIdMapping in sharedData
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(false)
      expect(result.error).toContain('mcpServerIdMapping not found')
    })

    it('should migrate tags to tag and entity_tag tables', async () => {
      const assistantsWithTags = [
        { id: 'ast-1', name: 'Tagged One', tags: ['work', 'coding'] },
        { id: 'ast-2', name: 'Tagged Two', tags: ['work', 'personal'] },
        { id: 'ast-3', name: 'No Tags' }
      ]
      const ctx = createMockContext({ assistants: { assistants: assistantsWithTags, presets: [] } })

      // Override transaction to capture insert calls and return tag IDs from select
      const allInsertedValues: unknown[][] = []
      const mockTagRows = [
        { id: 'tag-1', name: 'work' },
        { id: 'tag-2', name: 'coding' },
        { id: 'tag-3', name: 'personal' }
      ]
      ctx.db.transaction = vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockImplementation((vals: unknown[]) => {
              allInsertedValues.push(vals)
              const rows = Array.isArray(vals) ? vals : [vals]
              return {
                onConflictDoNothing: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue(rows.map((_: unknown, index) => ({ id: `inserted-${index}` }))),
                  then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
                }),
                then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
              }
            })
          })),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockResolvedValue(mockTagRows)
          })
        }
        await fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)

      // Find tag name inserts — tag rows have { name } but NOT { prompt } (unlike assistant rows)
      const tagNameInserts = allInsertedValues
        .flat()
        .filter((v: any) => v && typeof v === 'object' && 'name' in v && !('entityType' in v) && !('prompt' in v))
      const tagNames = tagNameInserts.map((v: any) => v.name)
      expect(new Set(tagNames)).toEqual(new Set(['work', 'coding', 'personal']))

      // Find entity_tag inserts (objects with 'entityType' key)
      const entityTagInserts = allInsertedValues
        .flat()
        .filter((v: any) => v && typeof v === 'object' && 'entityType' in v)
      // ast-1 has 2 tags, ast-2 has 2 tags = 4 entity_tag rows
      expect(entityTagInserts).toHaveLength(4)
      expect(entityTagInserts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entityType: 'assistant', entityId: 'ast-1', tagId: 'tag-1' }),
          expect.objectContaining({ entityType: 'assistant', entityId: 'ast-1', tagId: 'tag-2' }),
          expect.objectContaining({ entityType: 'assistant', entityId: 'ast-2', tagId: 'tag-1' }),
          expect.objectContaining({ entityType: 'assistant', entityId: 'ast-2', tagId: 'tag-3' })
        ])
      )
    })

    it('should deduplicate duplicate tags on one assistant before inserting entity_tag rows', async () => {
      const assistantsWithDuplicateTags = [{ id: 'ast-1', name: 'Tagged One', tags: ['work', 'work', 'coding'] }]
      const ctx = createMockContext({ assistants: { assistants: assistantsWithDuplicateTags, presets: [] } })

      const allInsertedValues: unknown[][] = []
      const onConflictDoNothingCalls: string[] = []
      const mockTagRows = [
        { id: 'tag-1', name: 'work' },
        { id: 'tag-2', name: 'coding' }
      ]

      ctx.db.transaction = vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockImplementation((table) => ({
            values: vi.fn().mockImplementation((vals: unknown[]) => {
              allInsertedValues.push(vals)
              const rows = Array.isArray(vals) ? vals : [vals]
              return {
                onConflictDoNothing: vi.fn().mockImplementation(() => {
                  onConflictDoNothingCalls.push(table === entityTagTable ? 'entity_tag' : 'tag')
                  return {
                    returning: vi
                      .fn()
                      .mockResolvedValue(
                        rows.map((_: unknown, index) => ({ id: `inserted-${index}`, tagId: `tag-${index}` }))
                      ),
                    then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
                  }
                }),
                then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r)
              }
            })
          })),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockResolvedValue(mockTagRows)
          })
        }
        await fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)

      const entityTagInserts = allInsertedValues
        .flat()
        .filter((v: any) => v && typeof v === 'object' && 'entityType' in v)
      expect(entityTagInserts).toHaveLength(2)
      expect(entityTagInserts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entityType: 'assistant', entityId: 'ast-1', tagId: 'tag-1' }),
          expect.objectContaining({ entityType: 'assistant', entityId: 'ast-1', tagId: 'tag-2' })
        ])
      )
      expect(onConflictDoNothingCalls).toEqual(expect.arrayContaining(['tag', 'entity_tag']))
    })

    it('should drop dangling mcpServer refs not present in mapping', async () => {
      const assistantsWithMcp = [
        { id: 'ast-1', name: 'Mixed MCP', mcpServers: [{ id: 'known-srv' }, { id: 'unknown-srv' }] }
      ]
      const ctx = createMockContext({ assistants: { assistants: assistantsWithMcp, presets: [] } })
      ctx.sharedData.set('mcpServerIdMapping', new Map([['known-srv', 'new-uuid']]))
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      expect(ctx.db.transaction).toHaveBeenCalled()
    })

    it('should null out dangling assistant model refs not present in user_model', async () => {
      const assistantsWithDanglingModel = [
        { id: 'ast-1', name: 'Dangling Model', model: { id: 'qwen', provider: 'cherryai' } }
      ]
      const ctx = createMockContext({ assistants: { assistants: assistantsWithDanglingModel, presets: [] } })
      const insertedBatches: any[] = []

      ctx.db.transaction = vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: unknown[]) => {
              insertedBatches.push(vals)
              return {
                onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
                then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve)
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockResolvedValue([])
          })
        }
        await fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      expect(insertedBatches[0][0]).toMatchObject({ id: 'ast-1', modelId: null })
    })
  })

  describe('validate', () => {
    function mockValidateDb(ctx: ReturnType<typeof createMockContext>, count: number, sample: any[] = []) {
      ctx.db.select = vi.fn().mockImplementation((arg) => {
        if (arg) {
          return {
            from: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ count })
            })
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue(sample)
            })
          })
        }
      })
    }

    it('should pass when counts match and sample is valid', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      const sampleRows = SAMPLE_ASSISTANTS.map((a) => ({ id: a.id, name: a.name }))
      mockValidateDb(ctx, 2, sampleRows)

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        errors: [],
        stats: { sourceCount: 2, targetCount: 2, skippedCount: 0 }
      })
    })

    it('should fail when sample has missing required fields', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      mockValidateDb(ctx, 2, [
        { id: '', name: 'test' },
        { id: 'ast-2', name: '' }
      ])

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(2)
    })

    it('should pass with zero items', async () => {
      const ctx = createMockContext({})
      mockValidateDb(ctx, 0, [])

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        errors: [],
        stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 }
      })
    })

    it('should fail on count mismatch', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      mockValidateDb(ctx, 1, [{ id: 'ast-1', name: 'test' }])

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors).toContainEqual(expect.objectContaining({ key: 'count_mismatch' }))
    })

    it('should return failure when db throws', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      ctx.db.select = vi.fn().mockImplementation(() => {
        throw new Error('DB_CORRUPT')
      })

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors[0].message).toContain('DB_CORRUPT')
    })
  })
})
