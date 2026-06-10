import type { CherryMessagePart } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  parseBlockId,
  PartsProvider,
  RefreshProvider,
  resolvePartFromParts,
  TranslationOverlayProvider,
  TranslationOverlaySetterProvider,
  useHasMessageParts,
  useMessageParts,
  useOptionalTranslationOverlaySetter,
  usePartsMap,
  useRefresh,
  useTranslationOverlayEntry,
  useTranslationOverlaySetter
} from '..'

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart

describe('MessagePartsContext helpers', () => {
  it('parses block ids from the last block marker', () => {
    expect(parseBlockId('message-1-block-2')).toEqual({ messageId: 'message-1', index: 2 })
    expect(parseBlockId('message-block-name-block-10')).toEqual({ messageId: 'message-block-name', index: 10 })
  })

  it('rejects invalid block ids', () => {
    expect(parseBlockId('message-1-part-2')).toBeNull()
    expect(parseBlockId('message-1-block-x')).toBeNull()
    expect(parseBlockId('message-1')).toBeNull()
  })

  it('resolves parts from block and part ids', () => {
    const first = textPart('first')
    const second = textPart('second')
    const partsMap = {
      'message-1': [first, second],
      'message-part-name': [first]
    }

    expect(resolvePartFromParts(partsMap, 'message-1-block-1')).toEqual({
      part: second,
      messageId: 'message-1',
      index: 1
    })
    expect(resolvePartFromParts(partsMap, 'message-part-name-part-0')).toEqual({
      part: first,
      messageId: 'message-part-name',
      index: 0
    })
  })

  it('returns null when a part id cannot be resolved', () => {
    const partsMap = { 'message-1': [textPart('first')] }

    expect(resolvePartFromParts(partsMap, 'message-1-block-3')).toBeNull()
    expect(resolvePartFromParts(partsMap, 'missing-message-block-0')).toBeNull()
    expect(resolvePartFromParts(partsMap, 'message-1')).toBeNull()
  })
})

describe('MessagePartsContext hooks', () => {
  it('reads message parts from provider context', () => {
    const partsMap = {
      'message-1': [textPart('first'), textPart('second')]
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PartsProvider value={partsMap}>{children}</PartsProvider>
    )

    const { result } = renderHook(
      () => ({
        hasParts: useHasMessageParts(),
        map: usePartsMap(),
        parts: useMessageParts('message-1'),
        missingParts: useMessageParts('missing-message')
      }),
      { wrapper }
    )

    expect(result.current.hasParts).toBe(true)
    expect(result.current.map).toBe(partsMap)
    expect(result.current.parts).toEqual(partsMap['message-1'])
    expect(result.current.missingParts).toEqual([])
  })

  it('returns safe defaults without optional providers', () => {
    const { result } = renderHook(() => ({
      hasParts: useHasMessageParts(),
      parts: useMessageParts('message-1'),
      optionalSetter: useOptionalTranslationOverlaySetter(),
      refresh: useRefresh()
    }))

    expect(result.current.hasParts).toBe(false)
    expect(result.current.parts).toEqual([])
    expect(result.current.optionalSetter).toBeNull()
    expect(() => result.current.refresh()).not.toThrow()
  })

  it('reads refresh and translation overlay providers', () => {
    const refresh = vi.fn()
    const setter = vi.fn()
    const overlay = {
      'message-1': {
        content: 'translated',
        targetLanguage: 'en-US' as const
      }
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RefreshProvider value={refresh}>
        <TranslationOverlayProvider value={overlay}>
          <TranslationOverlaySetterProvider value={setter}>{children}</TranslationOverlaySetterProvider>
        </TranslationOverlayProvider>
      </RefreshProvider>
    )

    const { result } = renderHook(
      () => ({
        refresh: useRefresh(),
        entry: useTranslationOverlayEntry('message-1'),
        missingEntry: useTranslationOverlayEntry('missing-message'),
        setter: useTranslationOverlaySetter(),
        optionalSetter: useOptionalTranslationOverlaySetter()
      }),
      { wrapper }
    )

    result.current.refresh()
    result.current.setter('message-1', null)

    expect(refresh).toHaveBeenCalledOnce()
    expect(setter).toHaveBeenCalledWith('message-1', null)
    expect(result.current.entry).toBe(overlay['message-1'])
    expect(result.current.missingEntry).toBeUndefined()
    expect(result.current.optionalSetter).toBe(setter)
  })

  it('throws for the strict translation setter without provider', () => {
    expect(() => renderHook(() => useTranslationOverlaySetter())).toThrow(
      'useTranslationOverlaySetter must be used inside TranslationOverlaySetterProvider'
    )
  })
})
