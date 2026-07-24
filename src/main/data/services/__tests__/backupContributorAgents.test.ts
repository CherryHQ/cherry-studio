// Unit tests for the AGENTS contributor — pure declaration assertions (no DB).
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { AGENTS_CONTRIBUTOR } from '../backupContributorAgents'

describe('AGENTS contributor', () => {
  it('owns the 9 agent tables (8 graph tables + job_schedule row-scope)', () => {
    expect(AGENTS_CONTRIBUTOR.schema.tables).toEqual([
      table('agent'),
      table('agent_session'),
      table('agent_session_message'),
      table('agent_workspace'),
      table('agent_channel'),
      table('agent_channel_task'),
      table('agent_skill'),
      table('agent_mcp_server'),
      table('job_schedule')
    ])
  })

  it('declares the job_schedule(type=agent.task) row-scope', () => {
    expect(AGENTS_CONTRIBUTOR.schema.rowScopes).toEqual([
      expect.objectContaining({
        table: table('job_schedule'),
        ownerDomain: 'AGENTS',
        filter: expect.objectContaining({ column: 'type', op: 'eq', value: 'agent.task' })
      })
    ])
  })

  it('declares every FK as the correct ReferenceKind', () => {
    const refs = AGENTS_CONTRIBUTOR.schema.references
    const find = (t: string, c: string) => refs.find((r) => r.table === t && r.column === c)

    // ── agent_session ──
    // agentId → agent: optional (onDelete set null)
    expect(find('agent_session', 'agentId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'optional' })
    )
    // workspaceId → agent_workspace: cross-aggregate OWNING (onDelete cascade), NOT a member
    expect(find('agent_session', 'workspaceId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'owning' })
    )

    // ── agent_session_message ──
    // sessionId → agent_session: owning (cascade) — drives aggregate membership
    expect(find('agent_session_message', 'sessionId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'owning' })
    )
    // modelId → user_model: optional (set null)
    expect(find('agent_session_message', 'modelId')).toEqual(
      expect.objectContaining({ referencedDomain: 'PROVIDERS', kind: 'optional' })
    )

    // ── agent_channel ──
    expect(find('agent_channel', 'agentId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'optional' })
    )
    expect(find('agent_channel', 'sessionId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'optional' })
    )

    // ── agent_channel_task (junction-phase: dual cascade) ──
    expect(find('agent_channel_task', 'channelId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'junction', junctionRole: 'source' })
    )
    expect(find('agent_channel_task', 'taskId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'junction', junctionRole: 'target' })
    )

    // ── agent_skill (junction-phase: dual cascade) ──
    expect(find('agent_skill', 'agentId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'junction', junctionRole: 'source' })
    )
    expect(find('agent_skill', 'skillId')).toEqual(
      expect.objectContaining({ referencedDomain: 'SKILLS', kind: 'junction', junctionRole: 'target' })
    )

    // ── agent_mcp_server (junction-phase: dual cascade) ──
    expect(find('agent_mcp_server', 'agentId')).toEqual(
      expect.objectContaining({ referencedDomain: 'AGENTS', kind: 'junction', junctionRole: 'source' })
    )
    expect(find('agent_mcp_server', 'mcpServerId')).toEqual(
      expect.objectContaining({ referencedDomain: 'MCP_SERVERS', kind: 'junction', junctionRole: 'target' })
    )

    // ── agent (scalar model refs → PROVIDERS, optional) ──
    expect(find('agent', 'model')).toEqual(expect.objectContaining({ referencedDomain: 'PROVIDERS', kind: 'optional' }))
    expect(find('agent', 'planModel')).toEqual(
      expect.objectContaining({ referencedDomain: 'PROVIDERS', kind: 'optional' })
    )
    expect(find('agent', 'smallModel')).toEqual(
      expect.objectContaining({ referencedDomain: 'PROVIDERS', kind: 'optional' })
    )
  })

  it('agent_session aggregate has agent_session_message as sessionId include member, non-renamable', () => {
    const session = AGENTS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('agent_session'))
    expect(session).toBeDefined()
    expect(session!.identityKey).toEqual(['id'])
    expect(session!.renamable).toBe(false)
    expect(session!.members).toEqual([
      expect.objectContaining({ table: table('agent_session_message'), viaColumn: 'sessionId', cascade: 'include' })
    ])
  })

  it('agent_session.members does NOT include agent_workspace (cross-aggregate owning ref, §5.4)', () => {
    const session = AGENTS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('agent_session'))
    expect(session!.members?.some((m) => m.table === table('agent_workspace'))).toBe(false)
  })

  it('agent_workspace is a natural-key aggregate keyed by path UNIQUE, non-renamable', () => {
    const workspace = AGENTS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('agent_workspace'))
    expect(workspace).toBeDefined()
    expect(workspace!.identityKey).toEqual(['path'])
    expect(workspace!.renamable).toBe(false)
    expect(workspace!.members ?? []).toEqual([])
  })

  it('agent_channel and agent are single-table non-renamable aggregates', () => {
    const channel = AGENTS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('agent_channel'))
    expect(channel!.identityKey).toEqual(['id'])
    expect(channel!.renamable).toBe(false)
    expect(channel!.members ?? []).toEqual([])

    const agent = AGENTS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('agent'))
    expect(agent!.identityKey).toEqual(['id'])
    expect(agent!.renamable).toBe(false)
    expect(agent!.members ?? []).toEqual([])
  })

  it('job_schedule(agent.task) is a natural-key aggregate keyed by (type,name), non-renamable', () => {
    const schedule = AGENTS_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('job_schedule'))
    expect(schedule).toBeDefined()
    expect(schedule!.identityKey).toEqual(['type', 'name'])
    expect(schedule!.renamable).toBe(false)
    expect(schedule!.members ?? []).toEqual([])
  })

  it('all aggregates are non-renamable (no cloneAggregate required, #16)', () => {
    for (const aggregate of AGENTS_CONTRIBUTOR.schema.aggregates) {
      expect(aggregate.renamable).toBe(false)
    }
    expect(AGENTS_CONTRIBUTOR.operations).toBeUndefined()
  })

  it('declares the required + tolerant JSON soft references', () => {
    const jsonRefs = AGENTS_CONTRIBUTOR.schema.jsonSoftReferences
    // agent_session_message.data: tolerant file-ref (attachments)
    expect(jsonRefs).toContainEqual(
      expect.objectContaining({
        table: table('agent_session_message'),
        column: 'data',
        target: 'file-ref',
        ownerDomain: 'AGENTS',
        kind: 'tolerant'
      })
    )
    // agent_channel.workspace: required entity-id (AgentSessionWorkspaceSource.workspaceId)
    expect(jsonRefs).toContainEqual(
      expect.objectContaining({
        table: table('agent_channel'),
        column: 'workspace',
        target: 'entity-id',
        ownerDomain: 'AGENTS',
        kind: 'required'
      })
    )
    // job_schedule.jobInputTemplate: required entity-id (same workspace source)
    expect(jsonRefs).toContainEqual(
      expect.objectContaining({
        table: table('job_schedule'),
        column: 'jobInputTemplate',
        target: 'entity-id',
        ownerDomain: 'AGENTS',
        kind: 'required'
      })
    )
  })

  it('declares no fileRefSourcePolicies (no AGENTS-owned FileRefSourceType)', () => {
    expect(AGENTS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
  })
})
