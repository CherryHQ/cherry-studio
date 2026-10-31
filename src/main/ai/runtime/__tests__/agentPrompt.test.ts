/**
 * `agent.instructions` is persisted as a template, so preserving it across a fallback replay is not
 * enough: `buildAgentRuntimePrompt` resolves `{{username}}` / `{{model_name}}` from live inputs at
 * every materialization. A rebuild inside the same host turn must therefore reuse the values that
 * turn was admitted with — a later save applies on the next fresh turn (agent-prompt-layers.md:57).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '@shared/data/api/schemas/agents'

const { preferenceGet, buildPromptParts } = vi.hoisted(() => ({
  preferenceGet: vi.fn<(key: string) => string | undefined>(() => undefined),
  buildPromptParts: vi.fn(async () => ({ base: { kind: 'native' as const }, context: 'PERSONA' }))
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@application', () => ({
  application: { get: () => ({ get: preferenceGet }), getPath: () => '/tmp/agent-data' }
}))

vi.mock('@main/i18n', () => ({ getAppLanguage: () => 'en-US' }))

vi.mock('@main/ai/agents/builtin/BuiltinAgentProvisioner', () => ({
  loadBuiltinAgentDefinition: () => undefined,
  provisionBuiltinAgent: async () => undefined
}))

vi.mock('@main/ai/agents/prompt', () => ({
  PromptBuilder: class {
    buildPromptParts = buildPromptParts
  }
}))

vi.mock('@main/ai/utils/agentLanguage', () => ({ getEffectiveAgentLanguage: () => null }))

const { buildAgentRuntimePrompt } = await import('../agentPrompt')

const AGENT = {
  id: 'agent-1',
  model: 'provider-1::model-1',
  modelName: 'Model One',
  instructions: 'Address {{username}} while using {{model_name}}.',
  configuration: {}
} as unknown as AgentEntity

function materialize(promptVariables?: { username?: string | null; modelName?: string | null }) {
  return buildAgentRuntimePrompt({
    workspacePath: '/workspace',
    agentDataPath: '/agent-data',
    agent: AGENT,
    effectiveLanguage: null,
    promptVariables
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  buildPromptParts.mockResolvedValue({ base: { kind: 'native' }, context: 'PERSONA' })
})

describe('buildAgentRuntimePrompt — resolved variable stability', () => {
  it('resolves the live user name when the turn is admitted', async () => {
    preferenceGet.mockImplementation((key: string) => (key === 'app.user.name' ? 'Alice' : undefined))

    const { append } = await materialize()

    expect(append).toContain('Address Alice while using Model One.')
  })

  it("keeps a replay on the turn's admitted values, not a name saved mid-turn", async () => {
    preferenceGet.mockImplementation((key: string) => (key === 'app.user.name' ? 'Alice' : undefined))
    // Admission resolved Alice; `app.user.name` is saved to Bob while the provider backs off.
    const admitted = { username: 'Alice', modelName: 'Model One' }
    preferenceGet.mockImplementation((key: string) => (key === 'app.user.name' ? 'Bob' : undefined))

    const { append } = await materialize(admitted)

    // The replay stays inside the same host turn, so its instruction content must not change.
    expect(append).toContain('Address Alice while using Model One.')
    expect(append).not.toContain('Bob')
  })

  it("keeps a replay on the turn's admitted model name", async () => {
    preferenceGet.mockImplementation((key: string) => (key === 'app.user.name' ? 'Alice' : undefined))

    const { append } = await materialize({ username: 'Alice', modelName: 'Admitted Model' })

    expect(append).toContain('Address Alice while using Admitted Model.')
    expect(append).not.toContain('Model One')
  })
})
