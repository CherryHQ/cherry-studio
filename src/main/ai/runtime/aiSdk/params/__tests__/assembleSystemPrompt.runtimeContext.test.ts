import os from 'node:os'

import type { Assistant } from '@shared/data/types/assistant'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { afterEach, describe, expect, it, vi } from 'vitest'

const preferenceGet = vi.hoisted(() =>
  vi.fn((key: string) => {
    if (key === 'app.user.name') return 'Test User'
    if (key === 'app.language') return 'en-US'
    return undefined
  })
)

vi.mock('@application', () => ({
  application: {
    get: () => ({ get: preferenceGet })
  }
}))

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
  afterEach(() => {
    vi.useRealTimers()
    preferenceGet.mockImplementation((key: string) => {
      if (key === 'app.user.name') return 'Test User'
      if (key === 'app.language') return 'en-US'
      return undefined
    })
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
    expect(disabled).not.toContain(os.platform())
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
    expect(out).toContain(`- Operating system: ${os.platform()}`)
    expect(out).toContain(`- CPU architecture: ${os.arch()}`)
    expect(out).toContain('- Language: en-US')
    expect(out).toContain('- Model: GPT-4')
    expect(out).toContain('- User: Test User')
    expect(out).not.toContain('{{')
  })

  it('does not hide a username resolution failure behind a successful empty block', async () => {
    preferenceGet.mockImplementation((key: string) => {
      if (key === 'app.language') return 'en-US'
      return undefined
    })

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

  it('grounds web search with a request-time ISO date when runtime context is off or absent', async () => {
    // Bug: existing Assistants with Web Search on and an empty prompt send no current date,
    // so relative phrases such as "this month" are expanded from training recency.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0))

    const disabled = await assembleSystemPrompt({
      assistant: makeAssistant({
        prompt: '',
        settings: { ...makeAssistant().settings, enableWebSearch: true, enableRuntimeContext: false }
      }),
      model
    })
    const legacy = await assembleSystemPrompt({
      assistant: makeAssistant({
        prompt: '',
        settings: {
          ...makeAssistant().settings,
          enableWebSearch: true,
          enableRuntimeContext: undefined
        }
      }),
      model
    })

    expect(disabled).toContain('2026-08-20')
    expect(legacy).toContain('2026-08-20')
    expect(disabled).not.toContain('Test User')
    expect(disabled).not.toContain(os.platform())
    expect(legacy).not.toContain('Test User')
  })

  it('does not add a current date when web search is disabled', async () => {
    // Bug: a global date on unrelated prompts would change Assistants that never enabled Web Search.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0))

    const out = await assembleSystemPrompt({
      assistant: makeAssistant({ prompt: '' }),
      model
    })

    expect(out).toBeUndefined()
  })

  it('does not duplicate the current date when runtime context already supplies datetime', async () => {
    // Bug: enabling Web Search on a new Assistant would emit both the runtime-context datetime
    // and a second dedicated current-date section.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0))

    const out = await assembleSystemPrompt({
      assistant: makeAssistant({
        prompt: '',
        settings: {
          ...makeAssistant().settings,
          enableWebSearch: true,
          enableRuntimeContext: true
        }
      }),
      model
    })

    expect(out).toContain('## Runtime Context')
    expect(out).toContain('- Current date and time:')
    expect(out).not.toMatch(/(^|\n)Current date: 2026-08-20/)
  })
})
