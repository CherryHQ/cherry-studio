import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { InputFor } from '@shared/ipc/types'
import type { TerminalResourceState, TerminalViewFrame } from '@shared/types/terminal'

import { TerminalCanvas } from '../TerminalCanvas'

const resource: TerminalResourceState = {
  id: '11111111-1111-4111-8111-111111111111' as TerminalResourceState['id'],
  host: {
    conversationId: 'conversation' as TerminalResourceState['host']['conversationId'],
    generation: '22222222-2222-4222-8222-222222222222' as TerminalResourceState['host']['generation']
  },
  kind: 'pty',
  shell: 'bash',
  context: { contextId: 'native', bindingId: 'binding', revision: 0 },
  process: { kind: 'running' },
  cleanup: 'none',
  retention: { kind: 'session' },
  cancelRevision: 0,
  control: { kind: 'user' },
  controlRevision: 0,
  revision: 1,
  outputCursor: 0,
  geometryEpoch: 0
}
const viewId = '33333333-3333-4333-8333-333333333333'
let stdin: string
let alive: boolean
let controlling: boolean
let rejectInput: boolean
let current: TerminalResourceState
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts')
beforeEach(() => {
  controlling = true
  rejectInput = false
  stdin = ''
  alive = true
  current = structuredClone(resource)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  window.api.ipcApi.request = vi.fn(async (route, payload) => {
    if (route === 'terminal.attach') return { ok: true, data: viewId }
    if (route === 'terminal.detach') return { ok: true, data: undefined }
    if (route === 'terminal.action') {
      const { action } = payload as InputFor<'terminal.action'>
      if (action.kind === 'take-control') controlling = true
      if (rejectInput && action.kind === 'key') return { ok: true, data: { kind: 'rejected', reason: 'stale_control' } }
      if (action.kind === 'key') stdin += action.event.text
      if (action.kind === 'paste') stdin += action.data
      if (action.kind === 'stop') alive = false
      return { ok: true, data: { kind: 'resource', resource: current } }
    }
    if (route === 'terminal.frame') {
      const frame: TerminalViewFrame = {
        controlling,
        scrollOffset: (payload as InputFor<'terminal.frame'>).offset,
        viewId,
        resource: current,
        geometryEpoch: current.geometryEpoch ?? 0,
        revision: current.revision,
        baseRevision: null,
        rowStart: 0,
        rowIndices: [0],
        complete: true,
        styles: [],
        snapshot: {
          cols: 1,
          rows: 1,
          foreground: { r: 255, g: 255, b: 255 },
          background: { r: 0, g: 0, b: 0 },
          cursor: { r: 255, g: 255, b: 255 },
          cursorX: 0,
          cursorY: 0,
          cursorVisible: true,
          cursorBlinking: true,
          cursorStyle: 0,
          dirtyRows: [0],
          rowData: [
            {
              text: (payload as InputFor<'terminal.frame'>).offset > 0 ? 'OLDER_OUTPUT' : 'LIVE_OUTPUT',
              cells: [],
              isWrapContinuation: false,
              wrapsToNext: false
            }
          ]
        }
      }
      return { ok: true, data: frame }
    }
    throw new Error(`Unexpected terminal request: ${route}`)
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture')
  if (fonts) Object.defineProperty(document, 'fonts', fonts)
  else Reflect.deleteProperty(document, 'fonts')
})
async function input() {
  const area = screen.getByRole('textbox')
  await waitFor(() => expect(area).not.toHaveAttribute('readonly'))
  return area
}

it('keeps keyboard focus after clicking the terminal surface', async () => {
  const user = userEvent.setup()
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.hasPointerCapture = () => false
  const { container } = render(<TerminalCanvas resource={current} active onResource={() => {}} />)
  const area = await input()
  // The painted click target is hidden from assistive technology; the textarea is the accessible input.
  const surface = container.querySelector('canvas')
  if (!surface) throw new Error('No terminal surface')
  await user.click(surface)
  expect(area).toHaveFocus()
  await user.keyboard('pwd')
  await waitFor(() => expect(stdin).toBe('pwd'))
})

it('commits IME once and preserves later intentional identical text and characters', async () => {
  render(<TerminalCanvas resource={current} active onResource={() => {}} />)
  const area = await input()
  act(() => {
    fireEvent.compositionStart(area)
    fireEvent.compositionUpdate(area, { data: '你好' })
    fireEvent.input(area, { target: { value: '你好' }, isComposing: true })
    fireEvent.compositionEnd(area, { data: '你好' })
    fireEvent.input(area, { target: { value: '你好' }, inputType: 'insertFromComposition' })
  })
  await waitFor(() => expect(stdin).toBe('你好'))
  fireEvent.compositionStart(area)
  fireEvent.compositionEnd(area, { data: '你好' })
  await waitFor(() => expect(stdin).toBe('你好你好'))
  fireEvent.input(area, { target: { value: 'a' } })
  fireEvent.input(area, { target: { value: 'a' } })
  await waitFor(() => expect(stdin).toBe('你好你好aa'))
})
it('refuses a composition commit after control transfers', async () => {
  const rendered = render(<TerminalCanvas resource={current} active onResource={() => {}} />)
  const area = await input()
  fireEvent.compositionStart(area)
  current = { ...current, control: { kind: 'unassigned' }, controlRevision: 1, revision: 2 }
  rendered.rerender(<TerminalCanvas resource={current} active onResource={() => {}} />)
  fireEvent.compositionEnd(area, { data: 'stale' })
  expect(await screen.findByRole('alert')).toHaveTextContent(/\S/)
  expect(stdin).toBe('')
})
it('detaches a hidden view without stopping its persistent process', async () => {
  const rendered = render(<TerminalCanvas resource={current} active onResource={() => {}} />)
  await input()
  rendered.rerender(<TerminalCanvas resource={current} active={false} onResource={() => {}} />)
  await act(async () => {})
  expect(alive).toBe(true)
  expect(stdin).toBe('')
})

it('honors explicit creation control when the list mounted the view before the create receipt', async () => {
  controlling = false
  const { rerender } = render(<TerminalCanvas resource={current} active onResource={() => {}} />)
  const area = screen.getByRole('textbox')
  await waitFor(() => expect(area).toHaveAttribute('readonly'))
  rerender(<TerminalCanvas resource={current} active onResource={() => {}} takeControlOnAttach />)
  await waitFor(() => expect(area).not.toHaveAttribute('readonly'))
  fireEvent.input(area, { target: { value: 'created' } })
  await waitFor(() => expect(stdin).toBe('created'))
})

it('keeps rejected input visible after a healthy screen refresh without resubmitting it', async () => {
  render(<TerminalCanvas resource={current} active onResource={() => {}} />)
  const area = await input()
  rejectInput = true
  fireEvent.input(area, { target: { value: 'stale' } })
  await screen.findByRole('alert')
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(screen.getByRole('alert')).toBeVisible()
  expect(stdin).toBe('')
})

it('moves to older history when the user wheels upward', async () => {
  render(<TerminalCanvas resource={current} active onResource={() => {}} />)
  const area = await input()
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('LIVE_OUTPUT'))
  fireEvent.wheel(area.parentElement!, { deltaY: -100, shiftKey: true })
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('OLDER_OUTPUT'))
})

it('keeps committed takeover when an earlier observation arrives afterward', async () => {
  controlling = false
  const original = window.api.ipcApi.request
  const delayed = Promise.withResolvers<void>()
  let first = true
  let captured = false
  window.api.ipcApi.request = vi.fn(async (route, payload) => {
    if (route === 'terminal.action' && (payload as InputFor<'terminal.action'>).action.kind === 'take-control') {
      current = { ...current, revision: 2, controlRevision: 1 }
    }
    const result = await original(route, payload)
    if (route === 'terminal.frame' && first) {
      first = false
      captured = true
      await delayed.promise
    }
    return result
  })
  render(<TerminalCanvas resource={current} active onResource={() => {}} />)
  await waitFor(() => expect(captured).toBe(true))
  const area = screen.getByRole('textbox')
  fireEvent.click(screen.getByRole('button', { name: /接管|Take control/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /交还 Agent|Return to Agent/ })).toBeVisible())
  await act(async () => {
    delayed.resolve()
  })
  expect(area).not.toHaveAttribute('readonly')
  fireEvent.input(area, { target: { value: 'after takeover' } })
  await waitFor(() => expect(stdin).toBe('after takeover'))
})
