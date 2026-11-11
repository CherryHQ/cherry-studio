import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { ScreenshotChatEventSchemas } from '@shared/ipc/schemas/screenshotChat'

import { emptyActions } from '../composerProviderActions'
import { useScreenshotChat } from '../useScreenshotChat'

vi.mock('@renderer/hooks/tab', () => ({ useIsActiveTab: () => true }))

type Attachment = ScreenshotChatEventSchemas['chat.screenshot.attachment']
const listeners = new Set<(event: Attachment) => void>()
const request = () => vi.mocked(window.api.ipcApi.request)
const target = () =>
  (
    request().mock.calls.findLast(([name]) => name === 'chat.screenshot.target')?.[1] as
      | { scopeKey: string | null }
      | undefined
  )?.scopeKey

beforeEach(() => {
  listeners.clear()
  request().mockResolvedValue({ ok: true, data: undefined })
  vi.mocked(window.api.ipcApi.on).mockImplementation((name, listener) => {
    if (name !== 'chat.screenshot.attachment') return () => {}
    const receive = listener as (event: Attachment) => void
    listeners.add(receive)
    return () => listeners.delete(receive)
  })
})

function useComposer(scopeKey: string, registerOnMount: boolean, active = true) {
  const [files, setFiles] = useState<ComposerAttachment[]>([])
  const [text, setText] = useState('')
  const actionsRef = useRef({
    ...emptyActions,
    appendText: (value: string) => {
      setText(value)
      return true
    }
  })
  return {
    ...useScreenshotChat({ scopeKey, registerOnMount, active, actionsRef, setFiles, isBlocked: () => false }),
    files,
    text
  }
}

it.each(['main', 'side'])('delivers only to the %s composer while both are mounted', async (destination) => {
  const main = renderHook(() => useComposer('main', true))
  const mainTarget = target()
  const side = renderHook(() => useComposer('side', false))
  await act(async () => side.result.current.startScreenshot())
  const sideTarget = target()
  const blob = new Blob(['png'], { type: 'image/png' })
  const loading = Promise.withResolvers<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => loading.promise)
  )
  const capture: Attachment = {
    deliveryId: `capture-${destination}`,
    scopeKey: (destination === 'main' ? mainTarget : sideTarget) as string,
    imageUrl: 'cherry-media://image/capture',
    name: 'capture.png',
    size: blob.size,
    text: 'Explain this'
  }
  act(() => listeners.forEach((receive) => receive(capture)))
  expect(request().mock.calls.filter(([name]) => name === 'chat.screenshot.received')).toEqual([])
  await act(async () => loading.resolve({ ok: true, blob: async () => blob } as Response))
  const [owner, other] = destination === 'main' ? [main, side] : [side, main]
  expect(owner.result.current.files).toEqual([expect.objectContaining({ blob })])
  expect(owner.result.current.text).toBe('Explain this')
  expect(other.result.current.files).toEqual([])
  expect(other.result.current.text).toBe('')
  expect(request().mock.calls.filter(([name]) => name === 'chat.screenshot.received')).toEqual([
    ['chat.screenshot.received', { deliveryId: capture.deliveryId, accepted: true }]
  ])
  await act(async () => listeners.forEach((receive) => receive(capture)))
  expect(owner.result.current.files).toHaveLength(1)
  expect(request().mock.calls.filter(([name]) => name === 'chat.screenshot.received')).toHaveLength(2)
})

it.each(['unmount', 'switch', 'hide'])(
  'restores the main capture target when the side composer exits (%s)',
  async (exit) => {
    const main = renderHook(() => useComposer('main', true))
    const mainTarget = target()
    const side = renderHook(({ scope, active }) => useComposer(scope, false, active), {
      initialProps: { scope: 'side', active: true }
    })
    expect(target()).toBe(mainTarget)
    await act(async () => side.result.current.startScreenshot())
    expect(target()).not.toBe(mainTarget)
    if (exit === 'unmount') side.unmount()
    else side.rerender({ scope: exit === 'switch' ? 'next-side' : 'side', active: exit !== 'hide' })
    expect(target()).toBe(mainTarget)
    main.unmount()
    expect(target()).toBeNull()
  }
)
