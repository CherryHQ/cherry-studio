/**
 * The `cherry-tools` MCP server (injected into every Claude Code session by buildMcpServers)
 * exposes `report_artifacts`. buildSystemPrompt MUST append REPORT_ARTIFACTS_PROMPT so the model
 * is told to call that tool at task completion — otherwise it is a dangling, never-invoked tool.
 */

import type * as NodeFs from 'node:fs'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
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

vi.mock('@main/utils/prompt', () => ({
  replacePromptVariables: mockReplacePromptVariables
}))

const { buildSystemPrompt } = await import('../settingsBuilder')

const ARTIFACTS_MARKER = '## Reporting deliverables'
const WORKSPACE_MARKER = '## Current Workspace'

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
  return prompt?.append ?? ''
}

function expectClaudeCodePreset(prompt: Awaited<ReturnType<typeof buildSystemPrompt>>): string {
  expect(prompt).toMatchObject({ type: 'preset', preset: 'claude_code' })
  return promptText(prompt)
}

describe('buildSystemPrompt — current workspace', () => {
  it('loads prompt identity and memory from agent data while leaving cwd context to the preset', async () => {
    const result = await buildSystemPrompt(makeAgent(), '/workspace/project-a', '/data/Agents/agent-1')

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
    const result = await buildSystemPrompt(makeAgent(), '/workspace/project-a')

    const text = expectClaudeCodePreset(result)
    expect(text).not.toContain(WORKSPACE_MARKER)
    expect(text).not.toContain('"/workspace/project-a"')
  })

  it('appends root-scoped AGENTS.md instructions alongside the native Claude Code project context', async () => {
    const result = await buildSystemPrompt(
      makeAgent(),
      '/workspace/project-a',
      '/data/Agents/agent-1',
      [],
      [],
      '## Workspace Instructions (AGENTS.md)\n\nRoot repository rules.'
    )

    const text = expectClaudeCodePreset(result)
    expect(text).toContain('## Workspace Instructions (AGENTS.md)')
    expect(text).toContain('Root repository rules.')
  })

  it('does not duplicate the preset-owned workspace context for the built-in assistant', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(agent, '/workspace/assistant')

    expect(promptText(result)).not.toContain(WORKSPACE_MARKER)
    expect(promptText(result)).not.toContain('"/workspace/assistant"')
  })

  it('resolves the workspace dynamically for every custom system.md build', async () => {
    const agent = makeAgent()
    mockBuildPrompt.mockResolvedValue({
      base: { kind: 'custom', content: 'CUSTOM SYSTEM PROMPT' },
      context: 'SOUL_PROMPT'
    })

    const first = await buildSystemPrompt(agent, '/workspace/project-a')
    const second = await buildSystemPrompt(agent, '/workspace/project-b')

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

    const result = await buildSystemPrompt(makeAgent({ instructions: 'Agent instructions.' }), '/tmp/cwd')

    expect(typeof result).toBe('string')
    expect(result).toMatch(/^CUSTOM SYSTEM PROMPT\n\n## Instruction Precedence/)
    expect(result).toContain('SOUL_PROMPT')
    expect(result).toContain('Agent instructions.')
    expect(result).toContain(WORKSPACE_MARKER)
    expect(result).toContain(ARTIFACTS_MARKER)
    expect(result).not.toContain('## Available Runtimes')
  })

  it('treats an empty system.md as a custom base and still retains Cherry context', async () => {
    mockBuildPrompt.mockResolvedValueOnce({ base: { kind: 'custom', content: '' }, context: 'SOUL_PROMPT' })

    const result = await buildSystemPrompt(makeAgent({ instructions: 'Agent instructions.' }), '/tmp/cwd')

    expect(typeof result).toBe('string')
    expect(result).toMatch(/^## Instruction Precedence/)
    expect(result).toContain('SOUL_PROMPT')
    expect(result).toContain('Agent instructions.')
    expect(result).toContain(WORKSPACE_MARKER)
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

      expect(mockBuildPrompt).toHaveBeenCalledWith('/tmp/cwd', expect.anything(), false, expect.anything())
      expect(text).not.toContain('## Instruction Precedence')
      expect(text).not.toContain('<agent_instructions>')
      expect(text).toContain('SOUL_ROLE: You are the friendly historian.')
    }
  )

  it('declares agent instructions above workspace instructions and persona while preserving every source', async () => {
    mockBuildPrompt.mockResolvedValueOnce({
      base: { kind: 'custom', content: 'WORKSPACE_ROLE: You are the workspace reviewer.' },
      context: '## Memories\n\n<soul>\nSOUL_ROLE: You are the friendly historian.\n</soul>'
    })

    const text = promptText(
      await buildSystemPrompt(makeAgent({ instructions: 'AGENT_ROLE: You are the release manager.' }), '/tmp/cwd')
    )

    expect(text).toContain('1. Platform and runtime safety constraints')
    expect(text).toContain('2. Agent System Prompt (`agent.instructions`)')
    expect(text).toContain(
      '3. Workspace Instructions (`system.md`, `CLAUDE.md`, and scoped `AGENTS.md` files, when present)'
    )
    expect(text).toContain('4. Agent Persona (`SOUL.md`)')
    expect(text).toContain('WORKSPACE_ROLE: You are the workspace reviewer.')
    expect(text).toContain('SOUL_ROLE: You are the friendly historian.')
    expect(text).toContain('<agent_instructions>\nAGENT_ROLE: You are the release manager.\n</agent_instructions>')
  })

  it('resolves Agent System Prompt variables with the embedded Agent model name', async () => {
    mockReplacePromptVariables.mockResolvedValueOnce('Address Alice while using Claude Sonnet 4.5.')
    const agent = makeAgent({
      instructions: 'Address {{username}} while using {{model_name}}.',
      modelName: 'Claude Sonnet 4.5'
    })

    const text = promptText(await buildSystemPrompt(agent, '/tmp/cwd'))

    expect(mockReplacePromptVariables).toHaveBeenCalledWith(
      'Address {{username}} while using {{model_name}}.',
      'Claude Sonnet 4.5'
    )
    expect(text).toContain('Address Alice while using Claude Sonnet 4.5.')
    expect(text).not.toContain('{{username}}')
    expect(text).not.toContain('{{model_name}}')
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
    expect(text).toContain(ARTIFACTS_MARKER)
  })

  it('appends the report_artifacts prompt without user instructions', async () => {
    const result = await buildSystemPrompt(makeAgent(), '/tmp/cwd')
    expect(expectClaudeCodePreset(result)).toContain(ARTIFACTS_MARKER)
  })

  it('appends it for the Cherry Assistant like every other Agent', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })
    const result = await buildSystemPrompt(agent, '/tmp/cwd')
    expect(promptText(result)).toContain(ARTIFACTS_MARKER)
  })
})

