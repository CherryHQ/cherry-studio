import { describe, expect, it, vi } from 'vitest'

const { preference } = vi.hoisted(() => ({
  preference: { name: 'Alice', language: 'en-US' }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      get: (key: string) => {
        if (key === 'app.user.name') return preference.name
        if (key === 'app.language') return preference.language
        return undefined
      }
    }
  })
})

import { capturePromptVariableInputs, replacePromptVariables } from '../prompt'

describe('replacePromptVariables', () => {
  it('substitutes the language the turn was admitted with', async () => {
    preference.language = 'en-US'
    const pinned = capturePromptVariableInputs('model')

    // A preference change during provider backoff must not rewrite the same turn's prompt.
    preference.language = 'zh-CN'

    await expect(replacePromptVariables('Answer in {{language}}', 'model', pinned)).resolves.toBe('Answer in en-US')
    await expect(replacePromptVariables('Answer in {{language}}', 'model')).resolves.toBe('Answer in zh-CN')
  })
})
