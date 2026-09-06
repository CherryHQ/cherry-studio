import os from 'node:os'

import { getDeviceType } from '@main/utils/system'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: vi.fn(), error: vi.fn() })
  }
}))

import { assembleSystemPrompt } from '../assembleSystemPrompt'

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    prompt: 'Stay concise.',
    mcpServerIds: [],
    settings: {
      temperature: 1,
      enableTemperature: false,
      topP: 1,
      enableTopP: false,
      maxTokens: 4096,
      enableMaxTokens: false,
      streamOutput: true,
      reasoning_effort: 'default',
      mcpMode: 'auto',
      maxToolCalls: 100,
      enableMaxToolCalls: true,
      enableWebSearch: false,
      enableGenerateImage: false,
      enableRuntimeContext: false,
      customParameters: []
    },
    ...overrides
  } as Assistant
}

const model = { id: 'openai::gpt-4' as UniqueModelId, providerId: 'openai', name: 'GPT-4' } as Model

describe('assembleSystemPrompt runtime context contract', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.name', 'Test User')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not disclose environment fields when the toggle is off or absent', async () => {
    const disabled = await assembleSystemPrompt({ assistant: makeAssistant(), model })
    const legacy = await assembleSystemPrompt({
      assistant: makeAssistant({
        settings: { ...makeAssistant().settings, enableRuntimeContext: undefined }
      }),
      model
    })

    expect(disabled).toBe('Stay concise.')
    expect(legacy).toBe('Stay concise.')
    expect(disabled).not.toContain('Test User')
    expect(disabled).not.toContain(getDeviceType())
    expect(legacy).not.toContain('Test User')
  })

  it('appends live environment fields from PreferenceService and the host when enabled', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({
        settings: { ...makeAssistant().settings, enableRuntimeContext: true }
      }),
      model
    })

    expect(out).toContain('Stay concise.')
    expect(out).toContain('## Runtime Context')
    expect(out).toContain(`- Operating system: ${getDeviceType()}`)
    expect(out).toContain(`- CPU architecture: ${os.arch()}`)
    expect(out).toContain('- Language: en-US')
    expect(out).toContain('- Model: GPT-4')
    expect(out).toContain('- User: Test User')
    expect(out).not.toContain('{{')
  })

  it('does not hide a username resolution failure behind a successful empty block', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.name', '')

    const out = await assembleSystemPrompt({
      assistant: makeAssistant({
        prompt: '',
        settings: {
          ...makeAssistant().settings,
          enableRuntimeContext: true,
          runtimeContextPrompt: 'User: {{username}}'
        }
      }),
      model
    })

    expect(out).toBe('User: Unknown Username')
  })

  it('does not add a web-search date when the request cannot execute web search', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: '' }),
      model,
      webSearchEnabled: false,
      now: new Date(2026, 7, 20, 12, 0, 0)
    })

    expect(out).toBeUndefined()
  })

  it('keeps the dedicated web-search date even when runtime context already includes datetime', async () => {
    const out = await assembleSystemPrompt({
      assistant: makeAssistant({
        prompt: '',
        settings: {
          ...makeAssistant().settings,
          enableRuntimeContext: true
        }
      }),
      model,
      webSearchEnabled: true,
      now: new Date(2026, 7, 20, 12, 0, 0)
    })

    expect(out).toContain('## Runtime Context')
    expect(out).toContain('- Current date and time:')
    expect(out).toContain('<current-date>2026-08-20</current-date>')
    expect(out).toContain('this month')
  })
})
