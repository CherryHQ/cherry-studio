import os from 'node:os'

import { describe, expect, it, vi } from 'vitest'

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

import { buildRuntimeContextPrompt } from '../prompt'

describe('buildRuntimeContextPrompt', () => {
  it('resolves the supported system variables into one context block', async () => {
    const prompt = await buildRuntimeContextPrompt('Test Model')

    expect(prompt).toContain('## Runtime Context')
    expect(prompt).toContain(`- Operating system: ${os.platform()}`)
    expect(prompt).toContain(`- CPU architecture: ${os.arch()}`)
    expect(prompt).toContain('- Language: en-US')
    expect(prompt).toContain('- Model: Test Model')
    expect(prompt).toContain('- User: Test User')
    expect(prompt).not.toContain('{{')
  })

  it('resolves variables in a custom runtime context template', async () => {
    await expect(buildRuntimeContextPrompt('Test Model', 'Active model: {{model_name}}')).resolves.toBe(
      'Active model: Test Model'
    )
  })
})
