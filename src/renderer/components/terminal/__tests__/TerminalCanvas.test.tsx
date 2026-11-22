import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { InputFor } from '@shared/ipc/types'
import type { TerminalBlockSummary, TerminalResourceState, TerminalViewFrame } from '@shared/types/terminal'

import { newTerminalPresentation } from '../terminalBlockLayout'
import { TerminalCanvas } from '../TerminalCanvas'
vi.unmock('@cherrystudio/ui')

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
let agentConnected: boolean
let rejectInput: boolean
let current: TerminalResourceState
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts')
const resizeObserver = globalThis.ResizeObserver
beforeEach(() => {
  controlling = true
  agentConnected = true
  rejectInput = false
  stdin = ''
  alive = true
  current = structuredClone(resource)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      canvas: this,
      measureText: () => ({ width: 8, actualBoundingBoxAscent: 11, actualBoundingBoxDescent: 3 }),
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
      getTransform: () => ({ a: 1, d: 1 }),
      save() {},
      restore() {},
      resetTransform() {},
      setTransform() {},
      fillRect() {},
      clearRect() {},
      strokeRect() {}
    } as unknown as CanvasRenderingContext2D
  })
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 640, height: 400 } } as ResizeObserverEntry], this)
      }
      unobserve() {}
      disconnect() {}
    }
  )
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
        agentConnected,
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
  globalThis.ResizeObserver = resizeObserver
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

it('fits an observing canvas inside fractional viewport bounds without creating overflow', async () => {
  controlling = false
  let resize: (width: number, height: number) => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        resize = (width, height) =>
          this.callback([{ target, contentRect: { width, height } } as ResizeObserverEntry], this)
        resize(675.6, 734.6)
      }
      unobserve() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(676)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(735)
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    return {
      canvas: this,
      measureText: () => ({ width: 8, actualBoundingBoxAscent: 11, actualBoundingBoxDescent: 3 }),
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
      getTransform: () => ({ a: 1, d: 1 }),
      save() {},
      restore() {},
      resetTransform() {},
      setTransform() {},
      fillRect() {},
      clearRect() {},
      strokeRect() {}
    } as unknown as CanvasRenderingContext2D
  })
  const { container } = render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  await screen.findByRole('log')
  // Canvas layers have no accessible role; their CSS bounds must fit the actual content box.
  const surfaces = Array.from(container.querySelectorAll('canvas'))
  await waitFor(() => expect(surfaces.map((surface) => surface.style.width)).toEqual(['675.6px', '675.6px']))
  act(() => resize(675.5, 734.5))
  await waitFor(() => {
    expect(surfaces.map((surface) => surface.style.width)).toEqual(['675.5px', '675.5px'])
    expect(surfaces.map((surface) => surface.style.height)).toEqual(['734.5px', '734.5px'])
  })
})

it('keeps keyboard focus after clicking the terminal surface', async () => {
  const user = userEvent.setup()
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.hasPointerCapture = () => false
  const { container } = render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  // The painted click target is hidden from assistive technology; the textarea is the accessible input.
  const surface = container.querySelector('canvas')
  if (!surface) throw new Error('No terminal surface')
  await user.click(surface)
  expect(area).toHaveFocus()
  await user.keyboard('pwd')
  await waitFor(() => expect(stdin).toBe('pwd'))
})

it('keeps a user terminal writable without a return action when no Agent is connected', async () => {
  agentConnected = false
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  await userEvent.pointer({ target: area, keys: '[MouseRight]' })
  expect(screen.queryByRole('menuitem', { name: /交还 Agent|Return to Agent|接管|Take control/ })).toBeNull()
  await userEvent.keyboard('{Escape}')
  await userEvent.keyboard('pwd')
  await waitFor(() => expect(stdin).toBe('pwd'))
})

