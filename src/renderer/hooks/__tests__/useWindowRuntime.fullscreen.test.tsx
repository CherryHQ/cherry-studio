import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  Dialog,
  DialogContent,
  DialogPortal,
  DialogTitle
} from '../../../../packages/ui/src/components/primitives/dialog'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  listener: null as null | ((value: boolean) => void),
  preferences: {} as Record<string, unknown>
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request },
  useIpcOn: (event: string, listener: (value: boolean) => void) => {
    useEffect(() => {
      if (event !== 'window.fullscreen_changed') return
      mocks.listener = listener
      return () => {
        mocks.listener = null
      }
    }, [event, listener])
  }
}))
vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [mocks.preferences[key], vi.fn()],
  useMultiplePreferences: () => [mocks.preferences, vi.fn()]
}))
vi.mock('@renderer/hooks/useLanguageSync', () => ({ useLanguageSync: () => {} }))
vi.mock('@renderer/hooks/useCustomCss', () => ({ useCustomCss: () => {} }))
vi.mock('@renderer/hooks/useWebSearchFallbackNotice', () => ({ useWebSearchFallbackNotice: () => {} }))
vi.mock('@renderer/hooks/useMiniApps', () => ({ useMiniAppListSync: () => {} }))
vi.mock('@renderer/hooks/useTopic', () => ({ useTopicAutoRenameSync: () => {} }))
vi.mock('@renderer/hooks/agent/useSession', () => ({ useAgentSessionAutoRenameSync: () => {} }))
vi.mock('@renderer/hooks/agent/useAgentTabIconChangeSync', () => ({ useAgentTabIconChangeSync: () => {} }))
vi.mock('@renderer/hooks/tab', () => ({ useConversationTabTitleChangeSync: () => {} }))
vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({ default: () => false }))
vi.mock('@renderer/services/toast', () => ({ toast: { info: vi.fn() } }))

import { CommandContextKeyProvider } from '@renderer/components/command/CommandContextKeyProvider'
import { CommandProvider } from '@renderer/components/command/CommandProvider'
import { useCommandContextKey, useCommandHandler } from '@renderer/hooks/command'

import { useWindowRuntime } from '../useWindowRuntime'

function Runtime() {
  useWindowRuntime()
  return null
}
function Other({ execute }: { execute: () => void }) {
  useCommandHandler('topic.create', execute)
  return null
}
function Webview() {
  useCommandContextKey('webview.focused', true)
  return null
}
function mount(children: React.ReactNode = <Runtime />) {
  return render(
    <CommandContextKeyProvider>
      <CommandProvider>
        {children}
        <button type="button">host</button>
      </CommandProvider>
    </CommandContextKeyProvider>
  )
}
function key(init: KeyboardEventInit = {}, target: Element = screen.getByText('host')) {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}
function exits() {
  return mocks.request.mock.calls.filter(([name]) => name === 'window.set_full_screen')
}
function emit(value: boolean) {
  act(() => {
    mocks.listener?.(value)
  })
}

beforeEach(() => {
  window.root = document.createElement('div')
  mocks.preferences = {}
  mocks.request
    .mockReset()
    .mockImplementation((name: string) =>
      Promise.resolve(name === 'app.get_info' ? { homePath: '', resourcesPath: '' } : false)
    )
})
afterEach(cleanup)

it('does not exit while windowed, and leaves other commands available', async () => {
  const execute = vi.fn()
  mount(
    <>
      <Runtime />
      <Other execute={execute} />
    </>
  )
  await act(async () => {})
  expect(key().defaultPrevented).toBe(false)
  expect(exits()).toHaveLength(0)
  key({ key: 'n', code: 'KeyN', ctrlKey: true })
  expect(execute).toHaveBeenCalledOnce()
})

