import type { Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: { id: 'assistant-1' }, model: undefined })
}))

import { useV2RenderingPipeline } from '../useV2RenderingPipeline'

const topic = (id = 'topic-1') => ({ id, assistantId: 'assistant-1' }) as Topic
const part = (text: string): CherryMessagePart => ({ type: 'text', text })

function msg(id: string, role: 'user' | 'assistant', text: string, status?: string): CherryUIMessage {
  return {
    id,
    role,
    parts: text ? [part(text)] : [],
    metadata: status ? { status } : {}
  } as CherryUIMessage
}

const textOf = (parts: CherryMessagePart[] | undefined) =>
  (parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')

describe('useV2RenderingPipeline — monotonic overlay merge', () => {
  it('DB pending + overlay non-empty → overlay wins', () => {
    const ui = [msg('u', 'user', 'hi'), msg('a', 'assistant', '', 'pending')]
    const { result } = renderHook(() => useV2RenderingPipeline(ui, topic(), { a: [part('streaming')] }))
    expect(textOf(result.current.mergedPartsMap['a'])).toBe('streaming')
  })

  it('overlay always wins while it has content, regardless of DB status', () => {
    const ui = [msg('u', 'user', 'hi'), msg('a', 'assistant', 'persisted', 'success')]
    const { result } = renderHook(() => useV2RenderingPipeline(ui, topic(), { a: [part('live-stream')] }))
    expect(textOf(result.current.mergedPartsMap['a'])).toBe('live-stream')
  })

  it('overlay empty → DB parts win (no last-good retention)', () => {
    const ui = [msg('u', 'user', 'hi'), msg('a', 'assistant', '', 'pending')]
    const { result, rerender } = renderHook(
      ({ overlay }: { overlay: Record<string, CherryMessagePart[]> }) => useV2RenderingPipeline(ui, topic(), overlay),
      { initialProps: { overlay: { a: [part('answer so far')] } as Record<string, CherryMessagePart[]> } }
    )
    expect(textOf(result.current.mergedPartsMap['a'])).toBe('answer so far')

    rerender({ overlay: {} })
    expect(textOf(result.current.mergedPartsMap['a'])).toBe('')
  })

  it('hand-off: once DB row becomes final, DB wins and last-good is cleared', () => {
    const { result, rerender } = renderHook(
      ({ ui, overlay }: { ui: CherryUIMessage[]; overlay: Record<string, CherryMessagePart[]> }) =>
        useV2RenderingPipeline(ui, topic(), overlay),
      {
        initialProps: {
          ui: [msg('u', 'user', 'hi'), msg('a', 'assistant', '', 'pending')],
          overlay: { a: [part('live')] } as Record<string, CherryMessagePart[]>
        }
      }
    )
    expect(textOf(result.current.mergedPartsMap['a'])).toBe('live')

    rerender({ ui: [msg('u', 'user', 'hi'), msg('a', 'assistant', 'final', 'success')], overlay: {} })
    expect(textOf(result.current.mergedPartsMap['a'])).toBe('final')
  })

  it('topic switch clears retained last-good', () => {
    const { result, rerender } = renderHook(
      ({ t, ui, overlay }: { t: Topic; ui: CherryUIMessage[]; overlay: Record<string, CherryMessagePart[]> }) =>
        useV2RenderingPipeline(ui, t, overlay),
      {
        initialProps: {
          t: topic('topic-1'),
          ui: [msg('a', 'assistant', '', 'pending')],
          overlay: { a: [part('topic1-stream')] } as Record<string, CherryMessagePart[]>
        }
      }
    )
    expect(textOf(result.current.mergedPartsMap['a'])).toBe('topic1-stream')

    // Different topic, same message id reused as a fresh pending row.
    rerender({ t: topic('topic-2'), ui: [msg('a', 'assistant', '', 'pending')], overlay: {} })
    expect(textOf(result.current.mergedPartsMap['a'])).toBe('')
  })
})
