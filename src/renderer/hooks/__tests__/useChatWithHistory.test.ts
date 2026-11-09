import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { useChatWithHistory } from '../useChatWithHistory'

const EMPTY: CherryUIMessage[] = []
afterEach(() => vi.restoreAllMocks())

// Dropping body selections would silently call a different model or lose the branch anchor.
it('sends explicit user input and request controls without opening a chunk stream', async () => {
  const ipc = projectionIpc()
  const fallback = ipc.request.getMockImplementation()!
  const accepted: unknown[] = []
  ipc.request.mockImplementation(async (route, input) => {
    if (route === 'ai.stream.open') {
      accepted.push(input)
      return { ok: true, data: { mode: 'started' } }
    }
    return fallback(route, input)
  })
  const hook = renderHook(() => useChatWithHistory('commands', EMPTY, async () => EMPTY))
  await act(async () => {
    await hook.result.current.sendMessage(
      { text: 'question' },
      {
        body: {
          parentAnchorId: 'branch',
          mentionedModels: ['p::m'],
          fastMode: true,
          serviceTier: 'priority'
        }
      }
    )
  })
  expect(accepted).toEqual([
    {
      trigger: 'submit-message',
      topicId: 'commands',
      parentAnchorId: 'branch',
      userMessageParts: [{ type: 'text', text: 'question' }],
      mentionedModelIds: ['p::m'],
      fastMode: true,
      serviceTier: 'priority',
      reasoningEffort: undefined
    }
  ])
  expect(hook.result.current.messages[0]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'question' }] })
  expect(ipc.request.mock.calls.map(([route]) => route)).not.toContain('ai.stream.attach')
  hook.unmount()
})

// A delayed command failure belongs to its captured topic, not the next selected conversation.
it('fences old dispatch errors and waits for the Main stop barrier', async () => {
  const ipc = projectionIpc()
  const fallback = ipc.request.getMockImplementation()!
  let reject!: (error: Error) => void
  let stop!: () => void
  ipc.request.mockImplementation(async (route, input) => {
    if (route === 'ai.stream.open')
      return new Promise((_resolve, fail) => {
        reject = fail
      })
    if (route === 'ai.stream.abort') {
      await new Promise<void>((resolve) => {
        stop = resolve
      })
      return { ok: true, data: undefined }
    }
    return fallback(route, input)
  })
  const hook = renderHook(({ topic }) => useChatWithHistory(topic, EMPTY, async () => EMPTY), {
    initialProps: { topic: 'old-command' }
  })
  let sent!: Promise<void>
  act(() => {
    sent = hook.result.current.sendMessage({ text: 'old input' })
  })
  hook.rerender({ topic: 'new-command' })
  await act(async () => {
    reject(new Error('old failure'))
    await sent
  })
  expect(hook.result.current.error).toBeUndefined()
  expect(hook.result.current.messages).toEqual([])
  let settled = false
  let stopping!: Promise<void>
  act(() => {
    stopping = hook.result.current.stop().then(() => {
      settled = true
    })
  })
  expect(settled).toBe(false)
  await act(async () => {
    stop()
    await stopping
  })
  expect(settled).toBe(true)
  hook.unmount()
})
