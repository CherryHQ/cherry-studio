import { describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { CLI_INSTALL_TOOL_NAME, CLI_LIST_TOOL_NAME } from '@main/ai/mcp/servers/cherryCliTools'
import { SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { KB_MANAGE_TOOL_NAME } from '@shared/ai/builtinTools'

import {
  findBuiltinToolPolicy,
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '../builtinToolPolicy'

const WITHOUT_HOST_TOOLS: ReadonlySet<string> = new Set(['cherry-tools', 'agent-memory', 'skills', 'mcp-manager'])
const WITH_HOST_TOOLS: ReadonlySet<string> = new Set([...WITHOUT_HOST_TOOLS, 'assistant', 'assistant-files'])

describe('builtinToolPolicy', () => {
  it('queries static policies before preferences are available', () => {
    const get = vi.spyOn(application.get('PreferenceService'), 'get').mockImplementation(() => {
      throw new Error('Preferences are not initialized')
    })
    try {
      expect(listBuiltinToolPolicies({ approval: 'auto' }).map(toMcpRuntimeName)).toContain('mcp__assistant__navigate')
      expect(findBuiltinToolPolicy('mcp__browser__click', WITHOUT_HOST_TOOLS)).toBeUndefined()
    } finally {
      get.mockRestore()
    }
  })

  it('resolves mounted browser policies from current preferences without auto-approving unknown tools', async () => {
    const preferences = application.get('PreferenceService')
    const mountedServers = new Set(['browser'])
    await preferences.set('app.browser.agent_control.enabled', true)
    await preferences.set('app.browser.tool_permissions', { click: 'allow' })
    expect(listBuiltinToolPolicies({ approval: 'auto', mountedServers }).map(toMcpRuntimeName)).toEqual([
      'mcp__browser__click'
    ])
    await preferences.set('app.browser.tool_permissions', { click: 'ask' })
    expect(listBuiltinToolPolicies({ approval: 'auto', mountedServers })).toEqual([])
    expect(findBuiltinToolPolicy('mcp__browser__click', mountedServers)).toMatchObject({
      approval: 'required',
      bypassApproval: 'lift'
    })
    await preferences.set('app.browser.tool_permissions', { click: 'allow' })
    await preferences.set('app.browser.agent_control.enabled', false)
    expect(findBuiltinToolPolicy('mcp__browser__click', mountedServers)?.approval).toBe('required')
    expect(findBuiltinToolPolicy('mcp__browser__future_tool', mountedServers)).toBeUndefined()
    expect(
      listBuiltinToolPolicies({ mountedServers: WITHOUT_HOST_TOOLS }).some((entry) => entry.serverName === 'browser')
    ).toBe(false)
  })

  it('stores approval behavior on each tool entry instead of parallel name lists', () => {
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(KB_MANAGE_TOOL_NAME), WITHOUT_HOST_TOOLS)?.approval).toBe(
      'required'
    )
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(CLI_INSTALL_TOOL_NAME), WITHOUT_HOST_TOOLS)?.approval).toBe(
      'required'
    )
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(CLI_LIST_TOOL_NAME), WITHOUT_HOST_TOOLS)?.approval).toBe(
      'auto'
    )
    expect(findBuiltinToolPolicy('mcp__skills__install_skill', WITHOUT_HOST_TOOLS)?.approval).toBe('runtime')
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(SESSION_SEND_TOOL_NAME), WITHOUT_HOST_TOOLS)).toMatchObject(
      {
        approval: 'required',
        bypassApproval: 'enforce'
      }
    )
  })

  it('filters Assistant-only entries when their MCP servers are not mounted', () => {
    expect(findBuiltinToolPolicy('mcp__assistant__diagnose', WITHOUT_HOST_TOOLS)).toBeUndefined()
    expect(findBuiltinToolPolicy('mcp__assistant__diagnose', WITH_HOST_TOOLS)?.approval).toBe('required')
    expect(
      listBuiltinToolPolicies({ mountedServers: WITHOUT_HOST_TOOLS }).every((entry) =>
        WITHOUT_HOST_TOOLS.has(entry.serverName)
      )
    ).toBe(true)
  })

  it('auto-approves preparing a diagnostic draft because it has no side effects', () => {
    expect(findBuiltinToolPolicy('mcp__assistant__prepare_diagnostic_report', WITH_HOST_TOOLS)).toMatchObject({
      approval: 'auto'
    })
  })

  it('does not auto-approve an undeclared future tool', () => {
    expect(findBuiltinToolPolicy('mcp__cherry-tools__future_mutator', WITHOUT_HOST_TOOLS)).toBeUndefined()
    expect(
      listBuiltinToolPolicies({ approval: 'auto', mountedServers: WITHOUT_HOST_TOOLS })
        .map(toMcpRuntimeName)
        .includes('mcp__cherry-tools__future_mutator')
    ).toBe(false)
  })
})
