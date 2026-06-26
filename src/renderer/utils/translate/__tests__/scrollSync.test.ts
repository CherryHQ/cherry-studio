import type React from 'react'
import { describe, expect, it } from 'vitest'

import { createOutputScrollHandler } from '../scrollSync'

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
        ...overrides
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
