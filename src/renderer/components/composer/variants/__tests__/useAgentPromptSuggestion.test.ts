import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'

import { useAgentPromptSuggestion } from '../agent/useAgentPromptSuggestion'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const model: Model = {
  id: 'openai::gpt-test',
  providerId: 'openai',
  name: 'Test',
  capabilities: ['function-call'],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}
const reply = (id: string, status = 'success'): CherryUIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text: 'The bug is fixed.' }],
  metadata: { status: status as 'success' }
})
const initial = { sessionId: 'one', messages: [reply('answer')], model, busy: true, blocked: false }
const request = vi.mocked(ipcApi.request)

beforeEach(() => {
  vi.useFakeTimers()
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setPreferenceValue('agent.input.suggestions.enabled', true)
  request.mockReset()
  request.mockResolvedValue({ text: 'Run the relevant tests.' })
})
afterEach(() => vi.useRealTimers())

async function complete(rerender: (props: typeof initial) => void, props = initial) {
  rerender({ ...props, busy: false })
  await act(() => vi.advanceTimersByTimeAsync(0))
}

it('predicts after completion without adding tools, attachments, or reasoning to context', async () => {
  const messages: CherryUIMessage[] = [
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Fix this bug.' }] },
    { ...reply('answer'), parts: [{ type: 'reasoning', text: 'private reasoning' }, ...reply('answer').parts] }
  ]
  const props = { ...initial, messages }
  const { result, rerender } = renderHook(useAgentPromptSuggestion, { initialProps: props })
  await complete(rerender, props)
  expect(result.current.text).toBe('Run the relevant tests.')
  const call = request.mock.calls.find(([route]) => route === 'ai.text.generate')![1] as {
    prompt: string
    uniqueModelId: string
  }
  expect(JSON.parse(call.prompt)).toEqual([
    { role: 'user', text: 'Fix this bug.' },
    { role: 'assistant', text: 'The bug is fixed.' }
  ])
  expect(call.uniqueModelId).toBe(model.id)
  expect(call).toMatchObject({
    disableTools: true,
    reasoningEffort: 'none',
    requestOptions: { maxRetries: 0, timeout: 10_000 }
  })
})

it.each([
  { selectableEfforts: ['high', 'low', 'none'], expected: 'none' },
  { selectableEfforts: ['high', 'low', 'minimal'], expected: 'minimal' },
  { selectableEfforts: ['high', 'medium', 'low'], expected: 'low' }
] as const)('requests the lowest supported reasoning level: $expected', async ({ selectableEfforts, expected }) => {
  const props: typeof initial = {
    ...initial,
    model: {
      ...model,
      capabilities: ['reasoning'] as Model['capabilities'],
      reasoning: { selectableEfforts: [...selectableEfforts] }
    }
  }
  const { rerender } = renderHook(useAgentPromptSuggestion, { initialProps: props })
  await complete(rerender, props)
  expect(request).toHaveBeenCalledWith('ai.text.generate', expect.objectContaining({ reasoningEffort: expected }))
})

it('bounds prediction context while retaining the latest text from each message', async () => {
  const props: typeof initial = {
    ...initial,
    messages: [{ ...reply('long'), parts: [{ type: 'text' as const, text: 'old'.repeat(1000) + 'LATEST' }] }]
  }
  const { rerender } = renderHook(useAgentPromptSuggestion, { initialProps: props })
  await complete(rerender, props)
  const call = request.mock.calls.find(([route]) => route === 'ai.text.generate')![1] as { prompt: string }
  const context = JSON.parse(call.prompt)
  expect(context[0].text).toHaveLength(1000)
  expect(context[0].text.endsWith('LATEST')).toBe(true)
})

it('does not spend a request when opening history or when disabled or unsuccessful', async () => {
  const { rerender } = renderHook(useAgentPromptSuggestion, { initialProps: { ...initial, busy: false } })
  await act(() => vi.advanceTimersByTimeAsync(300))
  rerender({ ...initial, messages: [reply('failed', 'error')], busy: false })
  await act(() => vi.advanceTimersByTimeAsync(300))
  MockUsePreferenceUtils.setPreferenceValue('agent.input.suggestions.enabled', false)
  rerender({ ...initial, messages: [reply('new')], busy: false })
  await act(() => vi.advanceTimersByTimeAsync(300))
  expect(request).not.toHaveBeenCalled()
})

it('cancels on user input and never resurrects the suggestion after clearing the draft', async () => {
  let resolve!: (value: never) => void
  request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }) as never
  )
  const { result, rerender } = renderHook(useAgentPromptSuggestion, { initialProps: initial })
  await complete(rerender)
  const finish = resolve
  rerender({ ...initial, busy: false, blocked: true })
  expect(request).toHaveBeenCalledWith('ai.text.abort', expect.objectContaining({ requestId: expect.any(String) }))
  await act(async () => finish({ text: 'Stale prediction' } as never))
  rerender({ ...initial, busy: false })
  await act(() => vi.advanceTimersByTimeAsync(300))
  expect(result.current.text).toBe('')
  expect(request.mock.calls.filter(([route]) => route === 'ai.text.generate')).toHaveLength(1)
})

it('ignores a late prediction after switching sessions', async () => {
  let resolve!: (value: never) => void
  request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }) as never
  )
  const { result, rerender } = renderHook(useAgentPromptSuggestion, { initialProps: initial })
  await complete(rerender)
  const finish = resolve
  rerender({ ...initial, sessionId: 'two' })
  await act(async () => finish({ text: 'Wrong session' } as never))
  expect(result.current.text).toBe('')
})

it('does not restore an obsolete suggestion when switching models and back', async () => {
  const { result, rerender } = renderHook(useAgentPromptSuggestion, { initialProps: initial })
  await complete(rerender)
  expect(result.current.text).not.toBe('')
  rerender({ ...initial, busy: false, model: { ...model, id: 'openai::other' } })
  expect(result.current.text).toBe('')
  rerender({ ...initial, busy: false })
  await act(() => vi.advanceTimersByTimeAsync(300))
  expect(result.current.text).toBe('')
  expect(request.mock.calls.filter(([route]) => route === 'ai.text.generate')).toHaveLength(1)
})

it('dismisses a suggestion for this reply without requesting it again', async () => {
  const { result, rerender } = renderHook(useAgentPromptSuggestion, { initialProps: initial })
  await complete(rerender)
  expect(result.current.text).not.toBe('')
  act(() => result.current.dismiss())
  rerender({ ...initial, busy: false, messages: [...initial.messages] })
  await act(() => vi.advanceTimersByTimeAsync(300))
  expect(result.current.text).toBe('')
  expect(request.mock.calls.filter(([route]) => route === 'ai.text.generate')).toHaveLength(1)
})

it.each(['', 'First suggestion\nSecond suggestion', 'x'.repeat(121)])('discards unusable output %j', async (text) => {
  request.mockResolvedValue({ text })
  const { result, rerender } = renderHook(useAgentPromptSuggestion, { initialProps: initial })
  await complete(rerender)
  expect(result.current.text).toBe('')
})

it('keeps the composer usable when prediction fails', async () => {
  request.mockRejectedValue(new Error('Unsupported provider'))
  const { result, rerender } = renderHook(useAgentPromptSuggestion, { initialProps: initial })
  await complete(rerender)
  expect(result.current.text).toBe('')
})
