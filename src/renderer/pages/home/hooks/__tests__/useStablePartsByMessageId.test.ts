import type { TranslationOverlayEntry } from '@renderer/components/chat/messages/blocks'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useStablePartsByMessageId } from '../useStablePartsByMessageId'

function makeMessage(id: string, parts: CherryMessagePart[]): CherryUIMessage {
  return { id, role: 'assistant', parts } as unknown as CherryUIMessage
}

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart

describe('useStablePartsByMessageId', () => {
  it('preserves container ref when nothing changes across renders', () => {
    const partsA = [textPart('a')]
    const partsB = [textPart('b')]
    const messages = [makeMessage('m1', partsA), makeMessage('m2', partsB)]
    const overlay: Record<string, CherryMessagePart[]> = {}
    const translationOverlay: Record<string, TranslationOverlayEntry> = {}

    const { result, rerender } = renderHook(({ msgs, ov, tov }) => useStablePartsByMessageId(msgs, ov, tov), {
      initialProps: { msgs: messages, ov: overlay, tov: translationOverlay }
    })

    const first = result.current
    // re-render with the SAME messages array — container should be preserved
    rerender({ msgs: messages, ov: overlay, tov: translationOverlay })
    expect(result.current).toBe(first)

    // re-render with a new array but element-identical message refs — still stable
    const messagesRefRenewed = [...messages]
    rerender({ msgs: messagesRefRenewed, ov: overlay, tov: translationOverlay })
    expect(result.current).toBe(first)
  })

  it('preserves per-id array ref when only one message has new parts (streaming case)', () => {
    const partsA = [textPart('a')]
    const partsBOriginal = [textPart('b1')]
    const partsBAppended = [textPart('b1'), textPart('b2')]

    const messagesT1 = [makeMessage('m1', partsA), makeMessage('m2', partsBOriginal)]
    const messagesT2 = [makeMessage('m1', partsA), makeMessage('m2', partsBAppended)]

    const { result, rerender } = renderHook(({ msgs }) => useStablePartsByMessageId(msgs, {}, {}), {
      initialProps: { msgs: messagesT1 }
    })

    const first = result.current
    expect(first['m1']).toBe(partsA)
    expect(first['m2']).toBe(partsBOriginal)

    rerender({ msgs: messagesT2 })

    // m1 unchanged — same ref reused
    expect(result.current['m1']).toBe(first['m1'])
    // m2 changed — got the new parts ref
    expect(result.current['m2']).toBe(partsBAppended)
    // container changed because m2 changed
    expect(result.current).not.toBe(first)
  })

  it('produces a new container when a message id is added', () => {
    const partsA = [textPart('a')]
    const msgsT1 = [makeMessage('m1', partsA)]
    const msgsT2 = [makeMessage('m1', partsA), makeMessage('m2', [textPart('b')])]

    const { result, rerender } = renderHook(({ msgs }) => useStablePartsByMessageId(msgs, {}, {}), {
      initialProps: { msgs: msgsT1 }
    })

    const first = result.current
    rerender({ msgs: msgsT2 })
    expect(result.current).not.toBe(first)
    // The pre-existing message keeps its ref
    expect(result.current['m1']).toBe(first['m1'])
  })

  it('produces a new container when a message id is removed', () => {
    const partsA = [textPart('a')]
    const partsB = [textPart('b')]
    const msgsT1 = [makeMessage('m1', partsA), makeMessage('m2', partsB)]
    const msgsT2 = [makeMessage('m1', partsA)]

    const { result, rerender } = renderHook(({ msgs }) => useStablePartsByMessageId(msgs, {}, {}), {
      initialProps: { msgs: msgsT1 }
    })

    const first = result.current
    rerender({ msgs: msgsT2 })
    expect(result.current).not.toBe(first)
    expect(result.current['m1']).toBe(first['m1'])
    expect('m2' in result.current).toBe(false)
  })

  it('honors execution overlay over message.parts and keeps it stable across renders', () => {
    const partsBase = [textPart('base')]
    const overlayParts = [textPart('overlay')]
    const messages = [makeMessage('m1', partsBase)]

    const { result, rerender } = renderHook(
      ({ ov }: { ov: Record<string, CherryMessagePart[]> }) => useStablePartsByMessageId(messages, ov, {}),
      { initialProps: { ov: { m1: overlayParts } as Record<string, CherryMessagePart[]> } }
    )

    expect(result.current['m1']).toBe(overlayParts)

    // Same overlay re-passed — container stable
    const first = result.current
    rerender({ ov: { m1: overlayParts } })
    expect(result.current).toBe(first)
    expect(result.current['m1']).toBe(overlayParts)

    // Empty overlay → fall back to message.parts; container changes
    rerender({ ov: {} })
    expect(result.current).not.toBe(first)
    expect(result.current['m1']).toBe(partsBase)
  })

  it('appends and clears a translation overlay part correctly', () => {
    const partsBase = [textPart('hello')]
    const messages = [makeMessage('m1', partsBase)]
    const trEntry: TranslationOverlayEntry = {
      content: 'bonjour',
      targetLanguage: 'fr-FR' as TranslationOverlayEntry['targetLanguage']
    }

    const { result, rerender } = renderHook(
      ({ tov }: { tov: Record<string, TranslationOverlayEntry> }) => useStablePartsByMessageId(messages, {}, tov),
      { initialProps: { tov: {} as Record<string, TranslationOverlayEntry> } }
    )

    expect(result.current['m1']).toBe(partsBase)

    // Add translation overlay — new array with appended translation part,
    // base part still ref-equal so the existing block renderer can skip.
    rerender({ tov: { m1: trEntry } })
    const withOverlay = result.current['m1']
    expect(withOverlay).not.toBe(partsBase)
    expect(withOverlay.length).toBe(2)
    expect(withOverlay[0]).toBe(partsBase[0])
    expect(withOverlay[1].type).toBe('data-translation')

    // Remove overlay — back to baseParts ref
    rerender({ tov: {} })
    expect(result.current['m1']).toBe(partsBase)
  })
})
