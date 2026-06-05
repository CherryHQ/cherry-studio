import { describe, expect, it } from 'vitest'

import type { McpServer } from '../../../data/types/mcpServer'
import {
  isMcpToolDisabledBySource,
  isMcpToolForcePromptBySource,
  matchesMcpSourceToolRule,
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
  id: 'mcp__docs__searchDocs',
  name: 'search_docs'
}

describe('mcpSourcePolicy', () => {
  it('matches raw tool name, generated wire id, and server wildcard', () => {
    expect(matchesMcpSourceToolRule('search_docs', server, tool)).toBe(true)
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
    expect(
      resolveMcpSourceToolAccess({ ...server, disabledAutoApproveTools: ['search_docs'] } as McpServer, tool)
    ).toEqual({
      enabled: true,
      approval: 'prompt'
    })
  })

  // mcp-servers-3: the built-in browser `execute` runs arbitrary model JS against the
  // user's real session; it must ALWAYS require approval, even with auto-approve config.
  it('always force-prompts @cherry/browser execute, regardless of config', () => {
    const browserServer = {
      id: 'browser-id',
      name: '@cherry/browser',
      isActive: true,
      disabledTools: [],
      disabledAutoApproveTools: []
    } as McpServer
    const execute = { id: 'mcp__cherryBrowser__execute', name: 'execute' }

    expect(isMcpToolForcePromptBySource(browserServer, execute)).toBe(true)
    expect(resolveMcpSourceToolAccess(browserServer, execute)).toEqual({ enabled: true, approval: 'prompt' })
    // A non-execute browser tool is unaffected by the built-in policy.
    expect(isMcpToolForcePromptBySource(browserServer, { name: 'open' })).toBe(false)
  })
})
