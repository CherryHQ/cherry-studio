/**
 * The `cherry-tools` MCP server (injected into every Claude Code session by buildMcpServers)
 * exposes `report_artifacts`. buildSystemPrompt MUST append REPORT_ARTIFACTS_PROMPT so the model
 * is told to call that tool at task completion — otherwise it is a dangling, never-invoked tool.
 */

import type * as NodeFs from 'node:fs'

import { CHANNEL_SECURITY_PROMPT } from '@shared/ai/claudecode/constants'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFindBySessionId,
  mockMkdir,
  mockRealpath,
  mockGetPath,
  mockApplicationGet,
  mockGetBuiltinAgentPluginDirectory,
  mockLoadBuiltinAgentDefinition,
  mockProvisionBuiltinAgent,
  mockBuildMemoriesSection,
  mockGetAppLanguage,
  mockBuildPrompt
} = vi.hoisted(() => ({
  mockFindBySessionId: vi.fn(),
  mockMkdir: vi.fn(),
  mockRealpath: vi.fn(),
  mockGetPath: vi.fn(() => '/tmp/managed-workspaces'),
  mockApplicationGet: vi.fn(),
  mockGetBuiltinAgentPluginDirectory: vi.fn(),
  mockLoadBuiltinAgentDefinition: vi.fn(),
  mockProvisionBuiltinAgent: vi.fn(),
  mockBuildMemoriesSection: vi.fn(),
  mockGetAppLanguage: vi.fn(() => 'en-US'),
  mockBuildPrompt: vi.fn().mockResolvedValue({ base: { kind: 'claude_code' }, context: 'SOUL_PROMPT' })
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof NodeFs
  return {
    ...actual,
    default: actual,
    promises: { ...actual.promises, mkdir: mockMkdir, realpath: mockRealpath }
  }
})

vi.mock('@application', () => ({
  application: { get: mockApplicationGet, getPath: mockGetPath }
}))

vi.mock('@main/i18n', () => ({
  getAppLanguage: mockGetAppLanguage,
  t: vi.fn((key: string) => key)
}))

vi.mock('@main/ai/mcp/servers/cherryBuiltinTools', () => ({
  default: vi.fn(() => ({ mcpServer: { id: 'cherry-tools' } }))
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { findBySessionId: mockFindBySessionId, listChannels: vi.fn().mockResolvedValue([]) }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { list: vi.fn(() => ({ items: [] })) }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { list: vi.fn(() => []) }
}))

vi.mock('@main/ai/agents/builtin/BuiltinAgentProvisioner', () => ({
  getBuiltinAgentPluginDirectory: mockGetBuiltinAgentPluginDirectory,
  loadBuiltinAgentDefinition: mockLoadBuiltinAgentDefinition,
  provisionBuiltinAgent: mockProvisionBuiltinAgent
}))

vi.mock('@main/ai/agents/prompt', () => ({
  PromptBuilder: vi.fn(() => ({
    buildPromptParts: mockBuildPrompt,
    buildMemoriesSection: mockBuildMemoriesSection
  }))
}))

const { buildSystemPrompt } = await import('../settingsBuilder')

const ARTIFACTS_MARKER = '## Reporting deliverables'
const RUNTIME_MARKER = '## Available Runtimes'
const WORKSPACE_MARKER = '## Current Workspace'

beforeEach(() => {
  vi.unstubAllGlobals()
  mockApplicationGet.mockReturnValue({ get: vi.fn(() => undefined) })
  mockFindBySessionId.mockReturnValue(null)
  mockLoadBuiltinAgentDefinition.mockReset()
  mockProvisionBuiltinAgent.mockReset()
  mockBuildMemoriesSection.mockReset().mockResolvedValue(undefined)
  mockBuildPrompt.mockReset().mockResolvedValue({ base: { kind: 'claude_code' }, context: 'SOUL_PROMPT' })
  mockGetAppLanguage.mockReturnValue('en-US')
})

function makeSession(path = '/workspace/assistant', type: 'system' | 'user' = 'system'): AgentSessionEntity {
  return { id: 'sess-1', agentId: 'agent-1', workspace: { path, type } } as unknown as AgentSessionEntity
}

function makeAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return { id: 'agent-1', mcps: [], configuration: {}, ...overrides } as unknown as AgentEntity
}

function promptText(prompt: Awaited<ReturnType<typeof buildSystemPrompt>>): string {
  if (typeof prompt === 'string') return prompt
  if (Array.isArray(prompt)) return prompt.join('\n')
  return prompt?.append ?? ''
}

function expectClaudeCodePreset(prompt: Awaited<ReturnType<typeof buildSystemPrompt>>): string {
  expect(prompt).toMatchObject({ type: 'preset', preset: 'claude_code' })
  return promptText(prompt)
}

