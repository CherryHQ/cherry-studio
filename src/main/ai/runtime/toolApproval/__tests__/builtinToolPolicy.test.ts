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

describe('builtinToolPolicy', () => {
  it('gives every entry one unique canonical MCP identity', () => {
    const runtimeNames = listBuiltinToolPolicies().map(toMcpRuntimeName)
    expect(new Set(runtimeNames).size).toBe(runtimeNames.length)
  })

  it('stores approval behavior on each tool entry instead of parallel name lists', () => {
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(KB_MANAGE_TOOL_NAME), false)?.approval).toBe('required')
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(CLI_INSTALL_TOOL_NAME), false)?.approval).toBe('required')
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(CLI_LIST_TOOL_NAME), false)?.approval).toBe('auto')
    expect(findBuiltinToolPolicy('mcp__skills__install_skill', false)?.approval).toBe('runtime')
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(SESSION_SEND_TOOL_NAME), false)).toMatchObject({
      approval: 'required',
      bypassApproval: 'enforce'
    })
  })

  it('filters Assistant-only entries when their MCP servers are not mounted', () => {
    expect(findBuiltinToolPolicy('mcp__assistant__diagnose', false)).toBeUndefined()
    expect(findBuiltinToolPolicy('mcp__assistant__diagnose', true)?.approval).toBe('required')
    expect(
      listBuiltinToolPolicies({ assistantMcpEnabled: false }).every((entry) => entry.availability === 'always')
    ).toBe(true)
  })

  it('does not auto-approve an undeclared future tool', () => {
    expect(findBuiltinToolPolicy('mcp__cherry-tools__future_mutator', false)).toBeUndefined()
    expect(
      listBuiltinToolPolicies({ approval: 'auto', assistantMcpEnabled: false })
        .map(toMcpRuntimeName)
        .includes('mcp__cherry-tools__future_mutator')
    ).toBe(false)
  })
})
