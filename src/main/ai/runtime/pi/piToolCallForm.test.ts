import { describe, expect, it } from 'vitest'

import { resolvePiToolCallForm } from './piToolCallForm'

const call = (disabled: string[], toolSearchLoadsMcp: boolean) => {
  const form = resolvePiToolCallForm(new Set(disabled), { toolSearchLoadsMcp })
  return form && `${form.ref('cherry-tools', 'agent_create')}${form.hint}`
}

// Catches guidance that sends the model to a discovery tool the session does not have active.
describe('resolvePiToolCallForm', () => {
  it.each([
    ['Pi', false],
    ['Pi Durable', true]
  ])('calls Cherry tools from a codemode script on %s while codemode is on', (_runtime, toolSearchLoadsMcp) => {
    const text = call([], toolSearchLoadsMcp)

    expect(text).toContain('`await tools.mcp__cherry_tools__agent_create({ ... })`')
    expect(text).toContain('codemode')
    expect(text).not.toContain('tool_search')
  })

  it('loads Cherry tools with tool_search on Pi Durable once codemode is disabled', () => {
    const text = call(['codemode'], true)

    expect(text).toContain('`mcp__cherry_tools__agent_create`')
    expect(text).toContain('tool_search')
    expect(text).not.toContain('codemode')
  })

  it.each([
    ['Pi without codemode, whose tool_search cannot load MCP tools', ['codemode'], false],
    ['Pi Durable without codemode or tool_search', ['codemode', 'tool_search'], true]
  ])('names no call form for %s', (_case, disabled, toolSearchLoadsMcp) => {
    expect(call(disabled, toolSearchLoadsMcp)).toBeUndefined()
  })
})
