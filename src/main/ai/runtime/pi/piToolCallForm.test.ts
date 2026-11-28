import { describe, expect, it } from 'vitest'

import { buildPiMcpToolName, isPiToolDisabled } from './piMcpExtension'
import { resolvePiToolCallForm } from './piToolCallForm'

const call = (disabled: string[], toolSearchLoadsMcp: boolean) => {
  const form = resolvePiToolCallForm(new Set(disabled), { toolSearchLoadsMcp, allowsTool: () => true })
  return form && `${form.referenceTool('cherry-tools', 'agent_create')} ${form.toolCallHint}`
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

  it.each(['mcp__cherry-tools__agent_create', 'mcp__cherry_tools__agent_create'])(
    'omits the disabled MCP tool for stored identifier %s',
    (disabled) => {
      const form = resolvePiToolCallForm(new Set([disabled]), { toolSearchLoadsMcp: true, allowsTool: () => true })
      expect(form?.referenceTool('cherry-tools', 'agent_create')).toBeUndefined()
      expect(form?.referenceTool('cherry-tools', 'report_artifacts')).toContain('report_artifacts')
    }
  )

  it.each(['kb_search', 'kb_list', 'kb_read'])('follows the Search switch for Cherry %s only', (name) => {
    const searchOff = new Set(['mcp__cherry-tools__kb_search'])
    const cherryName = buildPiMcpToolName('cherry-tools', name)
    const cherryTool = { serverName: 'cherry-tools', serverId: 'cherry-tools', name }
    expect(isPiToolDisabled(searchOff, cherryName, cherryTool)).toBe(true)
    expect(
      isPiToolDisabled(searchOff, buildPiMcpToolName('another-server', name), {
        ...cherryTool,
        serverId: 'another-server'
      })
    ).toBe(false)
    expect(isPiToolDisabled(new Set(['mcp__cherry-tools__kb_manage']), cherryName, cherryTool)).toBe(false)
    expect(isPiToolDisabled(new Set(), cherryName, cherryTool)).toBe(false)
  })

  it('keeps Manage Knowledge controlled by its own switch', () => {
    const name = 'kb_manage'
    const tool = { serverName: 'cherry-tools', name }
    const runtimeName = buildPiMcpToolName(tool.serverName, name)
    expect(isPiToolDisabled(new Set(['mcp__cherry-tools__kb_search']), runtimeName, tool)).toBe(false)
    expect(isPiToolDisabled(new Set(['mcp__cherry-tools__kb_manage']), runtimeName, tool)).toBe(true)
  })

  it.each([
    ['Pi without codemode, whose tool_search cannot load MCP tools', ['codemode'], false],
    ['Pi Durable without codemode or tool_search', ['codemode', 'tool_search'], true]
  ])('names no call form for %s', (_case, disabled, toolSearchLoadsMcp) => {
    expect(call(disabled, toolSearchLoadsMcp)).toBeUndefined()
  })
})
