import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_TYPES, type AgentType } from '@shared/data/api/schemas/agents'
import { describe, expect, it } from 'vitest'

import { hostToolsEnabled, resolveAgentCapabilities, resolveHostTools } from '../builtinAgentCapabilities'

const agentOf = (type: AgentType, builtinRole?: string) =>
  ({ type, configuration: builtinRole ? { builtin_role: builtinRole } : {} }) as never

describe('resolveAgentCapabilities', () => {
  it('gives an Agent with no built-in role the unprivileged defaults', () => {
    expect(resolveAgentCapabilities({ configuration: {} })).toEqual({
      environment: 'open',
      allKnowledgeBases: false
    })
  })

  it('does not grant host tools to an unrecognized role', () => {
    const capabilities = resolveAgentCapabilities({ configuration: { builtin_role: 'assistantt' } as never })
    expect(capabilities.hostTools).toBeUndefined()
    expect(capabilities.allKnowledgeBases).toBe(false)
  })

  it('closes Cherry Support to its own bundle', () => {
    const capabilities = resolveAgentCapabilities({ configuration: { builtin_role: BUILTIN_AGENT_ROLE.SUPPORT } })
    expect(capabilities.environment).toBe('sealed')
  })

  it('withholds arbitrary Agent creation from Cherry Support', () => {
    const support = resolveAgentCapabilities({ configuration: { builtin_role: BUILTIN_AGENT_ROLE.SUPPORT } })
    const assistant = resolveAgentCapabilities({ configuration: { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT } })

    expect(support.hostTools?.tools).not.toContain('create_agent')
    // Assistant declares no subset, so the server uses the default tool set.
    expect(assistant.hostTools?.tools).toBeUndefined()
  })

  it('keeps diagnostic draft preparation in the reusable channel-linked Support tool set', () => {
    const support = resolveAgentCapabilities({ configuration: { builtin_role: BUILTIN_AGENT_ROLE.SUPPORT } })
    const assistant = resolveAgentCapabilities({ configuration: { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT } })
    const channelLinkedSupportTools = resolveHostTools(agentOf('claude-code', BUILTIN_AGENT_ROLE.SUPPORT), {
      channelLinked: true
    })
    const expectedSupportTools = ['navigate', 'diagnose', 'product_info', 'apply_setting', 'prepare_diagnostic_report']

    expect(support.hostTools?.tools).toEqual(expectedSupportTools)
    expect(channelLinkedSupportTools?.tools).toEqual(expectedSupportTools)
    expect(assistant.hostTools?.tools).toBeUndefined()
  })
})

describe('hostToolsEnabled', () => {
  it.each(AGENT_TYPES)('keeps host tools off channel-linked Cherry Assistant sessions on %s', (type) => {
    expect(hostToolsEnabled(agentOf(type, BUILTIN_AGENT_ROLE.ASSISTANT), { channelLinked: false })).toBe(true)
    expect(hostToolsEnabled(agentOf(type, BUILTIN_AGENT_ROLE.ASSISTANT), { channelLinked: true })).toBe(false)
  })

  it('keeps Cherry Support host tools on channel-linked sessions, but only on claude-code', () => {
    for (const channelLinked of [false, true]) {
      expect(hostToolsEnabled(agentOf('claude-code', BUILTIN_AGENT_ROLE.SUPPORT), { channelLinked })).toBe(true)
      expect(hostToolsEnabled(agentOf('pi', BUILTIN_AGENT_ROLE.SUPPORT), { channelLinked })).toBe(false)
      expect(hostToolsEnabled(agentOf('dsh', BUILTIN_AGENT_ROLE.SUPPORT), { channelLinked })).toBe(false)
    }
  })

  it.each(AGENT_TYPES)('never grants host tools to an ordinary Agent on %s', (type) => {
    expect(hostToolsEnabled(agentOf(type), { channelLinked: false })).toBe(false)
    expect(hostToolsEnabled(agentOf(type), { channelLinked: true })).toBe(false)
  })
})
