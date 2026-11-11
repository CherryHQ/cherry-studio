/**
 * The `cherry-tools` MCP server (injected into every Claude Code session by buildMcpServers)
 * exposes `report_artifacts`. buildSystemPrompt MUST append REPORT_ARTIFACTS_PROMPT so the model
 * is told to call that tool at task completion — otherwise it is a dangling, never-invoked tool.
 */

import type * as NodeFs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '@shared/data/api/schemas/agents'

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
  mockBuildPrompt,
  mockReplacePromptVariables
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
  mockBuildPrompt: vi.fn().mockResolvedValue({ base: { kind: 'native' }, context: 'SOUL_PROMPT' }),
  mockReplacePromptVariables: vi.fn(async (prompt: string) => prompt)
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
  PromptBuilder: vi.fn(function () {
    return {
      buildPromptParts: mockBuildPrompt,
      buildMemoriesSection: mockBuildMemoriesSection
    }
  })
}))

vi.mock('@main/utils/prompt', () => ({
  replacePromptVariables: mockReplacePromptVariables
}))

const { buildSystemPrompt } = await import('../settingsBuilder')

beforeEach(() => {
  vi.unstubAllGlobals()
  mockApplicationGet.mockReturnValue({ get: vi.fn(() => undefined) })
  mockFindBySessionId.mockReturnValue(null)
  mockLoadBuiltinAgentDefinition.mockReset()
  mockProvisionBuiltinAgent.mockReset()
  mockBuildMemoriesSection.mockReset().mockResolvedValue(undefined)
  mockBuildPrompt.mockReset().mockResolvedValue({ base: { kind: 'native' }, context: 'SOUL_PROMPT' })
  mockReplacePromptVariables.mockReset().mockImplementation(async (prompt: string) => prompt)
  mockGetAppLanguage.mockReturnValue('en-US')
})

function makeAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return { id: 'agent-1', mcps: [], configuration: {}, ...overrides } as unknown as AgentEntity
}

function promptText(prompt: Awaited<ReturnType<typeof buildSystemPrompt>>): string {
  if (typeof prompt === 'string') return prompt
  if (Array.isArray(prompt)) return prompt.join('\n')
  if (prompt?.type === 'preset') return prompt.append ?? ''
  return Array.isArray(prompt?.prompt) ? prompt.prompt.join('\n') : (prompt?.prompt ?? '')
}

function expectClaudeCodePreset(prompt: Awaited<ReturnType<typeof buildSystemPrompt>>): string {
  expect(prompt).toMatchObject({ type: 'preset', preset: 'claude_code', snapshot: false })
  return promptText(prompt)
}

describe('buildSystemPrompt — current workspace', () => {
  it('resolves the workspace dynamically for every custom system.md build', async () => {
    const agent = makeAgent()
    mockBuildPrompt.mockResolvedValue({
      base: { kind: 'custom', content: 'CUSTOM SYSTEM PROMPT' },
      context: 'SOUL_PROMPT'
    })

    const first = await buildSystemPrompt(agent, '/workspace/project-a')
    const second = await buildSystemPrompt(agent, '/workspace/project-b')

    expect(promptText(first)).toContain('"/workspace/project-a"')
    expect(promptText(first)).not.toContain('"/workspace/project-b"')
    expect(promptText(second)).toContain('"/workspace/project-b"')
    expect(promptText(second)).not.toContain('"/workspace/project-a"')
  })

  it('replaces only the Claude Code base with system.md and retains Cherry context', async () => {
    mockBuildPrompt.mockResolvedValueOnce({
      base: { kind: 'custom', content: 'CUSTOM SYSTEM PROMPT' },
      context: 'SOUL_PROMPT'
    })

    const result = await buildSystemPrompt(makeAgent({ instructions: 'Agent instructions.' }), '/tmp/cwd')

    expect(result).toMatchObject({ type: 'custom', snapshot: false })
    expect(promptText(result)).toContain('CUSTOM SYSTEM PROMPT')
    expect(promptText(result)).toContain('SOUL_PROMPT')
    expect(promptText(result)).toContain('Agent instructions.')
  })

  it('treats an empty system.md as a custom base and still retains Cherry context', async () => {
    mockBuildPrompt.mockResolvedValueOnce({ base: { kind: 'custom', content: '' }, context: 'SOUL_PROMPT' })

    const result = await buildSystemPrompt(makeAgent({ instructions: 'Agent instructions.' }), '/tmp/cwd')

    expect(result).toMatchObject({ type: 'custom', snapshot: false })

    expect(promptText(result)).toContain('SOUL_PROMPT')
    expect(promptText(result)).toContain('Agent instructions.')
  })
})

