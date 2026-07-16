// ASSISTANTS backup contributor — owns `assistant` + `assistant_mcp_server` +
// `assistant_knowledge_base`.
//
// Co-located in the assistant owning module (AssistantService lives in this flat
// data-services dir) per backup-architecture §7 placement. The assistant
// aggregate is renamable (RENAME on id conflict clones the assistant AND its
// MCP/knowledge-base bindings — cloning an assistant is expected to inherit its
// config). The two junction tables are include members (via assistantId), NOT
// junction references, because the assistantId side is the same-domain owning
// leg that remaps on clone; their cross-domain legs (mcpServerId / knowledgeBaseId)
// are declared as junction references (dual cascade-prune).
//
// Preset: full + lite.

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * ASSISTANTS domain. assistant.modelId → user_model (PROVIDERS) is optional
 * (onDelete set null) and is declared here because finalize #25 requires every
 * FK on a non-polymorphic owned table to be declared (assistant is not exempt).
 */
export const ASSISTANTS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'ASSISTANTS',
  schema: {
    tables: [table('assistant'), table('assistant_mcp_server'), table('assistant_knowledge_base')],
    references: [
      // assistant.modelId → user_model (PROVIDERS): optional (onDelete set null). #25-required.
      { table: table('assistant'), column: column('modelId'), referencedDomain: 'PROVIDERS', kind: 'optional' },
      // assistant_mcp_server.assistantId → assistant: same-domain owning, include member viaColumn.
      {
        table: table('assistant_mcp_server'),
        column: column('assistantId'),
        referencedDomain: 'ASSISTANTS',
        kind: 'owning'
      },
      // assistant_mcp_server.mcpServerId → mcp_server: cross-domain junction (cascade-prune with MCP_SERVERS).
      {
        table: table('assistant_mcp_server'),
        column: column('mcpServerId'),
        referencedDomain: 'MCP_SERVERS',
        kind: 'junction'
      },
      // assistant_knowledge_base.assistantId → assistant: same-domain owning, include member viaColumn.
      {
        table: table('assistant_knowledge_base'),
        column: column('assistantId'),
        referencedDomain: 'ASSISTANTS',
        kind: 'owning'
      },
      // assistant_knowledge_base.knowledgeBaseId → knowledge_base: cross-domain junction (cascade-prune with KNOWLEDGE).
      {
        table: table('assistant_knowledge_base'),
        column: column('knowledgeBaseId'),
        referencedDomain: 'KNOWLEDGE',
        kind: 'junction'
      }
    ],
    primaryKeys: [mirrorPk('assistant'), mirrorPk('assistant_mcp_server'), mirrorPk('assistant_knowledge_base')],
    aggregates: [
      {
        root: table('assistant'),
        identityKey: columns(['id']),
        members: [
          { table: table('assistant_mcp_server'), viaColumn: column('assistantId'), cascade: 'include' },
          { table: table('assistant_knowledge_base'), viaColumn: column('assistantId'), cascade: 'include' }
        ],
        renamable: true
      }
    ],
    fileRefSourcePolicies: [],
    jsonSoftReferences: [],
    // assistant.settings holds assistant-level config knobs — no embedded
    // fileId/entityId soft refs. Declared so finalize #12 exhaustiveness passes.
    exemptJsonCols: [
      {
        table: table('assistant'),
        column: column('settings'),
        reason: 'no soft refs — holds assistant UI/model settings'
      }
    ]
  },
  backupPolicy: {},
  operations: {
    // Renamable aggregate (RENAME on conflict) → cloneAggregate is required (#16).
    // Pure: no db on the context. The fresh-PK column is read from the registry
    // (not hardcoded) so this stays correct for any single-column-PK renamable
    // root — finalize #26 guarantees the root PK is single-column. The importer
    // remaps member `assistantId` columns via its memberKeyMap.
    cloneAggregate: (ctx) => {
      const pkColumn = ctx.registry.getPrimaryKey(ctx.aggregate.root).columns[0]
      return { rootRow: { ...ctx.rootRow, [pkColumn]: ctx.newRootKey } }
    }
  }
})