describe('buildSystemPrompt — current workspace', () => {
  it('loads prompt identity and memory from agent data while leaving cwd context to the preset', async () => {
    const result = await buildSystemPrompt(
      makeSession(),
      makeAgent(),
      '/workspace/project-a',
      false,
      '/data/Agents/agent-1'
    )

    expect(mockBuildPrompt).toHaveBeenCalledWith(
      '/workspace/project-a',
      expect.anything(),
      false,
      '/data/Agents/agent-1'
    )
    expect(result).toMatchObject({ type: 'preset', preset: 'claude_code' })
    expect(promptText(result)).not.toContain(WORKSPACE_MARKER)
    expect(promptText(result)).not.toContain('"/workspace/project-a"')
  })

  it('does not duplicate the preset-owned workspace context for regular agents', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent(), '/workspace/project-a')

    const text = expectClaudeCodePreset(result)
    expect(text).not.toContain(WORKSPACE_MARKER)
    expect(text).not.toContain('"/workspace/project-a"')
  })

  it('does not duplicate the preset-owned workspace context for the built-in assistant', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(makeSession(), agent, '/workspace/assistant')

    expect(promptText(result)).not.toContain(WORKSPACE_MARKER)
    expect(promptText(result)).not.toContain('"/workspace/assistant"')
  })

  it('resolves the workspace dynamically for every custom system.md build', async () => {
    const agent = makeAgent()
    mockBuildPrompt.mockResolvedValue({
      base: { kind: 'custom', content: 'CUSTOM SYSTEM PROMPT' },
      context: 'SOUL_PROMPT'
    })

    const first = await buildSystemPrompt(makeSession(), agent, '/workspace/project-a')
    const second = await buildSystemPrompt(makeSession(), agent, '/workspace/project-b')

    expect(first).toContain('"/workspace/project-a"')
    expect(first).not.toContain('"/workspace/project-b"')
    expect(second).toContain('"/workspace/project-b"')
    expect(second).not.toContain('"/workspace/project-a"')
  })

  it('replaces only the Claude Code base with system.md and retains Cherry context', async () => {
    mockBuildPrompt.mockResolvedValueOnce({
      base: { kind: 'custom', content: 'CUSTOM SYSTEM PROMPT' },
      context: 'SOUL_PROMPT'
    })

    const result = await buildSystemPrompt(
      makeSession(),
      makeAgent({ instructions: 'Agent instructions.' }),
      '/tmp/cwd'
    )

    expect(typeof result).toBe('string')
    expect(result).toMatch(/^CUSTOM SYSTEM PROMPT\n\nSOUL_PROMPT/)
    expect(result).toContain('Agent instructions.')
    expect(result).toContain(WORKSPACE_MARKER)
    expect(result).toContain(ARTIFACTS_MARKER)
    expect(result).toContain(RUNTIME_MARKER)
  })

  it('treats an empty system.md as a custom base and still retains Cherry context', async () => {
    mockBuildPrompt.mockResolvedValueOnce({ base: { kind: 'custom', content: '' }, context: 'SOUL_PROMPT' })

    const result = await buildSystemPrompt(
      makeSession(),
      makeAgent({ instructions: 'Agent instructions.' }),
      '/tmp/cwd'
    )

    expect(typeof result).toBe('string')
    expect(result).toMatch(/^SOUL_PROMPT/)
    expect(result).toContain('Agent instructions.')
    expect(result).toContain(WORKSPACE_MARKER)
  })
})

describe('buildSystemPrompt — report_artifacts prompt', () => {
  beforeEach(() => {
    mockFindBySessionId.mockReturnValue(null)
  })

  it('appends the report_artifacts prompt to the Claude Code preset with user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent({ instructions: 'Do the task.' }), '/tmp/cwd')
    const text = expectClaudeCodePreset(result)
    expect(text).toContain('SOUL_PROMPT')
    expect(text).toContain('Do the task.')
    expect(text).toContain(ARTIFACTS_MARKER)
  })

  it('appends the report_artifacts prompt without user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent(), '/tmp/cwd')
    expect(expectClaudeCodePreset(result)).toContain(ARTIFACTS_MARKER)
  })

  it('appends it for the Cherry Assistant like every other Agent', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })
    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')
    expect(promptText(result)).toContain(ARTIFACTS_MARKER)
  })
})

describe('buildSystemPrompt — bundled-runtime guidance', () => {
  beforeEach(() => {
    mockFindBySessionId.mockReturnValue(null)
  })

  it('steers the agent to bun/uv with user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent({ instructions: 'Do the task.' }), '/tmp/cwd')
    expect(promptText(result)).toContain(RUNTIME_MARKER)
    // The model is told to use bun / uv explicitly, not node/npm/pip.
    expect(promptText(result)).toContain('bun')
    expect(promptText(result)).toContain('uv run python')
  })

  it('steers the agent to bun/uv without user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent(), '/tmp/cwd')
    expect(promptText(result)).toContain(RUNTIME_MARKER)
  })

  it('routes reusable CLI installation through managed tools without blocking ordinary downloads', async () => {
    const result = promptText(await buildSystemPrompt(makeSession(), makeAgent(), '/tmp/cwd'))

    expect(result).toContain('Call `cli_list` before assuming a reusable CLI is unavailable')
    expect(result).toContain('Install reusable CLIs only with `cli_install`')
    expect(result).toContain('read trusted public documentation')
    expect(result).toContain('Do not run remote `curl`/`wget` install scripts for reusable CLIs')
    expect(result).toContain('remain available for APIs, data, documentation, and project files')
    expect(mockApplicationGet).not.toHaveBeenCalledWith('BinaryManager')
  })

  it('injects the same runtime block for the Cherry Assistant', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })
    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')
    expect(promptText(result)).toContain(RUNTIME_MARKER)
  })
})

