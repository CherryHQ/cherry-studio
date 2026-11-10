import { act, renderHook, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

// @vitest-environment jsdom
import { ipcApi } from '@renderer/ipc'
import type { EventPayload, InputFor } from '@shared/ipc/types'

import { useAgentBrowserGuest } from '../useAgentBrowserGuest'

afterEach(() => vi.restoreAllMocks())

it('keeps the new binding alive when a previous attachment completes after effect cleanup', async () => {
  let binding: string | undefined
  let resolveFirst!: () => void
  const pending = new Promise<void>((resolve) => {
    resolveFirst = resolve
  })
  let nextId = 0
  vi.spyOn(ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route === 'browser.pane.attach') {
      const tabId = binding ?? `target-${++nextId}`
      binding = tabId
      if (tabId === 'target-1') await pending
      return { tabId }
    }
    if (
      route === 'browser.pane.detach' &&
      input &&
      typeof input === 'object' &&
      'tabId' in input &&
      input.tabId === binding
    )
      binding = undefined
    return undefined
  })
  const guest = Object.assign(document.createElement('webview'), {
    getWebContentsId: () => 42
  }) as unknown as WebviewTag
  const hook = renderHook(({ revision }) => useAgentBrowserGuest('session-a', guest, revision), {
    initialProps: { revision: 0 }
  })
  await act(async () => {
    await Promise.resolve()
  })
  hook.rerender({ revision: 1 })
  await act(async () => {
    resolveFirst()
    await pending
  })
  expect(binding).toBe('target-2')
  hook.unmount()
  await act(async () => {
    await Promise.resolve()
  })
  expect(binding).toBeUndefined()
})

it.each(['focused', 'background', 'unavailable'] as const)(
  'reports %s input readiness without moving focus into an inert guest',
  async (expected) => {
    let onFocus!: (request: EventPayload<'browser.input.focus_requested'>) => void
    let reply: InputFor<'browser.input.focused'> | undefined
    vi.spyOn(ipcApi, 'on').mockImplementation((event, listener) => {
      if (event === 'browser.input.focus_requested') onFocus = listener
      return () => {}
    })
    vi.spyOn(ipcApi, 'request').mockImplementation(async (route, input) => {
      if (route === 'browser.pane.attach') return { tabId: 'tab-1' }
      if (route === 'browser.input.focused') reply = input as typeof reply
      return undefined
    })
    const plane = document.createElement('div')
    const composer = document.createElement('button')
    const guest = Object.assign(document.createElement('webview'), {
      getWebContentsId: () => 42
    }) as unknown as WebviewTag
    guest.tabIndex = 0
    plane.append(guest)
    document.body.append(composer, plane)
    composer.focus()
    if (expected === 'background') plane.setAttribute('inert', '')
    if (expected === 'unavailable') guest.remove()
    const hook = renderHook(() => useAgentBrowserGuest('session-a', guest, 0))
    try {
      await waitFor(() => expect(hook.result.current).toBe('tab-1'))
      const request = {
        sessionId: 'session-a',
        scope: 'agent' as const,
        tabId: 'tab-1',
        requestId: 'request',
        expiresAt: Date.now() + 2000
      }
      onFocus({ ...request, tabId: 'stale-tab' })
      expect(reply).toBeUndefined()
      expect(document.activeElement).toBe(composer)
      onFocus(request)
      expect(reply).toMatchObject({ requestId: 'request', status: expected })
      expect(document.activeElement).toBe(expected === 'focused' ? guest : composer)
      expect(plane.hasAttribute('inert')).toBe(expected === 'background')
    } finally {
      hook.unmount()
      plane.remove()
      composer.remove()
      await act(async () => {
        await Promise.resolve()
      })
    }
  }
)
