import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { toolResultService } from '@renderer/services/aiTransport'
import type { AiToolResultResponse, DeferredToolResultRef } from '@shared/ai/transport'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'

import { useToolResult } from '../useToolResult'

afterEach(() => {
  toolResultService.invalidateTopic('topic')
  vi.restoreAllMocks()
})

// Replacement must refresh an open card even when its stable identity does not change.
it('updates the same tool identity after invalidation and drops it when the card closes', async () => {
  let output = 'First output'.repeat(4096)
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route !== 'ai.tool.get_result') throw new Error(`Unexpected route: ${route}`)
    const request = aiRequestSchemas['ai.tool.get_result'].input.parse(input)
    expect(request.purpose).toBe('preview')
    return { ok: true, data: { status: 'ready', purpose: 'preview', output, truncated: true } }
  })
  const ref: DeferredToolResultRef = { topicId: 'topic', messageId: 'reply', toolCallId: 'tool' }
  const initialProps: { ref: DeferredToolResultRef | undefined } = { ref }
  const { result, rerender } = renderHook(({ ref }: { ref: DeferredToolResultRef | undefined }) => useToolResult(ref), {
    initialProps
  })
  await waitFor(() => expect(result.current.output).toBe(output))
  const generation = result.current.generation
  output = 'Replacement output'.repeat(4096)
  act(() => toolResultService.invalidate(ref))
  await waitFor(() => expect(result.current.output).toBe(output))
  expect(result.current.generation).toBeGreaterThan(generation)
  rerender({ ref: undefined })
  expect(result.current.output).toBeUndefined()
  expect(result.current.isLoading).toBe(false)
})

// Availability describes a detail read, independently from whether the tool execution finished.
it('exposes pending and unavailable separately and retries pending when the projection invalidates it', async () => {
  let response: AiToolResultResponse = { status: 'pending' }
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async () => ({ ok: true, data: response }))
  const ref: DeferredToolResultRef = { topicId: 'topic', messageId: 'reply', toolCallId: 'pending' }
  const { result } = renderHook(() => useToolResult(ref))
  await waitFor(() => expect(result.current.state.status).toBe('pending'))
  expect(result.current.error).toBeUndefined()
  response = { status: 'unavailable' }
  act(() => toolResultService.invalidate(ref))
  await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
  expect(result.current.error).toBeUndefined()
})

// A deliberately requested large full value must reach the open reader without entering the shared cache.
it('delivers an explicit full read larger than the shared cache and releases it on close', async () => {
  const output = 'full'.repeat(5 * 1024 * 1024)
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route !== 'ai.tool.get_result') throw new Error(`Unexpected route: ${route}`)
    const request = aiRequestSchemas['ai.tool.get_result'].input.parse(input)
    expect(request.purpose).toBe('full')
    return { ok: true, data: { status: 'ready', purpose: 'full', output } }
  })
  const ref: DeferredToolResultRef = { topicId: 'topic', messageId: 'reply', toolCallId: 'full' }
  const initialProps: { ref: DeferredToolResultRef | undefined } = { ref }
  const { result, rerender } = renderHook(
    ({ ref }: { ref: DeferredToolResultRef | undefined }) => useToolResult(ref, 'full'),
    { initialProps }
  )
  await waitFor(() => expect(result.current.output).toBe(output))
  expect(toolResultService.getSnapshot(ref, { purpose: 'full' })).toEqual({ status: 'idle' })
  rerender({ ref: undefined })
  expect(result.current.output).toBeUndefined()
  expect(result.current.state).toEqual({ status: 'idle' })
})
