import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { useStableMessagePartsLayers, useStablePartsByMessageId } from '../useStableMessagePartsLayers'

function makeMessage(id: string, parts: CherryMessagePart[]): CherryUIMessage {
  return { id, role: 'assistant', parts } as unknown as CherryUIMessage
}

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text })

describe('useStablePartsByMessageId', () => {
  it('preserves per-id array ref when only one message has new parts (streaming case)', () => {
    const partsA = [textPart('a')]
    const partsBOriginal = [textPart('b1')]
    const partsBAppended = [textPart('b1'), textPart('b2')]

    const messagesT1 = [makeMessage('m1', partsA), makeMessage('m2', partsBOriginal)]
    const messagesT2 = [makeMessage('m1', partsA), makeMessage('m2', partsBAppended)]

    const { result, rerender } = renderHook(({ msgs }) => useStablePartsByMessageId(msgs, {}), {
      initialProps: { msgs: messagesT1 }
    })

    const first = result.current
    expect(first['m1']).toBe(partsA)
    expect(first['m2']).toBe(partsBOriginal)

    rerender({ msgs: messagesT2 })

    // m1 unchanged — same ref reused

    // m2 changed — got the new parts ref
    expect(result.current['m2']).toBe(partsBAppended)
    // container changed because m2 changed
  })

  it('produces a new container when a message id is removed', () => {
    const partsA = [textPart('a')]
    const partsB = [textPart('b')]
    const msgsT1 = [makeMessage('m1', partsA), makeMessage('m2', partsB)]
    const msgsT2 = [makeMessage('m1', partsA)]

    const { result, rerender } = renderHook(({ msgs }) => useStablePartsByMessageId(msgs, {}), {
      initialProps: { msgs: msgsT1 }
    })

    rerender({ msgs: msgsT2 })

    expect('m2' in result.current).toBe(false)
  })

  it('honors execution overlay over message.parts and keeps it stable across renders', () => {
    const partsBase = [textPart('base')]
    const overlayParts = [textPart('overlay')]
    const messages = [makeMessage('m1', partsBase)]
    const initialOverlay: Record<string, CherryMessagePart[]> = { m1: overlayParts }

    const { result, rerender } = renderHook(
      ({ ov }: { ov: Record<string, CherryMessagePart[]> }) => useStablePartsByMessageId(messages, ov),
      { initialProps: { ov: initialOverlay } }
    )

    expect(result.current['m1']).toBe(overlayParts)

    // Same overlay re-passed — container stable

    rerender({ ov: { m1: overlayParts } })

    expect(result.current['m1']).toBe(overlayParts)

    // Empty overlay → fall back to message.parts; container changes
    rerender({ ov: {} })

    expect(result.current['m1']).toBe(partsBase)
  })

  it('tracks overlay-only messages without adding them to sealed history', () => {
    const historyParts = [textPart('history')]
    const liveParts = [textPart('live')]
    const retainedLiveParts = [textPart('retained-live')]
    const messages = [makeMessage('m1', historyParts)]
    const initialOverlay: Record<string, CherryMessagePart[]> = {
      'live-m2': liveParts,
      'live-m3': retainedLiveParts
    }

    const { result, rerender } = renderHook(
      ({ ov }: { ov: Record<string, CherryMessagePart[]> }) => useStableMessagePartsLayers(messages, ov),
      {
        initialProps: { ov: initialOverlay }
      }
    )

    expect(result.current.historyPartsByMessageId['live-m2']).toBeUndefined()
    expect(result.current.historyPartsByMessageId['live-m3']).toBeUndefined()
    expect(result.current.partsByMessageId['live-m2']).toBe(liveParts)
    expect(result.current.partsByMessageId['live-m3']).toBe(retainedLiveParts)

    rerender({ ov: { 'live-m2': liveParts, 'live-m3': retainedLiveParts } })

    expect(result.current.partsByMessageId['live-m2']).toBe(liveParts)
    expect(result.current.partsByMessageId['live-m3']).toBe(retainedLiveParts)

    rerender({ ov: { 'live-m3': retainedLiveParts } })
    expect(result.current.partsByMessageId['live-m2']).toBeUndefined()
    expect(result.current.partsByMessageId['live-m3']).toBe(retainedLiveParts)

    rerender({ ov: {} })
    expect(result.current.partsByMessageId['live-m2']).toBeUndefined()
    expect(result.current.partsByMessageId['live-m3']).toBeUndefined()
  })
})