it('removes the return action after the Agent disconnects without disabling user input', async () => {
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  await userEvent.pointer({ target: area, keys: '[MouseRight]' })
  await screen.findByRole('menuitem', { name: /交还 Agent|Return to Agent/ })
  agentConnected = false
  await waitFor(() => expect(screen.queryByRole('menuitem', { name: /交还 Agent|Return to Agent/ })).toBeNull())
  await userEvent.keyboard('{Escape}')
  await userEvent.keyboard('after disconnect')
  await waitFor(() => expect(stdin).toBe('after disconnect'))
})

it('keeps takeover input read-only until the viewport is measured and resize completes', async () => {
  controlling = false
  let measure: () => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        measure = () =>
          this.callback([{ target, contentRect: { width: 640, height: 400 } } as ResizeObserverEntry], this)
      }
      unobserve() {}
      disconnect() {}
    }
  )
  const originalRequest = window.api.ipcApi.request
  const resize = Promise.withResolvers<void>()
  let resizing = false
  window.api.ipcApi.request = vi.fn(async (route, payload) => {
    if (route === 'terminal.action' && (payload as InputFor<'terminal.action'>).action.kind === 'resize') {
      resizing = true
      await resize.promise
    }
    return originalRequest(route, payload)
  })
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = screen.getByRole('textbox')
  await userEvent.pointer({ target: area, keys: '[MouseRight]' })
  await userEvent.click(screen.getByRole('menuitem', { name: /接管|Take control/ }))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
  expect(area).toHaveAttribute('readonly')
  act(measure)
  await waitFor(() => expect(resizing).toBe(true))
  expect(area).toHaveAttribute('readonly')
  await act(async () => resize.resolve())
  await input()
  fireEvent.input(area, { target: { value: 'printf' } })
  await waitFor(() => expect(stdin).toBe('printf'))
})

it('commits IME once and preserves later intentional identical text and characters', async () => {
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
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

it('accepts input after viewport changes queued behind an unfinished resize', async () => {
  let measure: (width: number) => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        measure = (width) =>
          this.callback([{ target, contentRect: { width, height: 400 } } as ResizeObserverEntry], this)
        measure(640)
      }
      unobserve() {}
      disconnect() {}
    }
  )
  const originalRequest = window.api.ipcApi.request
  const firstResize = Promise.withResolvers<void>()
  let started = false
  window.api.ipcApi.request = vi.fn(async (route, payload) => {
    if (route === 'terminal.action') {
      const { action } = payload as InputFor<'terminal.action'>
      if (action.kind === 'resize') {
        if (!started) {
          started = true
          await firstResize.promise
        }
        if (action.geometryEpoch !== current.geometryEpoch)
          return { ok: true, data: { kind: 'rejected', reason: 'stale_control' } }
        current = { ...current, geometryEpoch: (current.geometryEpoch ?? 0) + 1, revision: current.revision + 1 }
      }
    }
    return originalRequest(route, payload)
  })
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  await waitFor(() => expect(started).toBe(true))
  act(() => {
    measure(620)
    measure(600)
  })
  await act(async () => firstResize.resolve())
  const area = await input()
  fireEvent.input(area, { target: { value: 'after-resize' } })
  await waitFor(() => expect(stdin).toBe('after-resize'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it.each(['requested', 'pending', 'unconfirmed', 'confirmed'] as const)(
  'keeps a %s close read-only without submitting viewport mutations',
  async (phase) => {
    let measure: (width: number) => void = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class implements ResizeObserver {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          measure = (width) =>
            this.callback([{ target, contentRect: { width, height: 400 } } as ResizeObserverEntry], this)
          measure(640)
        }
        unobserve() {}
        disconnect() {}
      }
    )
    const rendered = render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
    const area = await input()
    const request = window.api.ipcApi.request
    window.api.ipcApi.request = vi.fn(async (route, payload) => {
      if (route === 'terminal.action') return { ok: true, data: { kind: 'rejected', reason: 'stale_generation' } }
      return request(route, payload)
    })
    if (phase !== 'requested')
      current = {
        ...current,
        cleanup: phase,
        process: { kind: 'exited', exitCode: 0, signal: null },
        revision: current.revision + 1
      }
    rendered.rerender(
      <TerminalCanvas
        onClose={() => {}}
        resource={current}
        active
        closing={phase === 'requested'}
        onResource={() => {}}
      />
    )
    expect(area).toHaveAttribute('readonly')
    await act(async () => {
      measure(600)
      fireEvent.input(area, { target: { value: 'late-input' } })
    })
    expect(stdin).toBe('')
    expect(screen.queryByText(/stale_generation/)).not.toBeInTheDocument()
    expect(screen.getByRole('log')).toHaveTextContent('LIVE_OUTPUT')
  }
)

it('drops queued viewport changes and a late rejection once close begins', async () => {
  let measure: (width: number) => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        measure = (width) =>
          this.callback([{ target, contentRect: { width, height: 400 } } as ResizeObserverEntry], this)
        measure(640)
      }
      unobserve() {}
      disconnect() {}
    }
  )
  const request = window.api.ipcApi.request
  const resize = Promise.withResolvers<void>()
  const actions: InputFor<'terminal.action'>['action'][] = []
  window.api.ipcApi.request = vi.fn(async (route, payload) => {
    if (route === 'terminal.action') {
      actions.push((payload as InputFor<'terminal.action'>).action)
      await resize.promise
      return { ok: true, data: { kind: 'rejected', reason: 'stale_generation' } }
    }
    return request(route, payload)
  })
  const rendered = render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  await waitFor(() => expect(actions).toHaveLength(1))
  act(() => measure(600))
  rendered.rerender(<TerminalCanvas onClose={() => {}} resource={current} active closing onResource={() => {}} />)
  await act(async () => resize.resolve())
  expect(actions).toHaveLength(1)
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('log')).toHaveTextContent('LIVE_OUTPUT')
})

