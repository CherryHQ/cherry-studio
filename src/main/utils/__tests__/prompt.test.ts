import os from 'node:os'

import { getDeviceType } from '@main/utils/system'
import { defaultLanguage } from '@shared/utils/languages'
import { MockMainPreferenceServiceExport, MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildRuntimeContextPrompt, buildWebSearchDateContext } from '../prompt'

describe('buildRuntimeContextPrompt', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.user.name', 'Test User')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
  })

  it('resolves the supported system variables into one context block', async () => {
    const prompt = await buildRuntimeContextPrompt('Test Model')

    expect(prompt).toContain('## Runtime Context')
    expect(prompt).toContain(`- Operating system: ${getDeviceType()}`)
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
    MockMainPreferenceServiceExport.preferenceService.get.mockImplementation((key: string) => {
      if (key === 'app.language') return 'en-US'
      return undefined
    })

    await expect(buildRuntimeContextPrompt('Test Model', 'User: {{username}}')).resolves.toBe('User: Unknown Username')
  })

  it('falls back to defaultLanguage when app.language is unset', async () => {
    MockMainPreferenceServiceExport.preferenceService.get.mockImplementation(() => undefined)

    await expect(buildRuntimeContextPrompt('Test Model', 'Language: {{language}}')).resolves.toBe(
      `Language: ${defaultLanguage}`
    )
  })

  it('resolves {{system}} to the renderer device type', async () => {
    await expect(buildRuntimeContextPrompt('Test Model', 'OS: {{system}}')).resolves.toBe(`OS: ${getDeviceType()}`)
  })
})

describe('buildWebSearchDateContext', () => {
  it('formats the local calendar date from the supplied clock', () => {
    expect(buildWebSearchDateContext(new Date(2026, 7, 20, 23, 59))).toContain(
      '<current-date>2026-08-20</current-date>'
    )
    expect(buildWebSearchDateContext(new Date(2026, 7, 20, 23, 59))).toContain('this month')
  })
})
