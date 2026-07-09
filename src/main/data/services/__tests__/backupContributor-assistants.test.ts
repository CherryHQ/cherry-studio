// Unit tests for the ASSISTANTS contributor — pure declaration assertions (no DB).
import type { CloneAggregateContext } from '@main/data/db/backup/contributor-types'
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { ASSISTANTS_CONTRIBUTOR } from '../backupContributor-assistants'

describe('ASSISTANTS contributor', () => {
  it('owns assistant + assistant_mcp_server + assistant_knowledge_base', () => {
    expect(ASSISTANTS_CONTRIBUTOR.schema.tables).toEqual([
      table('assistant'),
      table('assistant_mcp_server'),
      table('assistant_knowledge_base')
    ])
  })

  it('declares 5 references: modelId(optional→PROVIDERS) + 2 owning assistantId + 2 junction', () => {
    const refs = ASSISTANTS_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(5)
    // assistant.modelId → PROVIDERS is optional (onDelete set null); #25 requires it.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('assistant'),
        column: 'modelId',
        referencedDomain: 'PROVIDERS',
        kind: 'optional'
      })
    )
    // same-domain owning member legs
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('assistant_mcp_server'),
        column: 'assistantId',
        referencedDomain: 'ASSISTANTS',
        kind: 'owning'
      })
    )
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('assistant_knowledge_base'),
        column: 'assistantId',
        referencedDomain: 'ASSISTANTS',
        kind: 'owning'
      })
    )
    // cross-domain junction legs
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('assistant_mcp_server'),
        column: 'mcpServerId',
        referencedDomain: 'MCP_SERVERS',
        kind: 'junction'
      })
    )
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('assistant_knowledge_base'),
        column: 'knowledgeBaseId',
        referencedDomain: 'KNOWLEDGE',
        kind: 'junction'
      })
    )
  })

  it('assistant aggregate is renamable with 2 include members via assistantId', () => {
    const aggregate = ASSISTANTS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('assistant'))
    expect(aggregate.renamable).toBe(true)
    expect(aggregate.members).toEqual([
      expect.objectContaining({ table: table('assistant_mcp_server'), viaColumn: 'assistantId', cascade: 'include' }),
      expect.objectContaining({
        table: table('assistant_knowledge_base'),
        viaColumn: 'assistantId',
        cascade: 'include'
      })
    ])
  })

  it('renamable aggregate supplies cloneAggregate (finalize #16)', () => {
    expect(ASSISTANTS_CONTRIBUTOR.operations?.cloneAggregate).toBeDefined()
  })

  it('cloneAggregate returns a root row with the PK replaced by newRootKey', async () => {
    const cloneAggregate = ASSISTANTS_CONTRIBUTOR.operations!.cloneAggregate!
    // cloneAggregate is pure (no db on the context) — stub only the fields it reads.
    // The PK column is derived from ctx.registry (#26 guarantees a single-column root PK).
    const ctx = {
      aggregate: { root: table('assistant') },
      registry: { getPrimaryKey: () => ({ columns: ['id'] }) },
      rootRow: { id: 'old-id', name: 'a', prompt: 'p' },
      newRootKey: 'new-id'
    } as unknown as CloneAggregateContext
    const result = await cloneAggregate(ctx)
    expect(result.rootRow.id).toBe('new-id')
    expect(result.rootRow.name).toBe('a') // non-PK fields preserved by the spread
  })

  it('primary keys are non-ambiguous (assistant uuid-v4; junctions composite)', () => {
    for (const pk of ASSISTANTS_CONTRIBUTOR.schema.primaryKeys) {
      expect(pk.ambiguous).toBeFalsy()
    }
    const assistant = ASSISTANTS_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'assistant')!
    expect(assistant.kind).toBe('uuid-v4')
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(ASSISTANTS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})
