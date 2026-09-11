import { act, renderHook } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { expect, it, vi } from 'vitest'

// @vitest-environment jsdom
import { ipcApi } from '@renderer/ipc'

import { useAgentBrowserGuest } from '../useAgentBrowserGuest'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

it('keeps the new binding alive when a previous attachment completes after effect cleanup', async () => {
  let binding: string | undefined
  let resolveFirst!: () => void
  const pending = new Promise<void>((resolve) => {
    resolveFirst = resolve
  })
  let nextId = 0
  vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
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
