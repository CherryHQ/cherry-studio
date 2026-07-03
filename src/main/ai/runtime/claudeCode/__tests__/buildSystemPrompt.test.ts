/**
 * The `cherry-tools` MCP server (injected into every Claude Code session by buildMcpServers)
 * exposes `report_artifacts`. buildSystemPrompt MUST append REPORT_ARTIFACTS_PROMPT so the model
 * is told to call that tool at task completion — otherwise it is a dangling, never-invoked tool.
 */

import type * as NodeFs from 'node:fs'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindBySessionId, mockMkdir, mockRealpath, mockGetPath } = vi.hoisted(() => ({
  mockFindBySessionId: vi.fn(),
  mockMkdir: vi.fn(),
  mockRealpath: vi.fn(),
  mockGetPath: vi.fn(() => '/tmp/managed-workspaces')
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
  application: { get: vi.fn(), getPath: mockGetPath }
}))

vi.mock('@main/i18n', () => ({
  getAppLanguage: vi.fn(() => 'en-US'),
  t: vi.fn((key: string) => key)
}))

vi.mock('@main/ai/mcp/servers/cherryBuiltinTools', () => ({
  default: vi.fn(() => ({ mcpServer: { id: 'cherry-tools' } }))
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { findBySessionId: mockFindBySessionId, listChannels: vi.fn().mockResolvedValue([]) }
}))

vi.mock('@main/ai/agents/builtin/BuiltinAgentProvisioner', () => ({
  isProvisioned: vi.fn(() => true),
  provisionBuiltinAgent: vi.fn()
}))

vi.mock('@main/ai/agents/prompt', () => ({
  PromptBuilder: vi.fn(() => ({ buildSystemPrompt: vi.fn().mockResolvedValue('SOUL_PROMPT') }))
}))

const { buildSystemPrompt } = await import('../settingsBuilder')

const ARTIFACTS_MARKER = '## Reporting deliverables'
const RUNTIME_MARKER = '## Available Runtimes'

function makeSession(): AgentSessionEntity {
  return { id: 'sess-1', agentId: 'agent-1' } as unknown as AgentSessionEntity
}

function makeAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return { id: 'agent-1', mcps: [], configuration: {}, ...overrides } as unknown as AgentEntity
}

describe('buildSystemPrompt — report_artifacts prompt', () => {
  beforeEach(() => {
    mockFindBySessionId.mockResolvedValue(null)
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
    mockFindBySessionId.mockResolvedValue(null)
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
