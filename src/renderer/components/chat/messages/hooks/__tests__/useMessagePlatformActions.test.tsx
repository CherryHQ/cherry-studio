import { COMPOSER_CLIPBOARD_FRAGMENT_MIME } from '@renderer/utils/message/composerClipboard'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessagePlatformActions } from '../useMessagePlatformActions'

describe('useMessagePlatformActions', () => {
  const write = vi.fn()
  const writeText = vi.fn()
  const success = vi.fn()
  const createdItems: Array<Record<string, Blob>> = []

  beforeEach(() => {
    vi.clearAllMocks()
    createdItems.length = 0
    write.mockResolvedValue(undefined)
    writeText.mockResolvedValue(undefined)

    class TestClipboardItem {
      static supports = vi.fn(() => true)

      constructor(items: Record<string, Blob>) {
        createdItems.push(items)
      }
    }

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText }
    })
    vi.stubGlobal('ClipboardItem', TestClipboardItem)
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem
    })
    ;(window as any).toast = {
      success,
      warning: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    }
  })

  it('writes private composer clipboard formats when the browser supports them', async () => {
    const { result } = renderHook(() => useMessagePlatformActions())

    await act(async () => {
      await result.current.copyRichContent?.(
        {
          plainText: '/pdf/ hello',
          html: '<p><span data-composer-token="">pdf</span> hello</p>',
          customFormats: {
            [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: '{"version":1,"segments":[]}'
          }
        },
        { successMessage: 'copied' }
      )
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()
    expect(createdItems[0]).toEqual(
      expect.objectContaining({
        'text/plain': expect.any(Blob),
        'text/html': expect.any(Blob),
        [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: expect.any(Blob)
      })
    )
    expect(success).toHaveBeenCalledWith('copied')
  })

  it('retries rich clipboard writes without custom formats when custom formats fail', async () => {
    write.mockRejectedValueOnce(new Error('custom format unsupported')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useMessagePlatformActions())

    await act(async () => {
      await result.current.copyRichContent?.({
        plainText: '/pdf/ hello',
        html: '<p><span data-composer-token="">pdf</span> hello</p>',
        customFormats: {
          [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: '{"version":1,"segments":[]}'
        }
      })
    })

    expect(write).toHaveBeenCalledTimes(2)
    expect(createdItems[0]).toHaveProperty(COMPOSER_CLIPBOARD_FRAGMENT_MIME)
    expect(createdItems[1]).not.toHaveProperty(COMPOSER_CLIPBOARD_FRAGMENT_MIME)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to plain text when ClipboardItem is unavailable', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: undefined
    })
    const { result } = renderHook(() => useMessagePlatformActions())

    await act(async () => {
      await result.current.copyRichContent?.({
        plainText: '/pdf/ hello',
        html: '<p><span data-composer-token="">pdf</span> hello</p>',
        customFormats: {
          [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: '{"version":1,"segments":[]}'
        }
      })
    })

    expect(write).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith('/pdf/ hello')
  })
})
