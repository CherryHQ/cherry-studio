import { EventEmitter } from 'node:events'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import type { BrowserWindow } from 'electron'
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
  vi.mocked(application.get('WindowManager').getWindow).mockReturnValue(undefined)
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
  it('keeps floating chats visible on focus loss and still allows explicit hiding', async () => {
    await service.openChat({ prompt: '', temporary: true, submit: false })
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      hide: vi.fn(),
      webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
    })
    vi.spyOn(application.get('WindowManager'), 'getWindow').mockReturnValue(window as unknown as BrowserWindow)
    ;(service as any).setupQuickAssistant(window)
    window.emit('blur')
    expect(window.hide).not.toHaveBeenCalled()
    service.hideQuickAssistant()
    expect(window.hide).toHaveBeenCalledTimes(1)
  })

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
