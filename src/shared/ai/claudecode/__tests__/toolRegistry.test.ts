import { describe, expect, it } from 'vitest'

import { claudeRegistrySdkDescriptors, claudeSdkTypedToolNames } from '../toolRegistry'

describe('claudeRegistrySdkDescriptors', () => {
  const descriptors = claudeRegistrySdkDescriptors()
  const names = new Set(descriptors.map((d) => d.name))

  it('includes non-disabled SDK tools', () => {
    expect(names.has('Bash')).toBe(true)
    expect(names.has('Agent')).toBe(true)
    expect(names.has('Workflow')).toBe(true)
  })

  it('excludes disabled SDK tools and all MCP tools', () => {
    expect(names.has('WebSearch')).toBe(false)
    expect(names.has('NotebookEdit')).toBe(false)
    expect(names.has('mcp__cherry-tools__web_search')).toBe(false)
  })

  it('marks every descriptor as builtin origin', () => {
    expect(descriptors.every((d) => d.origin === 'builtin')).toBe(true)
  })
})

describe('claudeSdkTypedToolNames', () => {
  it('includes union-typed SDK tools and excludes sdkTyped:false + mcp tools', () => {
    const typed = new Set(claudeSdkTypedToolNames())
    expect(typed.has('Bash')).toBe(true)
    expect(typed.has('Workflow')).toBe(true)
    expect(typed.has('Task')).toBe(false) // sdkTyped:false legacy alias
    expect(typed.has('SendMessage')).toBe(false) // sdkTyped:false teams tool
    expect(typed.has('ToolSearch')).toBe(false) // sdkTyped:false meta tool
    expect(typed.has('mcp__cherry-tools__web_search')).toBe(false)
  })
})
