import type { TranslateLanguage } from '@shared/data/types/translate'
import type React from 'react'
import { describe, expect, it } from 'vitest'

import { createOutputScrollHandler, pickBidirectionalTarget, shouldPersistDirectTarget } from '../translate'

const lang = (langCode: string, value: string): TranslateLanguage =>
  ({
    langCode,
    value,
    emoji: '🏳️',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }) as TranslateLanguage

const english = lang('en-us', 'English')
const chinese = lang('zh-cn', 'Chinese')
const japanese = lang('ja-jp', 'Japanese')

describe('translate bidirectional helpers', () => {
  describe('pickBidirectionalTarget', () => {
    it('uses the override target when one is provided', () => {
      expect(pickBidirectionalTarget('en-us', chinese, english, japanese)).toBe(japanese)
    })

    it('uses alter when detected source equals preferred', () => {
      expect(pickBidirectionalTarget('zh-cn', chinese, english)).toBe(english)
    })

    it('uses preferred when detected source equals alter', () => {
      expect(pickBidirectionalTarget('en-us', chinese, english)).toBe(chinese)
    })

    it('uses preferred when detected source is unknown', () => {
      expect(pickBidirectionalTarget('unknown', chinese, english)).toBe(chinese)
    })
  })

  describe('shouldPersistDirectTarget', () => {
    it('persists a direct target only when it differs from both saved slots', () => {
      expect(shouldPersistDirectTarget(japanese, chinese, english)).toBe(true)
      expect(shouldPersistDirectTarget(chinese, chinese, english)).toBe(false)
      expect(shouldPersistDirectTarget(english, chinese, english)).toBe(false)
    })
  })
})

describe('createOutputScrollHandler', () => {
  const createTextareaWithScrollMetrics = (scrollHeight: number, clientHeight: number) => {
    const input = document.createElement('textarea')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: scrollHeight })
    Object.defineProperty(input, 'clientHeight', { configurable: true, value: clientHeight })
    return input
  }

  const createOutputEvent = (overrides?: Partial<HTMLDivElement>) =>
    ({
      currentTarget: {
        scrollTop: 20,
        scrollHeight: 240,
        clientHeight: 120,
        ...(overrides || {})
      }
    }) as React.UIEvent<HTMLDivElement>

  it('syncs scroll when textarea ref points to native HTMLTextAreaElement', () => {
    const input = createTextareaWithScrollMetrics(300, 150)
    const textAreaRef = { current: input }
    const isProgrammaticScrollRef = { current: false }

    const onScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScrollRef, true)
    onScroll(createOutputEvent())

    expect(input.scrollTop).toBeGreaterThan(0)
  })

  it('syncs scroll when textarea ref points to legacy antd TextAreaRef shape', () => {
    const input = createTextareaWithScrollMetrics(500, 200)
    const textAreaRef = { current: { resizableTextArea: { textArea: input } } }
    const isProgrammaticScrollRef = { current: false }

    const onScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScrollRef, true)
    onScroll(createOutputEvent())

    expect(input.scrollTop).toBeGreaterThan(0)
  })

  it('short-circuits when scroll sync is disabled', () => {
    const input = document.createElement('textarea')
    input.scrollTop = 0
    const textAreaRef = { current: input }
    const isProgrammaticScrollRef = { current: false }

    const onScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScrollRef, false)
    onScroll(createOutputEvent())

    expect(input.scrollTop).toBe(0)
  })

  it('short-circuits when programmatic scroll guard is active', () => {
    const input = document.createElement('textarea')
    input.scrollTop = 0
    const textAreaRef = { current: input }
    const isProgrammaticScrollRef = { current: true }

    const onScroll = createOutputScrollHandler(textAreaRef, isProgrammaticScrollRef, true)
    onScroll(createOutputEvent())

    expect(input.scrollTop).toBe(0)
  })
})
