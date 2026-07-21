import { assistantTable } from '@data/db/schemas/assistant'
import { groupTable } from '@data/db/schemas/group'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { AssistantMigrator, mergeOldAssistants } from '../AssistantMigrator'
import type { OldAssistant } from '../mappings/AssistantMappings'
import * as AssistantMappings from '../mappings/AssistantMappings'

vi.mock('../mappings/AssistantMappings', async (importActual) => {
  const actual = await importActual<typeof AssistantMappings>()
  return { ...actual, transformAssistant: vi.fn(actual.transformAssistant) }
})

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
      // assertOwnedForeignKeys() runs PRAGMA foreign_key_check via db.all; empty => no violations.
      all: vi.fn().mockReturnValue([]),
      // better-sqlite3 transactions run the callback synchronously.
      transaction: vi.fn((fn: (tx: any) => unknown) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              run: vi.fn(),
              returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
              onConflictDoNothing: vi.fn().mockReturnValue({
                run: vi.fn(),
                returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
              })
            })
          }),
          select: vi.fn().mockReturnValue({
            // Returns empty array for tag/knowledge-base ID lookups
            from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
          })
        }
        return fn(tx)
      }),
      select: vi.fn().mockImplementation((arg) => {
        if (arg && typeof arg === 'object' && 'id' in arg) {
          return {
            from: vi.fn().mockReturnValue([{ id: 'openai::gpt-4' }])
          }
        }

        return {
          from: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue({ count: 0 }),
            limit: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue([])
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

    it('should warn when invalid or additional legacy tags are discarded', async () => {
      const ctx = createMockContext({
        assistants: { assistants: [{ id: 'ast-1', name: 'Grouped', tags: ['', 'work'] }], presets: [] }
      })

      const result = await migrator.prepare(ctx as any)

      expect(result).toStrictEqual({
        success: true,
        itemCount: 1,
        warnings: ['Discarded 1 invalid or additional legacy tag entries for assistant ast-1']
      })
      const internal = migrator as unknown as { preparedResults: { legacyTagName: string | null }[] }
      expect(internal.preparedResults[0].legacyTagName).toBe('work')
    })

    it('should fail when all assistants are skipped but source had data', async () => {
      // All assistants lack valid IDs — every one gets skipped
      const assistants = [{ name: 'no-id-1' }, { name: 'no-id-2' }]
      const ctx = createMockContext({ assistants: { assistants, presets: [] } })
      const result = await migrator.prepare(ctx as any)
      expect(result.success).toBe(false)
      expect(result.itemCount).toBe(0)
    })

    it('should fail when every transformAssistant throws (systemic transform failure)', async () => {
      // Mode 2 of the systemic-failure guard: every row passes id validation
      // but transformAssistant throws, so preparedResults stays empty even
      // though sourceById.size > 0. Was previously masked by the now-removed
      // `sourceById.size === 0` form of the guard. Uses mockImplementationOnce
      // per row so the spy auto-reverts to its real impl after this test.
      const transformSpy = vi.mocked(AssistantMappings.transformAssistant)
      const assistants = [
        { id: 'ast-a', name: 'A' },
        { id: 'ast-b', name: 'B' },
        { id: 'ast-c', name: 'C' }
      ]
      for (let i = 0; i < assistants.length; i++) {
        transformSpy.mockImplementationOnce(() => {
          throw new Error('boom')
        })
      }
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

      const internal = migrator as unknown as {
        preparedResults: { assistant: Record<string, unknown> }[]
        legacyAssistantIdRemap: Map<string, string>
      }
      const merged = internal.preparedResults[0].assistant
      // v1 'default' is remapped to a fresh UUID — v2 has no 'default' sentinel.
      const remappedDefault = internal.legacyAssistantIdRemap.get('default')
      expect(remappedDefault).toBeDefined()
      expect(merged.id).toBe(remappedDefault)
      expect(merged.id).not.toBe('default')
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
          legacyTagName: string | null
        }[]
      }
      const r = internal.preparedResults[0]
      expect(r.mcpServers.map((s) => s.mcpServerId)).toEqual(['srv-1'])
      expect(r.knowledgeBases.map((kb) => kb.knowledgeBaseId)).toEqual(['kb-1'])
      expect(r.legacyTagName).toBe('t1')
    })
  })

  describe('mergeOldAssistants', () => {
    // Direct unit tests against the merge function. The migrator-level tests
    // exercise the merge through prepare() but can only assert against the
    // typed InsertAssistantRow produced by transformAssistant — fields not
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
        settings: { temperature: 0.2, maxTokens: 4096, topP: 0.5, enableTopP: true }
      }
      const merged = mergeOldAssistants(primary, secondary)
      expect(merged.settings?.temperature).toBe(0.7) // primary wins
      expect(merged.settings?.maxTokens).toBe(4096) // primary undefined, secondary fills
      expect(merged.settings?.topP).toBe(1.0) // primary wins
      expect(merged.settings?.enableTopP).toBe(true) // secondary-only key kept
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
    it('records bounded assistant lengths when SQLite rejects an oversized batch', async () => {
      const canary = `PRIVATE_ASSISTANT_PROMPT_${'x'.repeat(90_000)}`
      const sqliteError = Object.assign(new Error('PRIVATE_STACK_/Users/alice'), { code: 'SQLITE_TOOBIG' })
      const ctx = createMockContext({
        assistants: { assistants: [{ id: 'oversized', name: 'Assistant', prompt: canary }], presets: [] }
      })
      ctx.db.transaction = vi.fn((operation: (tx: unknown) => void) =>
        operation({
          insert: () => ({
            values: () => ({
              run: () => {
                throw sqliteError
              }
            })
          })
        })
      ) as any
      await migrator.prepare(ctx as any)

      const diagnosed = await migrator.executeWithDiagnostics(ctx as any)

      expect(diagnosed.result.success).toBe(false)
      expect(diagnosed.failure).toMatchObject({
        classification: { errorCode: 'sqlite_too_big' },
        evidence: {
          kind: 'failed_write',
          values: expect.arrayContaining([expect.objectContaining({ role: 'text_value', kind: 'string' })])
        }
      })
      expect(JSON.stringify(diagnosed.failure)).not.toContain('PRIVATE_ASSISTANT_PROMPT')
      expect(JSON.stringify(diagnosed.failure)).not.toContain('/Users/alice')
    })

    it('should insert assistants into database', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      ctx.sharedData.set('mcpServerIdMapping', new Map([['srv-1', 'new-srv-uuid']]))
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result).toStrictEqual({ success: true, processedCount: 2 })
      expect(ctx.db.transaction).toHaveBeenCalled()
    })

    it('should stamp assistant order keys in source order during execute', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      ctx.sharedData.set('mcpServerIdMapping', new Map([['srv-1', 'new-srv-uuid']]))
      const inserted: unknown[][] = []
      ctx.db.transaction = vi.fn((fn: (tx: any) => unknown) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: unknown[]) => {
              inserted.push(Array.isArray(vals) ? vals : [vals])
              return {
                run: vi.fn(),
                returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
                onConflictDoNothing: vi.fn().mockReturnValue({
                  run: vi.fn(),
                  returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
                })
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
          })
        }
        return fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      const assistantRows = (inserted.flat() as Array<Record<string, unknown>>).filter((row) =>
        String(row.id).startsWith('ast-')
      )
      expect(assistantRows.map((row) => row.id)).toEqual(['ast-1', 'ast-2'])
      const orderKeys = assistantRows
        .map((row) => row.orderKey)
        .filter((orderKey): orderKey is string => typeof orderKey === 'string')
      expect(orderKeys).toHaveLength(2)
      expect(orderKeys.every((orderKey) => orderKey.length > 0)).toBe(true)
      expect(orderKeys[0] < orderKeys[1]).toBe(true)
    })

    it('should store assistantIds in sharedData (only migrated user assistants — no synthetic default)', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      ctx.sharedData.set('mcpServerIdMapping', new Map([['srv-1', 'new-srv-uuid']]))
      await migrator.prepare(ctx as any)
      await migrator.execute(ctx as any)
      const ids = ctx.sharedData.get('assistantIds') as Set<string>
      expect(ids).toBeInstanceOf(Set)
      expect(ids.has('ast-1')).toBe(true)
      expect(ids.has('ast-2')).toBe(true)
      // v2 has no system-reserved 'default' row.
      expect(ids.has('default')).toBe(false)
    })

    it('remaps v1 id=default to a UUID instead of inserting a sentinel row', async () => {
      // Legacy 'default' is no longer a v2 entity id — v2 has no sentinel row.
      // The user's customizations migrate as a normal user assistant under a
      // generated UUID; the remap is exposed via sharedData so ChatMigrator can
      // rewrite topic.assistantId='default' to the same UUID.
      const ctx = createMockContext({
        assistants: {
          assistants: [{ id: 'default', name: 'User Customized Default', prompt: 'Custom' }],
          presets: []
        }
      })

      const inserted: unknown[][] = []
      ctx.db.transaction = vi.fn((fn: (tx: any) => unknown) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: unknown) => {
              inserted.push(Array.isArray(vals) ? vals : [vals])
              return {
                run: vi.fn(),
                returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
                onConflictDoNothing: vi.fn().mockReturnValue({
                  run: vi.fn(),
                  returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
                })
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
          })
        }
        return fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      await migrator.execute(ctx as any)

      const allRows = inserted.flat() as { id?: string; name?: string }[]
      const defaultLiteralRows = allRows.filter((r) => r && typeof r === 'object' && r.id === 'default')
      expect(defaultLiteralRows).toHaveLength(0)
      const remap = ctx.sharedData.get('legacyAssistantIdRemap') as Map<string, string>
      const remappedId = remap.get('default')
      expect(remappedId).toBeDefined()
      const remappedRow = allRows.find((r) => r && typeof r === 'object' && r.id === remappedId)
      expect(remappedRow?.name).toBe('User Customized Default')
    })

    it('handles empty v1 assistants by writing zero rows and an empty FK whitelist', async () => {
      // No v1 sources at all — v2 leaves `assistant` empty and the renderer
      // composes a runtime default from Preference. ChatMigrator's orphan
      // fallback then writes NULL for any topic that lacks a real assistant.
      const ctx = createMockContext({ assistants: { assistants: [], presets: [] } })

      const inserted: unknown[][] = []
      ctx.db.transaction = vi.fn((fn: (tx: any) => unknown) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: unknown) => {
              inserted.push(Array.isArray(vals) ? vals : [vals])
              return {
                run: vi.fn(),
                returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
                onConflictDoNothing: vi.fn().mockReturnValue({
                  run: vi.fn(),
                  returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
                })
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
          })
        }
        return fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result).toStrictEqual({ success: true, processedCount: 0 })

      const allRows = inserted.flat() as { id?: string; name?: string }[]
      expect(allRows).toHaveLength(0)
      const ids = ctx.sharedData.get('assistantIds') as Set<string>
      expect(ids.size).toBe(0)
    })

    it('should return failure when transaction throws', async () => {
      const ctx = createMockContext({ assistants: { assistants: SAMPLE_ASSISTANTS, presets: [] } })
      // better-sqlite3 transactions throw synchronously when the callback fails.
      ctx.db.transaction = vi.fn(() => {
        throw new Error('SQLITE_CONSTRAINT')
      })
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

    it('should migrate legacy tags, including names over 64 characters, to ordered assistant groups', async () => {
      const longGroupName = 'x'.repeat(65)
      const assistantsWithTags = [
        { id: 'ast-1', name: 'Work One', tags: ['work'] },
        { id: 'ast-2', name: 'Personal', tags: ['personal'] },
        { id: 'ast-3', name: 'Work Two', tags: ['work'] },
        { id: 'ast-4', name: 'Ungrouped' },
        { id: 'ast-5', name: 'Long Group', tags: [longGroupName] }
      ]
      const ctx = createMockContext({
        assistants: {
          assistants: assistantsWithTags,
          presets: [],
          tagsOrder: ['personal', 'work', 'stale', 'personal']
        }
      })

      const insertedByTable = new Map<unknown, Array<Record<string, unknown>>>()
      ctx.db.transaction = vi.fn((fn: (tx: any) => unknown) => {
        const tx = {
          insert: vi.fn().mockImplementation((table) => ({
            values: vi.fn().mockImplementation((values: unknown) => {
              const rows = (Array.isArray(values) ? values : [values]) as Array<Record<string, unknown>>
              insertedByTable.set(table, [...(insertedByTable.get(table) ?? []), ...rows])
              return { run: vi.fn() }
            })
          })),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
          })
        }
        return fn(tx)
      }) as any

      const prepareResult = await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(prepareResult.warnings).toBeUndefined()
      expect(result.success).toBe(true)

      const groupRows = insertedByTable.get(groupTable) ?? []
      expect(groupRows.map((row) => row.name)).toEqual(['personal', 'work', longGroupName])
      expect(String(groupRows[0].orderKey) < String(groupRows[1].orderKey)).toBe(true)
      expect(String(groupRows[1].orderKey) < String(groupRows[2].orderKey)).toBe(true)

      const groupIdByName = new Map(groupRows.map((row) => [row.name, row.id]))
      const assistantRows = insertedByTable.get(assistantTable) ?? []
      expect(assistantRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'ast-1', groupId: groupIdByName.get('work') }),
          expect.objectContaining({ id: 'ast-2', groupId: groupIdByName.get('personal') }),
          expect.objectContaining({ id: 'ast-3', groupId: groupIdByName.get('work') }),
          expect.objectContaining({ id: 'ast-4', groupId: null }),
          expect.objectContaining({ id: 'ast-5', groupId: groupIdByName.get(longGroupName) })
        ])
      )
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

      ctx.db.transaction = vi.fn((fn: (tx: any) => unknown) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals: unknown[]) => {
              insertedBatches.push(vals)
              return {
                run: vi.fn(),
                returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
                onConflictDoNothing: vi.fn().mockReturnValue({
                  run: vi.fn(),
                  returning: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
                })
              }
            })
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
          })
        }
        return fn(tx)
      }) as any

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      expect(insertedBatches[0][0]).toMatchObject({ id: 'ast-1', modelId: null })
    })
  })

  describe('validate', () => {
    function mockValidateDb(
      ctx: ReturnType<typeof createMockContext>,
      assistantCount: number,
      sample: any[] = [],
      groupCount = 0
    ) {
      ctx.db.select = vi.fn().mockImplementation((arg) => {
        if (arg) {
          return {
            from: vi.fn().mockImplementation((table) => {
              if (table === groupTable) {
                return {
                  where: vi.fn().mockReturnValue({
                    get: vi.fn().mockReturnValue({ count: groupCount })
                  })
                }
              }
              return { get: vi.fn().mockReturnValue({ count: assistantCount }) }
            })
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue(sample)
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

    it('should fail when migrated assistant group count does not match', async () => {
      const ctx = createMockContext({
        assistants: { assistants: [{ id: 'ast-1', name: 'Grouped', tags: ['work'] }], presets: [] }
      })
      mockValidateDb(ctx, 1, [{ id: 'ast-1', name: 'Grouped' }], 0)

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)

      expect(result.success).toBe(false)
      expect(result.errors).toContainEqual(expect.objectContaining({ key: 'group_count_mismatch' }))
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

    it('passes prepare → execute → validate when v1 sources were empty (zero rows expected)', async () => {
      // Empty v1 sources → preparedResults is empty and no synthetic backstop
      // is inserted. validate() must accept zero rows in the assistant table.
      const ctx = createMockContext({ assistants: { assistants: [], presets: [] } })

      await migrator.prepare(ctx as any)
      await migrator.execute(ctx as any)

      mockValidateDb(ctx, 0, [])

      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(true)
      expect(result.errors).toEqual([])
    })
  })
})