it('tracks fullscreen changes and ignores IME and editable targets', async () => {
  mount(
    <>
      <Runtime />
      <input />
      <textarea />
      <div contentEditable data-testid="editable" />
    </>
  )
  await act(async () => {})
  emit(true)
  expect(key({ isComposing: true }).defaultPrevented).toBe(false)
  expect(key({ keyCode: 229 }).defaultPrevented).toBe(false)
  for (const element of [
    document.querySelector('input')!,
    document.querySelector('textarea')!,
    screen.getByTestId('editable')
  ]) {
    expect(key({}, element).defaultPrevented).toBe(false)
  }
  expect(exits()).toHaveLength(0)
  expect(key().defaultPrevented).toBe(true)
  expect(exits()).toEqual([['window.set_full_screen', false]])
  emit(false)
  expect(key().defaultPrevented).toBe(false)
  expect(exits()).toHaveLength(1)
})

it('honors the stored shortcut, disabling, and webview focus', async () => {
  mocks.preferences['app.fullscreen.exit'] = { binding: ['CommandOrControl', 'K'], enabled: true }
  const view = mount(<Runtime />)
  await act(async () => {})
  emit(true)
  expect(key().defaultPrevented).toBe(false)
  expect(key({ key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(true)
  expect(exits()).toHaveLength(1)
  view.rerender(
    <CommandContextKeyProvider>
      <CommandProvider>
        <Runtime />
        <Webview />
        <button type="button">host</button>
      </CommandProvider>
    </CommandContextKeyProvider>
  )
  expect(key({ key: 'k', code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(false)
  expect(exits()).toHaveLength(1)
})

it.each([
  [true, false],
  [false, true]
])('prefers an event %s over a late query %s', async (eventValue, queryValue) => {
  let resolve!: (value: boolean) => void
  mocks.request.mockImplementation((name: string) =>
    name === 'window.is_full_screen'
      ? new Promise<boolean>((r) => {
          resolve = r
        })
      : Promise.resolve(name === 'app.get_info' ? { homePath: '', resourcesPath: '' } : undefined)
  )
  mount()
  expect(key().defaultPrevented).toBe(false)
  emit(eventValue)
  await act(async () => {
    resolve(queryValue)
  })
  expect(key().defaultPrevented).toBe(eventValue)
  expect(exits()).toHaveLength(eventValue ? 1 : 0)
})

it('does not install a fullscreen consumer without the runtime', () => {
  mount(null)
  expect(key().defaultPrevented).toBe(false)
  expect(exits()).toHaveLength(0)
})

it('lets a real dialog consume Escape before the fullscreen command', async () => {
  mount(
    <>
      <Runtime />
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
            <button type="button">inside</button>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  )
  await act(async () => {})
  emit(true)
  const button = screen.getByText('inside')
  button.focus()
  key({}, button)
  expect(screen.queryByText('inside')).toBeNull()
  expect(exits()).toHaveLength(0)
  await waitFor(() => expect(key().defaultPrevented).toBe(true))
  expect(exits()).toHaveLength(1)
})

it('uses the initial fullscreen reply and respects a disabled preference', async () => {
  mocks.request.mockImplementation((name: string) =>
    Promise.resolve(name === 'app.get_info' ? { homePath: '', resourcesPath: '' } : true)
  )
  mocks.preferences['app.fullscreen.exit'] = { binding: ['Escape'], enabled: false }
  const view = mount()
  await act(async () => {})
  expect(key().defaultPrevented).toBe(false)
  expect(exits()).toHaveLength(0)
  mocks.preferences['app.fullscreen.exit'] = { binding: ['Escape'], enabled: true }
  view.rerender(
    <CommandContextKeyProvider>
      <CommandProvider>
        <Runtime />
        <button type="button">host</button>
      </CommandProvider>
    </CommandContextKeyProvider>
  )
  expect(key().defaultPrevented).toBe(true)
  expect(exits()).toHaveLength(1)
})

it('ignores a query reply after unmount', async () => {
  let resolve!: (value: boolean) => void
  mocks.request.mockImplementation((name: string) =>
    name === 'window.is_full_screen'
      ? new Promise<boolean>((r) => {
          resolve = r
        })
      : Promise.resolve({ homePath: '', resourcesPath: '' })
  )
  const view = mount()
  view.unmount()
  await act(async () => {
    resolve(true)
  })
  mount(null)
  expect(key().defaultPrevented).toBe(false)
  expect(exits()).toHaveLength(0)
})
