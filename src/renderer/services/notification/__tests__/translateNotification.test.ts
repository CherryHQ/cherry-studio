// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeToast: vi.fn(),
  openRoute: vi.fn(),
  send: vi.fn(() => Promise.resolve()),
  success: vi.fn()
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({ openRoute: mocks.openRoute }))
vi.mock('@renderer/services/toast', () => ({
  toast: { closeToast: mocks.closeToast, success: mocks.success }
}))
vi.mock('../NotificationService', () => ({ notificationService: { send: mocks.send } }))

import { notifyTranslateCompletion } from '../translateNotification'

describe('notifyTranslateCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  afterEach(() => vi.restoreAllMocks())

  it('returns to the originating translate session from the completion toast', () => {
    notifyTranslateCompletion({ sessionId: 'translate-1', title: 'Completed', message: 'English → Chinese' })

    const toastOptions = mocks.success.mock.calls[0][0]
    toastOptions.onClick()

    expect(mocks.closeToast).toHaveBeenCalledWith(toastOptions.key)
    expect(mocks.openRoute).toHaveBeenCalledWith('/app/translate', { sessionId: 'translate-1' })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('sends a clickable system notification when the window is not focused', () => {
    vi.mocked(document.hasFocus).mockReturnValue(false)

    notifyTranslateCompletion({
      sessionId: 'translate-1',
      historyId: 'history-1',
      title: 'Completed',
      message: 'document.pdf'
    })

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey: 'translate.open',
        meta: { sessionId: 'translate-1', historyId: 'history-1' },
        source: 'translate'
      })
    )
  })
})