it('refuses a composition commit after control transfers', async () => {
  const rendered = render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  fireEvent.compositionStart(area)
  current = { ...current, control: { kind: 'unassigned' }, controlRevision: 1, revision: 2 }
  rendered.rerender(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  fireEvent.compositionEnd(area, { data: 'stale' })
  expect(await screen.findByRole('alert')).toHaveTextContent(/\S/)
  expect(stdin).toBe('')
})
it('detaches a hidden view without stopping its persistent process', async () => {
  const rendered = render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  await input()
  rendered.rerender(<TerminalCanvas onClose={() => {}} resource={current} active={false} onResource={() => {}} />)
  await act(async () => {})
  expect(alive).toBe(true)
  expect(stdin).toBe('')
})

it('honors explicit creation control when the list mounted the view before the create receipt', async () => {
  controlling = false
  const { rerender } = render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = screen.getByRole('textbox')
  await waitFor(() => expect(area).toHaveAttribute('readonly'))
  rerender(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} takeControlOnAttach />)
  await waitFor(() => expect(area).not.toHaveAttribute('readonly'))
  fireEvent.input(area, { target: { value: 'created' } })
  await waitFor(() => expect(stdin).toBe('created'))
})

it('keeps rejected input visible after a healthy screen refresh without resubmitting it', async () => {
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  rejectInput = true
  fireEvent.input(area, { target: { value: 'stale' } })
  await screen.findByRole('alert')
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(screen.getByRole('alert')).toBeVisible()
  expect(stdin).toBe('')
})

it('moves to older history when the user wheels upward', async () => {
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
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
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  await waitFor(() => expect(captured).toBe(true))
  const area = screen.getByRole('textbox')
  await userEvent.pointer({ target: area, keys: '[MouseRight]' })
  await userEvent.click(screen.getByRole('menuitem', { name: /接管|Take control/ }))
  await act(async () => {
    delayed.resolve()
  })
  await input()
  fireEvent.input(area, { target: { value: 'after takeover' } })
  await waitFor(() => expect(stdin).toBe('after takeover'))
})