describe('buildSystemPrompt — runtime/CLI handbook', () => {
  it('does not inject the handbook for a normal agent with user instructions', async () => {
    const result = promptText(await buildSystemPrompt(makeAgent({ instructions: 'Do the task.' }), '/tmp/cwd'))

    expect(result).not.toContain('## Managed CLI Installation')
    expect(result).not.toContain('## Available Runtimes')
    expect(result).not.toContain('Install reusable CLIs only with `cli_install`')
  })

  it('does not inject the handbook for a normal agent without user instructions', async () => {
    const result = promptText(await buildSystemPrompt(makeAgent(), '/tmp/cwd'))

    expect(result).not.toContain('## Managed CLI Installation')
    expect(result).not.toContain('## Available Runtimes')
    expect(result).not.toContain('Install dependencies INTO the project (cwd) only')
  })

  it('does not inject the handbook for the Cherry Assistant', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })
    const result = promptText(await buildSystemPrompt(agent, '/tmp/cwd'))

    expect(result).not.toContain('## Managed CLI Installation')
    expect(result).not.toContain('## Available Runtimes')
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
    expect(result).toContain(ARTIFACTS_MARKER)
    expect(result).not.toContain('Non-negotiable Cherry Assistant contract')
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
      expect(mockLoadBuiltinAgentDefinition).toHaveBeenCalledTimes(2)
    }
  )

  it('loads the bundled product feedback role for Cherry Support', async () => {
    mockLoadBuiltinAgentDefinition.mockReturnValue({
      instructions: 'Answer questions, provide usage help, troubleshoot problems, and submit feedback.'
    })
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'support' } as never })

    const result = await buildSystemPrompt(agent, '/tmp/cwd')

    expect(promptText(result)).toContain(
      'Answer questions, provide usage help, troubleshoot problems, and submit feedback.'
    )
    expect(mockLoadBuiltinAgentDefinition).toHaveBeenCalledWith('support')
  })

  it('initializes persona and memory resources in agent data on every build', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    await buildSystemPrompt(agent, '/workspace/assistant', '/data/Agents/agent-1')
    await buildSystemPrompt(agent, '/workspace/assistant', '/data/Agents/agent-1')

    expect(mockProvisionBuiltinAgent).toHaveBeenCalledTimes(2)
    expect(mockProvisionBuiltinAgent).toHaveBeenNthCalledWith(1, '/data/Agents/agent-1', 'assistant')
    expect(mockProvisionBuiltinAgent).toHaveBeenNthCalledWith(2, '/data/Agents/agent-1', 'assistant')
  })

  it('provisions agent data instead of a user workspace', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    await buildSystemPrompt(agent, '/workspace/project', '/data/Agents/agent-1')

    expect(mockProvisionBuiltinAgent).toHaveBeenCalledWith('/data/Agents/agent-1', 'assistant')
    expect(mockProvisionBuiltinAgent).not.toHaveBeenCalledWith('/workspace/project', 'assistant')
  })

  it('loads the built-in Assistant through the normal identity and memory prompt pipeline', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(agent, '/workspace/assistant', '/data/Agents/agent-1')

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

  it('uses a minimal role fallback when the bundled template is missing and DB instructions are empty', async () => {
    mockLoadBuiltinAgentDefinition.mockReturnValue(undefined)
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'assistant' } as never })

    const result = await buildSystemPrompt(agent, '/tmp/cwd')

    expect(promptText(result)).toContain('built-in general-purpose Agent and onboarding guide')
  })

  it('injects the bundled Assistant role exactly once', async () => {
    const role = 'Within Cherry Studio, you serve as Cherry Assistant, its built-in general-purpose Agent'
    mockLoadBuiltinAgentDefinition.mockReturnValue({ instructions: role })
    mockBuildPrompt.mockResolvedValue({
      base: { kind: 'native' },
      context: '## Personality\n\nFriendly and concise.'
    })
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'assistant' } as never })

    const result = await buildSystemPrompt(agent, '/tmp/cwd')

    expect(promptText(result).split(role)).toHaveLength(2)
  })
})
