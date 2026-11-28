import { describe, expect, it } from 'vitest'

import type { McpServer } from '../../../data/types/mcpServer'
import {
  isMcpAutoApprovalEnforcedBySource,
  isMcpToolDisabledBySource,
  isMcpToolForcePromptBySource,
  matchesMcpSourceToolRule,
  resolveMcpSourceSkillAccess,
  resolveMcpSourceToolAccess
} from '../mcpSourcePolicy'

const server = {
  id: 'docs-id',
  name: 'docs',
  isActive: true,
  disabledTools: [],
  disabledAutoApproveTools: []
} as McpServer

const tool = {
  id: 'mcp__docs__searchDocs_0123456789abcdefabcd',
  name: 'search_docs'
}

describe('mcpSourcePolicy', () => {
  it('enforces a matching server-wide prompt rule for current and future tools', () => {
    const configured = { ...server, disabledAutoApproveTools: ['mcp__docs__*'] }
    expect(isMcpAutoApprovalEnforcedBySource(configured)).toBe(true)
    expect(resolveMcpSourceToolAccess(configured, { name: 'new_tool' }).approval).toBe('prompt')
    expect(isMcpAutoApprovalEnforcedBySource({ ...server, disabledAutoApproveTools: ['mcp__other__*'] })).toBe(false)
    expect(isMcpAutoApprovalEnforcedBySource({ ...server, disabledAutoApproveTools: ['search_docs'] })).toBe(false)
  })

  it('defaults Skill reads to prompting and keeps each exact URI independent', () => {
    const uri = 'skill://reports/SKILL.md'
    const configured = {
      ...server,
      skillPermissions: { [uri]: 'auto' as const, 'skill://other/SKILL.md': 'disabled' as const }
    }
    expect(resolveMcpSourceSkillAccess(server, uri)).toEqual({ enabled: true, approval: 'prompt' })
    expect(resolveMcpSourceSkillAccess(configured, uri)).toEqual({ enabled: true, approval: 'auto' })
    expect(resolveMcpSourceSkillAccess(configured, 'skill://other/SKILL.md')).toEqual({
      enabled: false,
      approval: 'prompt'
    })
    expect(resolveMcpSourceSkillAccess(configured, 'skill://new/SKILL.md')).toEqual({
      enabled: true,
      approval: 'prompt'
    })
  })

  it('matches raw name, current id, legacy id, and server wildcard', () => {
    expect(matchesMcpSourceToolRule('search_docs', server, tool)).toBe(true)
    expect(matchesMcpSourceToolRule(tool.id, server, tool)).toBe(true)
    expect(matchesMcpSourceToolRule('mcp__docs__searchDocs', server, tool)).toBe(true)
    expect(matchesMcpSourceToolRule('mcp__docs__*', server, tool)).toBe(true)
    expect(matchesMcpSourceToolRule('mcp__other__searchDocs', server, tool)).toBe(false)
  })

  it('resolves disabled before force prompt', () => {
    const configured = {
      ...server,
      disabledTools: ['search_docs'],
      disabledAutoApproveTools: ['mcp__docs__searchDocs']
    } as McpServer

    expect(isMcpToolDisabledBySource(configured, tool)).toBe(true)
    expect(isMcpToolForcePromptBySource(configured, tool)).toBe(true)
    expect(resolveMcpSourceToolAccess(configured, tool)).toEqual({ enabled: false, approval: 'prompt' })
  })

  it('resolves source force-prompt for auto-approval opt-out', () => {
    expect(resolveMcpSourceToolAccess({ ...server, disabledAutoApproveTools: ['search_docs'] }, tool)).toEqual({
      enabled: true,
      approval: 'prompt'
    })
  })
})
