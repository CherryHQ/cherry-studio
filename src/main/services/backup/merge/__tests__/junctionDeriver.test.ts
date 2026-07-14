// junctionDeriver tests — verifies the pure-junction set the global junction phase consumes.
// Uses the real 14-domain registry (finalize is pure in-memory, cached).

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { describe, expect, it } from 'vitest'

import { deriveJunctionDescriptors } from '../junctionDeriver'

const registry = contributorManager.getRegistry()

describe('deriveJunctionDescriptors', () => {
  it('derives the 3 pure junctions for AGENTS+SKILLS+MCP_SERVERS (all AGENTS-owned, root endpoints)', () => {
    const descs = deriveJunctionDescriptors(registry, ['AGENTS', 'SKILLS', 'MCP_SERVERS'])
    const tables = descs.map((d) => d.table).sort()
    expect(tables).toEqual(['agent_channel_task', 'agent_mcp_server', 'agent_skill'])
    for (const d of descs) {
      expect(d.ownerDomain).toBe('AGENTS')
      expect(d.sourceEndpoint.aggregatePath).toBe('root')
      expect(d.targetEndpoint.aggregatePath).toBe('root')
    }
  })

  it('agent_skill: source agent (AGENTS) → target agent_global_skill (SKILLS)', () => {
    const skill = deriveJunctionDescriptors(registry, ['AGENTS', 'SKILLS']).find((d) => d.table === 'agent_skill')
    expect(skill).toBeDefined()
    expect(skill!.sourceEndpoint.table).toBe('agent')
    expect(skill!.targetEndpoint.table).toBe('agent_global_skill')
  })

  it('agent_mcp_server: source agent (AGENTS) → target mcp_server (MCP_SERVERS)', () => {
    const mcp = deriveJunctionDescriptors(registry, ['AGENTS', 'MCP_SERVERS']).find(
      (d) => d.table === 'agent_mcp_server'
    )
    expect(mcp).toBeDefined()
    expect(mcp!.sourceEndpoint.table).toBe('agent')
    expect(mcp!.targetEndpoint.table).toBe('mcp_server')
  })

  it('agent_channel_task: both endpoints AGENTS roots (agent_channel + job_schedule)', () => {
    const act = deriveJunctionDescriptors(registry, ['AGENTS']).find((d) => d.table === 'agent_channel_task')
    expect(act).toBeDefined()
    expect(act!.sourceEndpoint.aggregatePath).toBe('root')
    expect(act!.targetEndpoint.aggregatePath).toBe('root')
    const endpointTables = [act!.sourceEndpoint.table, act!.targetEndpoint.table].sort()
    expect(endpointTables).toEqual(['agent_channel', 'job_schedule'])
  })

  it('excludes include-member tables (assistant_mcp_server, chat_message_file_ref, painting_file_ref) + entity_tag', () => {
    const descs = deriveJunctionDescriptors(registry, [
      'AGENTS',
      'SKILLS',
      'MCP_SERVERS',
      'ASSISTANTS',
      'KNOWLEDGE',
      'TOPICS',
      'PAINTINGS',
      'FILE_STORAGE',
      'TAGS_GROUPS'
    ])
    const tables = descs.map((d) => d.table)
    // include-members (already imported via root/member cascade)
    expect(tables).not.toContain('assistant_mcp_server')
    expect(tables).not.toContain('assistant_knowledge_base')
    expect(tables).not.toContain('chat_message_file_ref')
    expect(tables).not.toContain('painting_file_ref')
    // entity_tag: tagId is kind:'owning', not junction
    expect(tables).not.toContain('entity_tag')
  })
})