describe('buildSystemPrompt — Agent System Prompt authority', () => {
  it.each([{ instructions: undefined }, { instructions: '' }, { instructions: '   ' }])(
    'keeps legacy persona role guidance when Agent System Prompt is blank: $instructions',
    async ({ instructions }) => {
      mockBuildPrompt.mockResolvedValueOnce({
        base: { kind: 'native' },
        context: '## Memories\n\n<soul>\nSOUL_ROLE: You are the friendly historian.\n</soul>'
      })

      const text = promptText(await buildSystemPrompt(makeAgent({ instructions }), '/tmp/cwd'))

      expect(text).toContain('SOUL_ROLE: You are the friendly historian.')
    }
  )

  it('resolves Agent System Prompt variables with the embedded Agent model name', async () => {
    mockReplacePromptVariables.mockResolvedValueOnce('Address Alice while using Claude Sonnet 4.5.')
    const agent = makeAgent({
      instructions: 'Address {{username}} while using {{model_name}}.',
      modelName: 'Claude Sonnet 4.5'
    })

    const text = promptText(await buildSystemPrompt(agent, '/tmp/cwd'))

    expect(text).toContain('Address Alice while using Claude Sonnet 4.5.')
    expect(text).not.toContain('{{username}}')
    expect(text).not.toContain('{{model_name}}')
  })

  it('prefers the effective turn model name over the parent agent default for {{model_name}}', async () => {
    mockReplacePromptVariables.mockResolvedValueOnce('Use Claude Opus.')
    const agent = makeAgent({
      instructions: 'Use {{model_name}}.',
      modelName: 'Claude Sonnet 4.5'
    })

    await buildSystemPrompt(agent, '/tmp/cwd', undefined, [], [], undefined, 'Claude Opus')

    expect(mockReplacePromptVariables).toHaveBeenCalledWith('Use {{model_name}}.', 'Claude Opus')

  it('preserves agent instructions, workspace instructions, and persona as distinct sources', async () => {
    mockBuildPrompt.mockResolvedValueOnce({
      base: { kind: 'custom', content: 'WORKSPACE_ROLE: You are the workspace reviewer.' },
      context: '## Memories\n\n<soul>\nSOUL_ROLE: You are the friendly historian.\n</soul>'
    })

    const text = promptText(
      await buildSystemPrompt(makeAgent({ instructions: 'AGENT_ROLE: You are the release manager.' }), '/tmp/cwd')
    )

    expect(text).toContain('WORKSPACE_ROLE: You are the workspace reviewer.')
    expect(text).toContain('SOUL_ROLE: You are the friendly historian.')
    expect(text).toContain('AGENT_ROLE: You are the release manager.')
  })
})

describe('buildSystemPrompt — report_artifacts prompt', () => {
  beforeEach(() => {
    mockFindBySessionId.mockReturnValue(null)
  })

  it('appends the report_artifacts prompt to the Claude Code preset with user instructions', async () => {
    const result = await buildSystemPrompt(makeAgent({ instructions: 'Do the task.' }), '/tmp/cwd')
    const text = expectClaudeCodePreset(result)
    expect(text).toContain('SOUL_PROMPT')
    expect(text).toContain('Do the task.')
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

    const result = promptText(await buildSystemPrompt(agent, '/tmp/cwd'))

    expect(result).toContain('SOUL_PROMPT')
    expect(result).toContain('Assistant instructions.')
  })

  it.each(['', '   '])(
    'uses the bundled template when DB instructions are blank and resolves it on every build: %j',
    async (instructions) => {
      mockLoadBuiltinAgentDefinition
        .mockReturnValueOnce({ instructions: 'English bundled instructions' })
        .mockReturnValueOnce({ instructions: '中文内置指令' })
      const agent = makeAgent({ instructions, configuration: { builtin_role: 'assistant' } as never })

      const en = await buildSystemPrompt(agent, '/tmp/cwd')
      const zh = await buildSystemPrompt(agent, '/tmp/cwd')

      expect(promptText(en)).toContain('English bundled instructions')
      expect(promptText(zh)).toContain('中文内置指令')
    }
  )

  it('provisions agent data instead of a user workspace', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    await buildSystemPrompt(agent, '/workspace/project', '/data/Agents/agent-1')

    expect(mockProvisionBuiltinAgent).toHaveBeenCalledWith('/data/Agents/agent-1', 'assistant')
    expect(mockProvisionBuiltinAgent).not.toHaveBeenCalledWith('/workspace/project', 'assistant')
  })

  it('does not make network requests while building an assistant prompt', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    await buildSystemPrompt(agent, '/tmp/cwd')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses user-owned DB instructions when non-empty', async () => {
    mockLoadBuiltinAgentDefinition.mockReturnValue({ instructions: 'Bundled instructions' })
    const agent = makeAgent({
      instructions: 'User instructions',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(agent, '/tmp/cwd')

    expect(promptText(result)).toContain('User instructions')
    expect(promptText(result)).not.toContain('Bundled instructions')
    expect(mockLoadBuiltinAgentDefinition).not.toHaveBeenCalled()
  })
})
