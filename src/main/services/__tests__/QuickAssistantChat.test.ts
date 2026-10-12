import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type { QuickChatRequest } from '@shared/ipc/schemas/quickAssistant'

import { QuickAssistantService } from '../QuickAssistantService'

let service: QuickAssistantService
let deliveredRequest: QuickChatRequest | undefined

beforeEach(() => {
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  deliveredRequest = undefined
  service = new QuickAssistantService()
  vi.spyOn(service, 'activate').mockResolvedValue(true)
  vi.spyOn(application.get('WindowManager'), 'open').mockImplementation((_type, options) => {
    deliveredRequest = options?.initData as QuickChatRequest | undefined
    return 'quick-window'
  })
})

afterEach(() => vi.restoreAllMocks())

describe('floating chat mode', () => {
  it.each([false, true])('uses the user default when mode is omitted (%s)', async (temporary) => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.default_temporary', temporary)
    await service.openChat({ prompt: 'Where is Paris?', submit: false })
    expect(deliveredRequest).toEqual({
      kind: 'chat',
      requestId: expect.any(String),
      prompt: 'Where is Paris?',
      submit: false,
      temporary
    })
  })

  it.each([false, true])('explicit mode overrides the opposite default (%s)', async (temporary) => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.default_temporary', !temporary)
    await service.openChat({ prompt: 'איפה פריז?', submit: true, temporary })
    expect(deliveredRequest).toEqual({
      kind: 'chat',
      requestId: expect.any(String),
      prompt: 'איפה פריז?',
      submit: true,
      temporary
    })
  })
})
