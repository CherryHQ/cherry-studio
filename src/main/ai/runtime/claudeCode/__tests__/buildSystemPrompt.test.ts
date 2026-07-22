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
  mockLoadBuiltinAgentDefinition,
  mockGetAppLanguage
} = vi.hoisted(() => ({
  mockFindBySessionId: vi.fn(),
  mockMkdir: vi.fn(),
  mockRealpath: vi.fn(),
  mockGetPath: vi.fn(() => '/tmp/managed-workspaces'),
  mockApplicationGet: vi.fn(),
  mockLoadBuiltinAgentDefinition: vi.fn(),
  mockGetAppLanguage: vi.fn(() => 'en-US')
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
  isProvisioned: vi.fn(() => true),
  loadBuiltinAgentDefinition: mockLoadBuiltinAgentDefinition,
  provisionBuiltinAgent: vi.fn()
}))

vi.mock('@main/ai/agents/prompt', () => ({
  PromptBuilder: vi.fn(() => ({ buildSystemPrompt: vi.fn().mockResolvedValue('SOUL_PROMPT') }))
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
  mockGetAppLanguage.mockReturnValue('en-US')
})

function makeSession(): AgentSessionEntity {
  return { id: 'sess-1', agentId: 'agent-1' } as unknown as AgentSessionEntity
}

function makeAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return { id: 'agent-1', mcps: [], configuration: {}, ...overrides } as unknown as AgentEntity
}

describe('buildSystemPrompt — current workspace', () => {
  it('injects the current workspace and default path policy for regular agents', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent(), '/workspace/project-a')

    expect(result as string).toContain(WORKSPACE_MARKER)
    expect(result as string).toContain('"/workspace/project-a"')
    expect(result as string).toContain('Work outside it only when the user explicitly asks')
    expect(result as string).toContain('resolve unspecified or relative paths against it')
  })

  it('injects the current workspace for the built-in assistant path', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(makeSession(), agent, '/workspace/assistant')

    expect(result as string).toContain(WORKSPACE_MARKER)
    expect(result as string).toContain('"/workspace/assistant"')
  })

  it('resolves the workspace dynamically on every prompt build', async () => {
    const agent = makeAgent()

    const first = await buildSystemPrompt(makeSession(), agent, '/workspace/project-a')
    const second = await buildSystemPrompt(makeSession(), agent, '/workspace/project-b')

    expect(first as string).toContain('"/workspace/project-a"')
    expect(first as string).not.toContain('"/workspace/project-b"')
    expect(second as string).toContain('"/workspace/project-b"')
    expect(second as string).not.toContain('"/workspace/project-a"')
  })
})

describe('buildSystemPrompt — report_artifacts prompt', () => {
  beforeEach(() => {
    mockFindBySessionId.mockReturnValue(null)
  })

  it('appends the report_artifacts prompt with user instructions (raw-string path)', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent({ instructions: 'Do the task.' }), '/tmp/cwd')
    // Every agent returns a raw string (not a `{ type: 'preset', append }` object) that carries the
    // soul prompt + user instructions + the artifacts block.
    expect(typeof result).toBe('string')
    expect(result as string).toContain('SOUL_PROMPT')
    expect(result as string).toContain('Do the task.')
    expect(result as string).toContain(ARTIFACTS_MARKER)
  })

  it('appends the report_artifacts prompt without user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent(), '/tmp/cwd')
    expect(typeof result).toBe('string')
    expect(result as string).toContain(ARTIFACTS_MARKER)
  })

  it('does not append it for the Cherry Assistant (parity with feat/chat-page)', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })
    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')
    expect(JSON.stringify(result)).not.toContain(ARTIFACTS_MARKER)
  })
})

describe('buildSystemPrompt — bundled-runtime guidance', () => {
  beforeEach(() => {
    mockFindBySessionId.mockReturnValue(null)
  })

  it('steers the agent to bun/uv with user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent({ instructions: 'Do the task.' }), '/tmp/cwd')
    expect(result as string).toContain(RUNTIME_MARKER)
    // The model is told to use bun / uv explicitly, not node/npm/pip.
    expect(result as string).toContain('bun')
    expect(result as string).toContain('uv run python')
  })

  it('steers the agent to bun/uv without user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent(), '/tmp/cwd')
    expect(result as string).toContain(RUNTIME_MARKER)
  })

  it('does not inject the runtime block for the Cherry Assistant (it carries its own environment)', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })
    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')
    expect(JSON.stringify(result)).not.toContain(RUNTIME_MARKER)
  })
})

describe('buildSystemPrompt — builtin Cherry Assistant definition', () => {
  beforeEach(() => {
    mockFindBySessionId.mockReturnValue(null)
  })

  it('uses the bundled template when DB instructions are empty and resolves it on every build', async () => {
    mockLoadBuiltinAgentDefinition
      .mockReturnValueOnce({ instructions: 'English bundled instructions' })
      .mockReturnValueOnce({ instructions: '中文内置指令' })
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'assistant' } as never })

    const en = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')
    const zh = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(en as string).toContain('English bundled instructions')
    expect(zh as string).toContain('中文内置指令')
    expect(mockLoadBuiltinAgentDefinition).toHaveBeenCalledTimes(2)
  })

  it('reports the resolved application language in the assistant context', async () => {
    mockGetAppLanguage.mockReturnValue('zh-CN')
    mockLoadBuiltinAgentDefinition.mockReturnValue({ instructions: 'Bundled instructions' })
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'assistant' } as never })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(result as string).toContain('- Language: zh-CN, Theme: undefined')
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

    expect(result as string).toContain('User instructions')
    expect(result as string).not.toContain('Bundled instructions')
    expect(mockLoadBuiltinAgentDefinition).not.toHaveBeenCalled()
  })

  it('uses a minimal role fallback when the bundled template is missing and DB instructions are empty', async () => {
    mockLoadBuiltinAgentDefinition.mockReturnValue(undefined)
    const agent = makeAgent({ instructions: '', configuration: { builtin_role: 'assistant' } as never })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(result as string).toContain('You are Cherry Assistant, the built-in helper for Cherry Studio')
  })

  it('applies the external channel security policy for linked assistant sessions', async () => {
    mockFindBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'sess-1' })
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(result as string).toContain(CHANNEL_SECURITY_PROMPT)
  })

  it('does not apply the external channel security policy for unlinked assistant sessions', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })

    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')

    expect(result as string).not.toContain(CHANNEL_SECURITY_PROMPT)
  })
})