describe('buildSystemPrompt — builtin Cherry Assistant definition', () => {
  beforeEach(() => {
    mockFindBySessionId.mockReturnValue(null)
  })

  it('uses the normal Agent prompt pipeline without a restrictive runtime overlay', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = promptText(await buildSystemPrompt(makeSession(), agent, '/tmp/cwd'))

    expect(result).toContain('SOUL_PROMPT')
    expect(result).toContain('Assistant instructions.')
    expect(result).toContain(RUNTIME_MARKER)
    expect(result).toContain(ARTIFACTS_MARKER)
    expect(result).not.toContain('Non-negotiable Cherry Assistant contract')
  })

  it('uses the bundled template when DB instructions are empty and resolves it on every build', async () => {
    mockLoadBuiltinAgentDefinition
      .mockReturnValueOnce({ instructions: 'English bundled instructions' })
      .mockReturnValueOnce({ instructions: '中文内置指令' })
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'assistant' } as never })

    const en = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')
    const zh = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(promptText(en)).toContain('English bundled instructions')
    expect(promptText(zh)).toContain('中文内置指令')
    expect(mockLoadBuiltinAgentDefinition).toHaveBeenCalledTimes(2)
  })

  it('initializes persona and memory resources in agent data on every build', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const session = makeSession('/workspace/assistant', 'system')
    await buildSystemPrompt(session, agent, '/workspace/assistant', false, '/data/Agents/agent-1')
    await buildSystemPrompt(session, agent, '/workspace/assistant', false, '/data/Agents/agent-1')

    expect(mockProvisionBuiltinAgent).toHaveBeenCalledTimes(2)
    expect(mockProvisionBuiltinAgent).toHaveBeenNthCalledWith(1, '/data/Agents/agent-1', 'assistant')
    expect(mockProvisionBuiltinAgent).toHaveBeenNthCalledWith(2, '/data/Agents/agent-1', 'assistant')
  })

  it('provisions agent data instead of a user workspace', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    await buildSystemPrompt(
      makeSession('/workspace/project', 'user'),
      agent,
      '/workspace/project',
      false,
      '/data/Agents/agent-1'
    )

    expect(mockProvisionBuiltinAgent).toHaveBeenCalledWith('/data/Agents/agent-1', 'assistant')
    expect(mockProvisionBuiltinAgent).not.toHaveBeenCalledWith('/workspace/project', 'assistant')
  })

  it('loads the built-in Assistant through the normal identity and memory prompt pipeline', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(makeSession(), agent, '/workspace/assistant', false, '/data/Agents/agent-1')

    expect(promptText(result)).toContain('SOUL_PROMPT')
    expect(mockBuildPrompt).toHaveBeenCalledWith(
      '/workspace/assistant',
      expect.anything(),
      true,
      '/data/Agents/agent-1'
    )
    expect(mockProvisionBuiltinAgent.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildPrompt.mock.invocationCallOrder[0]
    )
  })

  it('does not make network requests while building an assistant prompt', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses user-owned DB instructions when non-empty', async () => {
    mockLoadBuiltinAgentDefinition.mockReturnValue({ instructions: 'Bundled instructions' })
    const agent = makeAgent({
      instructions: 'User instructions',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(promptText(result)).toContain('User instructions')
    expect(promptText(result)).not.toContain('Bundled instructions')
    expect(mockLoadBuiltinAgentDefinition).not.toHaveBeenCalled()
  })

  it('uses a minimal role fallback when the bundled template is missing and DB instructions are empty', async () => {
    mockLoadBuiltinAgentDefinition.mockReturnValue(undefined)
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'assistant' } as never })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(promptText(result)).toContain('built-in general-purpose Agent and onboarding guide')
  })

  it('applies the external channel security policy for linked assistant sessions', async () => {
    mockFindBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'sess-1' })
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(promptText(result)).toContain(CHANNEL_SECURITY_PROMPT)
  })

  it('does not apply the external channel security policy for unlinked assistant sessions', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(promptText(result)).not.toContain(CHANNEL_SECURITY_PROMPT)
  })

  it('injects the bundled Assistant role exactly once', async () => {
    const role = 'Within Cherry Studio, you serve as Cherry Assistant, its built-in general-purpose Agent'
    mockLoadBuiltinAgentDefinition.mockReturnValue({ instructions: role })
    mockBuildPrompt.mockResolvedValue({
      base: { kind: 'claude_code' },
      context: '## Personality\n\nFriendly and concise.'
    })
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'assistant' } as never })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(promptText(result).split(role)).toHaveLength(2)
  })
})
