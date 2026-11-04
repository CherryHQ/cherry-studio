import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { AgentChildUpdate, AgentChildView } from '@shared/ai/agentChildProjection'

import { useAgentChildProjection } from '../useAgentChildProjection'

// Catches lost updates during attach, duplicate replay, and stale delivery after changing children.
it('joins snapshot and live patches, repairs a revision gap, and fences an old child', async () => {
  let deliver!: (event: unknown) => void
  let resolve!: (value: unknown) => void
  let subscriptionId = ''
  const view: AgentChildView = {
    kind: 'child',
    contextId: 'c',
    sessionId: 'archive',
    revision: 0,
    active: true,
    available: true,
    messages: [{ id: 'm', role: 'assistant', parts: [{ type: 'text', text: 'first', state: 'streaming' }] }]
  }
  vi.spyOn(window.api.ipcApi, 'on').mockImplementation((_event, listener) => {
    deliver = listener
    return () => {}
  })
  const request = vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route !== 'ai.projection.attach') return { ok: true, data: undefined }
    subscriptionId = (input as { subscriptionId: string }).subscriptionId
    return new Promise((done) => {
      resolve = done
    })
  })
  const { result, rerender, unmount } = renderHook(({ child }) => useAgentChildProjection('owner', child, true), {
    initialProps: { child: 'one' }
  })
  const patch: AgentChildUpdate = {
    kind: 'child',
    sessionId: 'archive',
    contextId: 'c',
    revision: 1,
    patches: [{ type: 'append', messageId: 'm', part: 0, text: ' second' }],
    order: ['m'],
    active: true,
    available: true
  }
  await act(async () => {
    deliver({ subscriptionId, update: patch })
    resolve({ ok: true, data: view })
  })
  expect(result.current?.view?.messages[0].parts[0]).toMatchObject({ text: 'first second' })
  act(() => deliver({ subscriptionId, update: patch }))
  expect(result.current?.view?.messages[0].parts[0]).toMatchObject({ text: 'first second' })
  act(() => deliver({ subscriptionId, update: { ...patch, revision: 3 } }))
  await act(async () => {
    resolve({
      ok: true,
      data: { ...view, revision: 3, messages: [{ ...view.messages[0], parts: [{ type: 'text', text: 'recovered' }] }] }
    })
  })
  expect(result.current?.view?.messages[0].parts[0]).toMatchObject({ text: 'recovered' })
  const old = subscriptionId
  rerender({ child: 'two' })
  expect(result.current?.view).toBeNull()
  act(() => deliver({ subscriptionId: old, update: { ...patch, revision: 4 } }))
  await act(async () => {
    resolve({ ok: true, data: { ...view, contextId: 'other', messages: [] } })
  })
  await waitFor(() => expect(result.current?.view?.contextId).toBe('other'))
  expect(result.current?.view?.messages).toEqual([])
  act(() => deliver({ subscriptionId, update: { ...patch, revision: 3 } }))
  await act(async () => {
    for (let revision = 4; revision <= 104; revision++) deliver({ subscriptionId, update: { ...patch, revision } })
    resolve({ ok: true, data: { ...view, revision: 3 } })
  })
  await act(async () => {
    resolve({
      ok: true,
      data: { ...view, revision: 104, messages: [{ ...view.messages[0], parts: [{ type: 'text', text: 'latest' }] }] }
    })
  })
  expect(result.current?.view?.revision).toBe(104)
  expect(result.current?.view?.messages[0].parts[0]).toMatchObject({ text: 'latest' })
  unmount()
  expect(
    request.mock.calls.every(([route]) => route === 'ai.projection.attach' || route === 'ai.projection.detach')
  ).toBe(true)
  vi.restoreAllMocks()
})
