import os from 'node:os'

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

import { buildCurrentDateContext, buildRuntimeContextPrompt, shouldInjectCurrentDateContext } from '../prompt'

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

  it('treats a blank custom template as the shared default preset', async () => {
    const prompt = await buildRuntimeContextPrompt('Test Model', '   ')
    expect(prompt).toContain('## Runtime Context')
    expect(prompt).toContain('- User: Test User')
    expect(prompt).not.toContain('{{')
  })

  it('does not invent a username when PreferenceService has none', async () => {
    preferenceGet.mockImplementation((key: string) => {
      if (key === 'app.language') return 'en-US'
      return undefined
    })

    await expect(buildRuntimeContextPrompt('Test Model', 'User: {{username}}')).resolves.toBe('User: Unknown Username')
  })
})

describe('current date context', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats the local calendar date at request time', () => {
    // Bug: a module-load Date would freeze "today" for the life of the Electron main process.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0))

    expect(buildCurrentDateContext()).toContain('2026-08-20')
    expect(buildCurrentDateContext()).toMatch(/^Current date: 2026-08-20/)
  })

  it('injects only when web search is on and no existing date variable already supplies it', () => {
    expect(
      shouldInjectCurrentDateContext({
        webSearchEnabled: true,
        runtimeContextEnabled: false
      })
    ).toBe(true)
    expect(shouldInjectCurrentDateContext({ webSearchEnabled: false })).toBe(false)
    expect(
      shouldInjectCurrentDateContext({
        webSearchEnabled: true,
        prompt: 'Today is {{date}}'
      })
    ).toBe(false)
    expect(
      shouldInjectCurrentDateContext({
        webSearchEnabled: true,
        runtimeContextEnabled: true
      })
    ).toBe(false)
    expect(
      shouldInjectCurrentDateContext({
        webSearchEnabled: true,
        runtimeContextEnabled: true,
        runtimeContextPrompt: 'Device: {{system}}'
      })
    ).toBe(true)
  })
})
