import { describe, expect, it } from 'vitest'

import { DEFAULT_ASSISTANT_TOOL_NAMES } from '@main/ai/toolApproval/assistantToolNames'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_TYPES, type AgentType } from '@shared/data/api/schemas/agents'

import {
  hostToolsEnabled,
  resolveAgentCapabilities,
  resolveHostTools,
  resolveMountedMcpServers
} from '../builtinAgentCapabilities'

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
    expect(DEFAULT_ASSISTANT_TOOL_NAMES).toContain('prepare_diagnostic_report')
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
    }
  })

  it.each(AGENT_TYPES)('never grants host tools to an ordinary Agent on %s', (type) => {
    expect(hostToolsEnabled(agentOf(type), { channelLinked: false })).toBe(false)
    expect(hostToolsEnabled(agentOf(type), { channelLinked: true })).toBe(false)
  })
})

describe('ordinary claude-code attachment reads', () => {
  it('mounts read-only assistant-files for an ordinary open claude-code agent and withholds host tools', () => {
    // Bug: ordinary open Claude Code agents never mounted assistant-files, so audio/video stayed a path.
    const mounted = resolveMountedMcpServers(agentOf('claude-code'), { channelLinked: false })

    expect(mounted.has('assistant-files')).toBe(true)
    expect(mounted.has('assistant')).toBe(false)
    expect(hostToolsEnabled(agentOf('claude-code'), { channelLinked: false })).toBe(false)
  })

  it('keeps the same read-only file server for a channel-linked ordinary claude-code agent', () => {
    // Bug: channel linking must not add mutating file tools, and must not drop the read tool either.
    const mounted = resolveMountedMcpServers(agentOf('claude-code'), { channelLinked: true })

    expect(mounted.has('assistant-files')).toBe(true)
    expect(mounted.has('assistant')).toBe(false)
  })

  it('does not mount assistant-files for ordinary Pi agents', () => {
    expect(resolveMountedMcpServers(agentOf('pi'), { channelLinked: false }).has('assistant-files')).toBe(false)
    expect(resolveMountedMcpServers(agentOf('pi'), { channelLinked: true }).has('assistant-files')).toBe(false)
  })

  it('mounts assistant-files for the built-in Assistant on Pi and withholds it when that session is channel-linked', () => {
    const local = resolveMountedMcpServers(agentOf('pi', BUILTIN_AGENT_ROLE.ASSISTANT), { channelLinked: false })
    const linked = resolveMountedMcpServers(agentOf('pi', BUILTIN_AGENT_ROLE.ASSISTANT), { channelLinked: true })

    expect(local.has('assistant')).toBe(true)
    expect(local.has('assistant-files')).toBe(true)
    expect(linked.has('assistant')).toBe(false)
    expect(linked.has('assistant-files')).toBe(false)
  })

  it('does not mount assistant-files for Doctor or a channel-linked Assistant', () => {
    // Bug: files:false and channel-linked host privilege must not gain the file server.
    const doctor = resolveMountedMcpServers(agentOf('claude-code', BUILTIN_AGENT_ROLE.DOCTOR), { channelLinked: false })
    const linkedAssistant = resolveMountedMcpServers(agentOf('claude-code', BUILTIN_AGENT_ROLE.ASSISTANT), {
      channelLinked: true
    })

    expect(doctor.has('assistant')).toBe(true)
    expect(doctor.has('assistant-files')).toBe(false)
    expect(linkedAssistant.has('assistant')).toBe(false)
    expect(linkedAssistant.has('assistant-files')).toBe(false)
  })

  it('keeps Support on its existing host file server without granting a second surface', () => {
    const support = resolveMountedMcpServers(agentOf('claude-code', BUILTIN_AGENT_ROLE.SUPPORT), {
      channelLinked: false
    })

    expect(support.has('assistant')).toBe(true)
    expect(support.has('assistant-files')).toBe(true)
  })

  it.each(['mcp__assistant-files__read_file', 'mcp__assistant-files', 'mcp__assistant-files__*', 'mcp__*'])(
    'leaves assistant-files unmounted when an ordinary agent disables read_file via %s',
    (rule) => {
      // Bug: a disabled read_file must not stay mounted. Rules match the existing MCP allowlist.
      const mounted = resolveMountedMcpServers(
        { type: 'claude-code', configuration: {}, disabledTools: [rule] } as never,
        { channelLinked: false }
      )

      expect(mounted.has('assistant-files')).toBe(false)
      expect(mounted.has('assistant')).toBe(false)
    }
  )

  it('keeps the read-only server mounted when only the bare read_file name is disabled', () => {
    const mounted = resolveMountedMcpServers(
      { type: 'claude-code', configuration: {}, disabledTools: ['read_file'] } as never,
      { channelLinked: false }
    )

    expect(mounted.has('assistant-files')).toBe(true)
  })
})

describe('Agent browser mounting', () => {
  it.each(AGENT_TYPES)('honors the built-in browser opt-out on %s', (type) => {
    expect(
      resolveMountedMcpServers(
        { type, configuration: {}, disabledTools: ['mcp__browser'] },
        {
          channelLinked: false,
          browserEnabled: true
        }
      ).has('automation')
    ).toBe(false)
  })
  it.each(AGENT_TYPES)('requires enabled control and an interactive open environment on %s', (type) => {
    expect(
      resolveMountedMcpServers(agentOf(type), { channelLinked: false, browserEnabled: true }).has('automation')
    ).toBe(true)
    expect(resolveMountedMcpServers(agentOf(type), { channelLinked: false }).has('automation')).toBe(false)
    expect(
      resolveMountedMcpServers(agentOf(type), { channelLinked: true, browserEnabled: true }).has('automation')
    ).toBe(false)
    expect(
      resolveMountedMcpServers(agentOf(type, BUILTIN_AGENT_ROLE.SUPPORT), {
        channelLinked: false,
        browserEnabled: true
      }).has('automation')
    ).toBe(false)
  })
})

describe('Agent memory mounting', () => {
  it.each(AGENT_TYPES)('mounts memory by default on %s', (type) => {
    expect(resolveMountedMcpServers(agentOf(type), { channelLinked: false }).has('agent-memory')).toBe(true)
  })

  it.each([
    'mcp__agent-memory__memory',
    'mcp__agent_memory__memory',
    'mcp__agent-memory',
    'mcp__agent_memory',
    'mcp__agent-memory__*',
    'mcp__agent_memory__*',
    'mcp__*'
  ])('unmounts memory when disabled by %s on every runtime', (rule) => {
    for (const type of AGENT_TYPES) {
      const mounted = resolveMountedMcpServers(
        { type, configuration: {}, disabledTools: [rule] },
        { channelLinked: false }
      )
      expect(mounted.has('agent-memory')).toBe(false)
    }
  })

  it.each(AGENT_TYPES)('keeps memory mounted when an unrelated tool is disabled on %s', (type) => {
    expect(
      resolveMountedMcpServers(
        { type, configuration: {}, disabledTools: ['mcp__cherry-tools__notify'] },
        { channelLinked: false }
      ).has('agent-memory')
    ).toBe(true)
  })
})