it('opens terminal operations without sending the menu gesture to the running program', async () => {
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  await userEvent.pointer({ target: area, keys: '[MouseRight]' })
  expect(screen.getByRole('menuitem', { name: /交还 Agent|Return to Agent/ })).toBeVisible()
  expect(
    vi
      .mocked(window.api.ipcApi.request)
      .mock.calls.filter(
        ([route, payload]) =>
          route === 'terminal.action' && (payload as InputFor<'terminal.action'>).action.kind === 'mouse'
      )
  ).toEqual([])
  await userEvent.keyboard('{Escape}')
  expect(area).toHaveFocus()
  fireEvent.keyDown(area, { key: 'F10', code: 'F10', shiftKey: true })
  expect(await screen.findByRole('menuitem', { name: /交还 Agent|Return to Agent/ })).toBeVisible()
  expect(
    vi
      .mocked(window.api.ipcApi.request)
      .mock.calls.filter(
        ([route, payload]) =>
          route === 'terminal.action' && (payload as InputFor<'terminal.action'>).action.kind === 'key'
      )
  ).toEqual([])
})

it.each([true, false])(
  'pairs motion and a fast release with an accepted mouse press (tracking: %s)',
  async (tracking) => {
    const user = userEvent.setup()
    const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
    const pressed = Promise.withResolvers<void>()
    const reported: string[] = []
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
      if (route === 'terminal.action') {
        const { action } = payload as InputFor<'terminal.action'>
        if (action.kind === 'mouse') {
          reported.push(action.event.action)
          if (action.event.action === 'press') await pressed.promise
          return { ok: true, data: { kind: 'resource', resource: current, inputHandled: tracking } }
        }
      }
      return request(route, payload)
    })
    render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
    await input()
    const region = screen.getByRole('region')
    await user.pointer({ target: region, keys: '[MouseLeft>]' })
    await waitFor(() => expect(reported).toEqual(['press']))
    await user.pointer({ target: region, coords: { x: 12, y: 20 } })
    await user.pointer({ keys: '[/MouseLeft]' })
    await act(async () => pressed.resolve())
    await waitFor(() => expect(reported).toEqual(tracking ? ['press', 'motion', 'release'] : ['press']))
  }
)

it('keeps menu dismissal focused on terminal input', async () => {
  const user = userEvent.setup()
  render(
    <TerminalCanvas
      onClose={() => {}}
      resource={current}
      active
      onResource={() => {}}
      renderHeader={(controls) => controls}
    />
  )
  const area = await input()
  await user.click(screen.getByRole('button', { name: /更多|More/ }))
  await user.keyboard('{Escape}')
  expect(area).toHaveFocus()
  await user.keyboard('echo ready')
  await waitFor(() => expect(stdin).toBe('echo ready'))
})

it('releases the allocated search when Escape cancels a newer debounced needle without writing to the shell', async () => {
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  let allocatedQuery: number | null = null
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route === 'terminal.search.set') {
      const input = payload as InputFor<'terminal.search.set'>
      allocatedQuery = input.needle ? input.queryRevision : null
      return {
        ok: true,
        data: {
          queryRevision: input.queryRevision,
          resultRevision: 1,
          status: 'caught-up',
          count: 0,
          selected: null,
          matches: [],
          highlightsLimited: false,
          partial: false
        }
      }
    }
    if (route === 'terminal.search.close') {
      if ((payload as InputFor<'terminal.search.close'>).queryRevision === allocatedQuery) allocatedQuery = null
      return { ok: true, data: undefined }
    }
    return request(route, payload)
  })
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  fireEvent.keyDown(area, { key: 'f', code: 'KeyF', metaKey: true })
  const find = within(screen.getByRole('search')).getByRole('textbox')
  fireEvent.change(find, { target: { value: 'first' } })
  await waitFor(() => expect(allocatedQuery).not.toBeNull())
  fireEvent.change(find, { target: { value: 'second' } })
  fireEvent.keyDown(find, { key: 'Escape', code: 'Escape' })
  await waitFor(() => expect(allocatedQuery).toBeNull())
  expect(screen.queryByRole('search')).not.toBeInTheDocument()
  expect(stdin).toBe('')
  expect(area).toHaveFocus()
})

