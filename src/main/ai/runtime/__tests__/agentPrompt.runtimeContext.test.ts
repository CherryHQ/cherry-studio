import { getDeviceType } from '@main/utils/system'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })
  }
}))

vi.mock('@main/ai/agents/builtin/BuiltinAgentProvisioner', () => ({
  loadBuiltinAgentDefinition: vi.fn(),
  provisionBuiltinAgent: vi.fn()
}))

vi.mock('@main/ai/agents/prompt', () => ({
  PromptBuilder: class {
    buildPromptParts = vi.fn()
  }
}))

vi.mock('@main/i18n', () => ({
  getAppLanguage: () => 'en-US'
}))

import {
  captureAgentRuntimeContextSnapshot,
  resolveAgentRuntimeContextPrompt,
  resolveAgentTurnContextPrompt
} from '../agentPrompt'

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.user.name', 'Test User')
  MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
})

describe('agent runtime context snapshot', () => {
  it('captures nothing when the agent has not opted in', () => {
    expect(captureAgentRuntimeContextSnapshot({ configuration: {}, modelName: 'Claude' })).toBeUndefined()
    expect(
      captureAgentRuntimeContextSnapshot({
        configuration: { runtime_context_enabled: false, runtime_context_prompt: 'now: {{datetime}}' },
        modelName: 'Claude'
      })
    ).toBeUndefined()
  })

  it('keeps the unresolved template so each turn can refresh volatile variables', () => {
    expect(
      captureAgentRuntimeContextSnapshot(
        {
          configuration: { runtime_context_enabled: true, runtime_context_prompt: 'now: {{datetime}}' },
          modelName: 'Stored name'
        },
        'Pinned Claude'
      )
    ).toEqual({
      template: 'now: {{datetime}}',
      modelName: 'Pinned Claude'
    })
  })

  it('resolves the captured template with live environment values', async () => {
    const resolved = await resolveAgentRuntimeContextPrompt({
      template: 'User: {{username}}; OS: {{system}}; Model: {{model_name}}',
      modelName: 'Pinned Claude'
    })

    expect(resolved).toBe(`User: Test User; OS: ${getDeviceType()}; Model: Pinned Claude`)
  })
})

describe('agent per-turn current date', () => {
  it('grounds cherry web_search with a request-time ISO date when runtime context is off', async () => {
    // Bug: Agent send() with cherry web_search and no runtime-context opt-in sent no current date,
    // so relative phrases stayed ungrounded on existing Agents.
    const grounded = await resolveAgentTurnContextPrompt({
      webSearchEnabled: true,
      now: new Date(2026, 7, 20, 12, 0, 0)
    })
    const skipped = await resolveAgentTurnContextPrompt({ webSearchEnabled: false })

    expect(grounded).toContain('<current-date>2026-08-20</current-date>')
    expect(grounded).toContain('this month')
    expect(grounded).not.toContain('Test User')
    expect(grounded).not.toContain(getDeviceType())
    expect(skipped).toBeUndefined()
  })

  it('keeps the dedicated web-search date even when the runtime-context preset already supplies datetime', async () => {
    const resolved = await resolveAgentTurnContextPrompt({
      snapshot: { template: undefined, modelName: 'Claude' },
      webSearchEnabled: true,
      now: new Date(2026, 7, 20, 12, 0, 0)
    })

    expect(resolved).toContain('## Runtime Context')
    expect(resolved).toContain('- Current date and time:')
    expect(resolved).toContain('<current-date>2026-08-20</current-date>')
  })
})
