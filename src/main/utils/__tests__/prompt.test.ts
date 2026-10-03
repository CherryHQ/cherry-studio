import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { replacePromptVariables } from '../prompt'

describe('replacePromptVariables', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    vi.mocked(app.getLocale).mockReturnValue('en-US')
  })

  it('resolves the effective system locale when Cherry follows the system language', async () => {
    vi.mocked(app.getLocale).mockReturnValue('zh-CN')

    await expect(replacePromptVariables('Reply in {{language}}.')).resolves.toBe('Reply in zh-CN.')
  })

  it('resolves the current date at request time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T10:00:00Z'))
    const first = await replacePromptVariables('Today: {{date}}')
    vi.setSystemTime(new Date('2027-05-21T10:00:00Z'))
    const second = await replacePromptVariables('Today: {{date}}')
    vi.useRealTimers()

    expect(first).not.toContain('{{date}}')
    expect(second).not.toContain('{{date}}')
    expect(first).not.toBe(second)
  })
})