it('folds output in one view without resizing its shell or changing another view, and restores that intent after detach', async () => {
  controlling = false
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  const block: TerminalBlockSummary = {
    id: 'block',
    contentRevision: 1,
    command: 'run',
    cwd: '/tmp',
    status: 'completed',
    exitCode: 0,
    reliable: true,
    outputEmpty: false,
    prompt: { x: 0, y: 5 },
    output: { x: 0, y: 7 },
    end: { x: 0, y: 9 }
  }
  let attachments = 0
  let resizes = 0
  let alternate = false
  let nativeRevision = 1
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route === 'terminal.attach')
      return { ok: true, data: `33333333-3333-4333-8333-${String(++attachments).padStart(12, '0')}` }
    if (route === 'terminal.blocks.list')
      return { ok: true, data: { kind: 'blocks', indexRevision: 1, blocks: alternate ? [] : [block], cursor: null } }
    if (route === 'terminal.action' && (payload as InputFor<'terminal.action'>).action.kind === 'resize') resizes++
    const result = await request(route, payload)
    if (
      route !== 'terminal.frame' ||
      typeof result !== 'object' ||
      result === null ||
      !('ok' in result) ||
      !result.ok ||
      !('data' in result)
    )
      return result
    const input = payload as InputFor<'terminal.frame'>
    const source = Array.from({ length: 12 }, (_, n) => ({
      text: `row${n}`,
      cells: [],
      isWrapContinuation: false,
      wrapsToNext: false
    }))
    const rows =
      input.layout && !alternate ? Array.from({ length: 12 }, () => ({ ...source[0], text: '' })) : [...source]
    for (const span of (!alternate && input.layout?.spans) || [])
      for (let n = 0; n < span.count; n++) rows[span.targetStart + n] = source[span.sourceStart + n]
    const frame = result.data as TerminalViewFrame
    return {
      ok: true,
      data: {
        ...frame,
        viewId: input.viewId,
        nativeRevision,
        alternate,
        sourceTotal: 12,
        sourceOrigin: 0,
        blockIndexRevision: 1,
        blocks: alternate ? [] : [block],
        layoutRevision: alternate ? undefined : input.layout?.revision,
        rowIndices: source.map((_, n) => n),
        snapshot: { ...frame.snapshot, rows: 12, rowData: rows, dirtyRows: source.map((_, n) => n) }
      }
    }
  })
  const first = newTerminalPresentation(),
    second = newTerminalPresentation()
  const views = (active: boolean) => (
    <>
      <div data-testid="first-view">
        <TerminalCanvas
          onClose={() => {}}
          resource={current}
          active={active}
          onResource={() => {}}
          presentation={first}
        />
      </div>
      <div data-testid="second-view">
        <TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} presentation={second} />
      </div>
    </>
  )
  const rendered = render(views(true))
  const firstView = within(screen.getByTestId('first-view')),
    secondView = within(screen.getByTestId('second-view'))
  const collapse = await firstView.findByRole('button', { name: /折叠输出|Collapse output/ })
  await waitFor(() => expect(secondView.getByRole('log')).toHaveTextContent('row7'))
  await userEvent.click(collapse)
  await waitFor(() => expect(firstView.getByRole('log')).not.toHaveTextContent('row7'))
  expect(secondView.getByRole('log')).toHaveTextContent('row7')
  expect(second.collapsed).toEqual([])
  alternate = true
  nativeRevision++
  await waitFor(() =>
    expect(firstView.queryByRole('button', { name: /展开输出|Expand output/ })).not.toBeInTheDocument()
  )
  alternate = false
  nativeRevision++
  await firstView.findByRole('button', { name: /展开输出|Expand output/ })
  await waitFor(() => expect(firstView.getByRole('log')).not.toHaveTextContent('row7'))
  rendered.rerender(views(false))
  rendered.rerender(views(true))
  await waitFor(() => expect(attachments).toBe(3))
  await firstView.findByRole('button', { name: /展开输出|Expand output/ })
  await waitFor(() => expect(firstView.getByRole('log')).not.toHaveTextContent('row7'))
  expect(resizes).toBe(0)
  expect(stdin).toBe('')
})
