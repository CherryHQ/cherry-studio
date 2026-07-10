import type * as NodeFs from 'node:fs'

import { application } from '@application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    default: { ...actual, existsSync: mocks.existsSync, readFileSync: mocks.readFileSync }
  }
})

import { loadBuiltinAgentDefinition } from '../BuiltinAgentProvisioner'

const localizedDefinition = JSON.stringify({
  description: { 'en-US': 'English description', 'zh-CN': '中文说明' },
  instructions: { 'en-US': 'English instructions', 'zh-CN': '中文指令' },
  configuration: {}
})

describe('loadBuiltinAgentDefinition', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    vi.spyOn(application, 'getPath').mockReturnValue('/templates')
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(localizedDefinition)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the system locale when app.language is unset', () => {
    vi.mocked(app.getLocale).mockReturnValue('zh-CN')

    expect(loadBuiltinAgentDefinition('assistant')).toMatchObject({
      description: '中文说明',
      instructions: '中文指令'
    })
  })

  it('prefers app.language over the system locale', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
    vi.mocked(app.getLocale).mockReturnValue('zh-CN')

    expect(loadBuiltinAgentDefinition('assistant')).toMatchObject({
      description: 'English description',
      instructions: 'English instructions'
    })
  })
})
