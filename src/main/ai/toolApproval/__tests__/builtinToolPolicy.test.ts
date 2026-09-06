import { CLI_INSTALL_TOOL_NAME, CLI_LIST_TOOL_NAME } from '@main/ai/mcp/servers/cherryCliTools'
import { SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { KB_MANAGE_TOOL_NAME } from '@shared/ai/builtinTools'
import { describe, expect, it } from 'vitest'

import {
  findBuiltinToolPolicy,
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '../builtinToolPolicy'

const WITHOUT_HOST_TOOLS: ReadonlySet<string> = new Set(['cherry-tools', 'agent-memory', 'skills', 'mcp-manager'])
const WITH_HOST_TOOLS: ReadonlySet<string> = new Set([...WITHOUT_HOST_TOOLS, 'assistant', 'assistant-files'])

describe('builtinToolPolicy', () => {
  it('gives every entry one unique canonical MCP identity', () => {
    const runtimeNames = listBuiltinToolPolicies().map(toMcpRuntimeName)
    expect(new Set(runtimeNames).size).toBe(runtimeNames.length)
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
