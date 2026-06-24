import { COMPOSER_CLIPBOARD_FRAGMENT_MIME } from '@renderer/utils/message/composerClipboard'
import type { CherryMessagePart } from '@shared/data/types/message'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageSelectionController } from '../useMessageSelectionController'

const cacheValues = vi.hoisted(
  () =>
    ({
      'chat.multi_select_mode': false,
      'chat.selected_message_ids': []
    }) as Record<string, unknown>
)
const setCacheValue = vi.hoisted(() =>
  vi.fn((key: string, value: unknown) => {
    cacheValues[key] = value
  })
)

vi.mock('@data/hooks/useCache', () => ({
  useCache: (key: string) => [cacheValues[key], (value: unknown) => setCacheValue(key, value)]
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

const message = (id: string) => ({
  id,
  role: 'user' as const,
  topicId: 'topic-1',
  parentId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success' as const
})

describe('useMessageSelectionController', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    cacheValues['chat.multi_select_mode'] = false
    cacheValues['chat.selected_message_ids'] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    ;(window as any).toast = {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn()
    }
  })

  it('copies selected composer tokens through rich clipboard when available', async () => {
    const copyRichContent = vi.fn().mockResolvedValue(undefined)
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      a: [
        {
          type: 'text',
          text: 'Use the pdf skill. first',
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [
                  {
                    id: 'skill:pdf',
                    kind: 'skill',
                    label: 'PDF',
                    index: 0,
                    textOffset: 0,
                    promptText: 'Use the pdf skill.'
                  }
                ]
              }
            }
          }
        }
      ] as any,
      b: [{ type: 'text', text: 'second' }] as any
    }
    const { result } = renderHook(() =>
      useMessageSelectionController({
        topicId: 'topic-1',
        messages: [message('a'), message('b')],
        partsByMessageId,
        copyRichContent
      })
    )

    await act(async () => {
      await result.current.actions.copySelectedMessages?.(['b', 'a'])
    })

    expect(writeText).not.toHaveBeenCalled()
    expect(copyRichContent).toHaveBeenCalledWith(
      expect.objectContaining({
        plainText: '/pdf/ first\n\n---\n\nsecond',
        customFormats: expect.objectContaining({
          [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: expect.stringContaining('"kind":"skill"')
        })
      }),
      { successMessage: 'message.copied' }
    )
    expect(setCacheValue).toHaveBeenCalledWith('chat.multi_select_mode', false)
  })

  it('falls back to plain text for selected messages without composer tokens', async () => {
    writeText.mockResolvedValue(undefined)
    const copyRichContent = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useMessageSelectionController({
        topicId: 'topic-1',
        messages: [message('a')],
        partsByMessageId: { a: [{ type: 'text', text: 'plain' }] as any },
        copyRichContent
      })
    )

    await act(async () => {
      await result.current.actions.copySelectedMessages?.(['a'])
    })

    expect(copyRichContent).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith('plain')
  })
})
