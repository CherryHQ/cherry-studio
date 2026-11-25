import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, expect, it, vi } from 'vitest'

import type { DeferredToolResultRef } from '@shared/ai/transport'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'

import { useToolResult } from '../useToolResult'

afterEach(() => vi.restoreAllMocks())

// The same tool call can replace its large output; immutable cache identity must follow the value.
it('fetches replacement output and drops a removed tool without leaking revision into strict IPC input', async () => {
  let output = 'First output'.repeat(4096)
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route !== 'ai.tool.get_result') throw new Error(`Unexpected route: ${route}`)
    aiRequestSchemas['ai.tool.get_result'].input.parse(input)
    return { ok: true, data: { found: true, output } }
  })
  const cache = new Map()
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(SWRConfig, { value: { provider: () => cache } }, children)
  const ref = { topicId: 'topic', messageId: 'reply', toolCallId: 'tool', revision: 'first' }
  const initialProps: { ref: DeferredToolResultRef | undefined } = { ref }
  const { result, rerender } = renderHook(({ ref }: { ref: DeferredToolResultRef | undefined }) => useToolResult(ref), {
    initialProps,
    wrapper
  })
  await waitFor(() => expect(result.current.output).toBe(output))
  output = 'Replacement output'.repeat(4096)
  rerender({ ref: { ...ref, revision: 'replacement' } })
  await waitFor(() => expect(result.current.output).toBe(output))
  rerender({ ref: undefined })
  expect(result.current.output).toBeUndefined()
})
