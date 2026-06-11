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

vi.mock('@main/core/application', () => ({
  application: { get: vi.fn(), getPath: mockGetPath }
}))

vi.mock('@main/utils/language', () => ({
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

vi.mock('@main/ai/agents/cherryclaw/prompt', () => ({
  PromptBuilder: vi.fn(() => ({ buildSystemPrompt: vi.fn().mockResolvedValue('SOUL_PROMPT') }))
}))

const { buildSystemPrompt } = await import('../settingsBuilder')

const ARTIFACTS_MARKER = '## Reporting deliverables'

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

  it('appends the report_artifacts prompt in standard mode with user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent({ instructions: 'Do the task.' }), '/tmp/cwd')
    expect(result).toMatchObject({ type: 'preset', preset: 'claude_code' })
    const append = (result as { append: string }).append
    expect(append).toContain('Do the task.')
    expect(append).toContain(ARTIFACTS_MARKER)
  })

  it('appends the report_artifacts prompt in standard mode without user instructions', async () => {
    const result = await buildSystemPrompt(makeSession(), makeAgent(), '/tmp/cwd')
    const append = (result as { append: string }).append
    expect(append).toContain(ARTIFACTS_MARKER)
  })

  it('does not append it for the Cherry Assistant (parity with feat/chat-page)', async () => {
    const agent = makeAgent({
      instructions: 'Assistant instructions.',
      configuration: { builtin_role: 'assistant' } as never
    })
    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')
    expect(JSON.stringify(result)).not.toContain(ARTIFACTS_MARKER)
  })

  it('appends the report_artifacts prompt in soul mode (raw-string path)', async () => {
    const agent = makeAgent({ instructions: 'Soul task.', configuration: { soul_enabled: true } as never })
    const result = await buildSystemPrompt(makeSession(), agent, '/tmp/cwd')
    // Soul mode returns a raw string (not the standard `{ type: 'preset', append }` object), so it's a
    // distinct path that must still carry the soul prompt + user instructions + the artifacts block.
    expect(typeof result).toBe('string')
    expect(result as string).toContain('SOUL_PROMPT')
    expect(result as string).toContain('Soul task.')
    expect(result as string).toContain(ARTIFACTS_MARKER)
  })
})
