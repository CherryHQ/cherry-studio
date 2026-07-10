// MCP_SERVERS backup contributor — owns the `mcp_server` table (uuid-v4 PK).
//
// Co-located in the MCP owning module (McpServerService lives in this flat
// data-services dir) per backup-architecture §7 placement. Schema-only domain:
// no cross-domain references, no aggregate members, no operations hooks, no
// file/JSON soft-refs (mcp_server.logoUrl is a URL string, not a file_entry ref).
//
// Preset: full + lite.

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * MCP_SERVERS domain: user-configured MCP servers. Single table, uuid-v4 PK, no
 * references. conflictDefault derives to SKIP (uuid-entity → SKIP, §6.2).
 */
export const MCP_SERVERS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'MCP_SERVERS',
  schema: {
    tables: [table('mcp_server')],
    references: [],
    primaryKeys: [mirrorPk('mcp_server')],
    aggregates: [{ root: table('mcp_server'), identityKey: columns(['id']), members: [], renamable: false }],
    fileRefSourcePolicies: [],
    jsonSoftReferences: [],
    // mcp_server JSON columns all hold server config/metadata — none carry
    // embedded fileId/entityId soft refs (logoUrl is a URL string column, not JSON).
    // Declared so finalize #12 exhaustiveness passes.
    exemptJsonCols: [
      {
        table: table('mcp_server'),
        column: column('args'),
        reason: 'no soft refs — holds stdio server launch argument list'
      },
      {
        table: table('mcp_server'),
        column: column('env'),
        reason: 'no soft refs — holds stdio server environment variables'
      },
      {
        table: table('mcp_server'),
        column: column('headers'),
        reason: 'no soft refs — holds HTTP server request headers'
      },
      {
        table: table('mcp_server'),
        column: column('tags'),
        reason: 'no soft refs — holds freeform server tag strings'
      },
      {
        table: table('mcp_server'),
        column: column('configSample'),
        reason: 'no soft refs — holds a sample config template for display'
      },
      {
        table: table('mcp_server'),
        column: column('disabledTools'),
        reason: 'no soft refs — holds list of disabled tool-name strings'
      },
      {
        table: table('mcp_server'),
        column: column('disabledAutoApproveTools'),
        reason: 'no soft refs — holds list of auto-approve-disabled tool names'
      }
    ]
  },
  backupPolicy: {},
  // TODO(C/D track): DXT/MCPB package resources (codex review P2). An MCP server
  // imported from a DXT/MCPB package persists `dxtPath`; McpRuntimeService reads the
  // manifest + runs from that extracted directory. A schema-only restore re-creates
  // the row but not the package dir, so on a new machine the server cannot start.
  // Resolve before the restore pipeline consumes this contributor: either archive +
  // restore the package directory, or clear `dxtPath` on import to force re-install
  // from `registryUrl` (regenerable). Not a finalize concern; wired with the C/D
  // restore track.
  operations: undefined
})
