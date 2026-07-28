// Unit tests for the MCP_SERVERS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { MCP_SERVERS_CONTRIBUTOR } from '../backupContributorMcpServers'

describe('MCP_SERVERS contributor', () => {
  it('owns exactly the mcp_server table', () => {
    expect(MCP_SERVERS_CONTRIBUTOR.schema.tables).toEqual([table('mcp_server')])
  })

  it('mcp_server aggregate: root, no members, non-renamable', () => {
    const aggregate = MCP_SERVERS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('mcp_server'))
    expect(aggregate.members).toEqual([])
    expect(aggregate.renamable).toBe(false)
  })

  it('declares the mcp_server primary key as uuid-v4', () => {
    const primaryKey = MCP_SERVERS_CONTRIBUTOR.schema.primaryKeys.find((fact) => fact.table === 'mcp_server')
    expect(primaryKey).toBeDefined()
    expect(primaryKey!.kind).toBe('uuid-v4')
  })

  it('has no references, file-ref policies, or JSON soft-refs', () => {
    expect(MCP_SERVERS_CONTRIBUTOR.schema.references).toEqual([])
    expect(MCP_SERVERS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
    expect(MCP_SERVERS_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })
})
