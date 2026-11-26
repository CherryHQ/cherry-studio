import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { InputFor } from '@shared/ipc/types'
import type {
  TerminalBlockSummary,
  TerminalResourceState,
  TerminalSearchProjection,
  TerminalViewFrame
} from '@shared/types/terminal'
import { encodeTerminalRows } from '@shared/utils/terminalFrame'

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
      fillText() {},
      beginPath() {},
      rect() {},
      clip() {},
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
        sourceTotal: 101,
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

it('navigates retained blocks from their menu without writing input or resizing the terminal', async () => {
  const user = userEvent.setup()
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  const effects: string[] = []
  const blocks: TerminalBlockSummary[] = [
    { start: 0, end: 25 },
    { start: 30, end: 60 },
    { start: 70, end: 95 }
  ].map(({ start, end }) => ({
    id: `block-${start}`,
    contentRevision: 1,
    command: `print ${start}`,
    cwd: '/project',
    status: 'completed',
    timing: null,
    exitCode: 0,
    reliable: true,
    outputEmpty: true,
    prompt: { x: 0, y: start },
    output: { x: 0, y: start + 1 },
    end: { x: 0, y: end }
  }))
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route === 'terminal.blocks.list')
      return { ok: true, data: { kind: 'blocks', indexRevision: 1, blocks, cursor: null } }
    if (route === 'terminal.action') effects.push((payload as InputFor<'terminal.action'>).action.kind)
    const result = await request(route, payload)
    if (route !== 'terminal.frame') return result
    const frame = (result as { ok: true; data: TerminalViewFrame }).data
    const input = payload as InputFor<'terminal.frame'>
    const rows = Array.from({ length: 10 }, () => ({
      text: '',
      cells: [],
      isWrapContinuation: false,
      wrapsToNext: false
    }))
    if (input.layout)
      for (const span of input.layout.spans)
        for (let i = 0; i < span.count; i++) rows[span.targetStart + i].text = `SOURCE_${span.sourceStart + i}`
    return {
      ok: true,
      data: {
        ...frame,
        nativeRevision: 1,
        sourceTotal: 100,
        sourceContentEnd: 95,
        sourceOrigin: 90 - input.offset,
        blockIndexRevision: 1,
        layoutRevision: input.layout?.revision,
        rowIndices: rows.map((_, index) => index),
        snapshot: { ...frame.snapshot, rows: 10, rowData: rows, dirtyRows: rows.map((_, index) => index) }
      }
    }
  })
  render(
    <TerminalCanvas
      onClose={() => {}}
      resource={current}
      active
      onResource={() => {}}
      presentation={{ ...newTerminalPresentation(), expandedBlocks: new Set(blocks.map((block) => block.id)) }}
    />
  )
  await input()
  const output = screen.getByRole('log')
  await waitFor(() => expect(output).toHaveTextContent('SOURCE_94'))
  effects.length = 0
  const choose = async (label: string) => {
    await user.click(screen.getByRole('button', { name: t('common.more') }))
    await user.click(screen.getByRole('menuitem', { name: label }))
  }
  await user.click(screen.getByRole('button', { name: t('common.more') }))
  expect(screen.getByRole('menuitem', { name: t('terminal.blocks.next_block') })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await user.click(screen.getByRole('menuitem', { name: t('terminal.blocks.previous_block') }))
  await waitFor(() => expect(output).toHaveTextContent('SOURCE_30'))
  await choose(t('terminal.blocks.next_block'))
  await waitFor(() => expect(output).toHaveTextContent('SOURCE_70'))
  await choose(t('terminal.blocks.previous_block'))
  await waitFor(() => expect(output).toHaveTextContent('SOURCE_30'))
  await choose(t('terminal.blocks.previous_block'))
  await waitFor(() => expect(output).toHaveTextContent('SOURCE_0'))
  await user.click(screen.getByRole('button', { name: t('common.more') }))
  expect(screen.getByRole('menuitem', { name: t('terminal.blocks.previous_block') })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await user.click(screen.getByRole('menuitem', { name: t('terminal.blocks.scroll_bottom') }))
  await waitFor(() => expect(output).toHaveTextContent('SOURCE_24'))
  expect(output).not.toHaveTextContent('SOURCE_25')
  await choose(t('terminal.blocks.scroll_top'))
  await waitFor(() => expect(output).toHaveTextContent('SOURCE_0'))
  expect(effects).toEqual([])
  expect(stdin).toBe('')
})

it('previews only completed output, expands without jumping, and reveals hidden search matches in a fresh view', async () => {
  const user = userEvent.setup()
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  const effects: string[] = []
  let completed = false
  const block = (): TerminalBlockSummary => ({
    id: 'preview',
    contentRevision: 1,
    command: 'print rows',
    cwd: '/project',
    status: completed ? 'completed' : 'running',
    timing: null,
    exitCode: completed ? 0 : null,
    reliable: true,
    outputEmpty: false,
    prompt: { x: 0, y: 0 },
    output: { x: 0, y: 1 },
    end: completed ? { x: 0, y: 95 } : null
  })
  const search: TerminalSearchProjection = {
    queryRevision: 0,
    resultRevision: 1,
    status: 'caught-up',
    count: 2,
    selected: null,
    matches: [],
    highlightsLimited: false,
    partial: false
  }
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route === 'terminal.blocks.list')
      return { ok: true, data: { kind: 'blocks', indexRevision: completed ? 2 : 1, blocks: [block()], cursor: null } }
    if (route === 'terminal.search.close') return { ok: true, data: undefined }
    if (route === 'terminal.search.set') {
      search.queryRevision = (payload as InputFor<'terminal.search.set'>).queryRevision
      return { ok: true, data: { ...search } }
    }
    if (route === 'terminal.search.navigate') {
      const row = search.selected?.range?.start.y === 5 ? 94 : 5
      const x = `SOURCE_${row} `.length
      search.selected = { index: row === 5 ? 0 : 1, range: { start: { x, y: row }, end: { x: x + 5, y: row } } }
      return { ok: true, data: { ...search } }
    }
    if (route === 'terminal.action') effects.push((payload as InputFor<'terminal.action'>).action.kind)
    const result = await request(route, payload)
    if (route !== 'terminal.frame') return result
    const frame = (result as { ok: true; data: TerminalViewFrame }).data
    const input = payload as InputFor<'terminal.frame'>
    const rows = Array.from({ length: 20 }, () => ({
      text: '',
      cells: [],
      isWrapContinuation: false,
      wrapsToNext: false
    }))
    if (input.layout)
      for (const span of input.layout.spans)
        for (let i = 0; i < span.count; i++) {
          const source = span.sourceStart + i
          rows[span.targetStart + i].text = `SOURCE_${source}${source === 5 || source === 94 ? ' TARGET' : ''}`
        }
    return {
      ok: true,
      data: {
        ...frame,
        nativeRevision: completed ? 2 : 1,
        blockIndexRevision: completed ? 2 : 1,
        sourceTotal: 100,
        sourceContentEnd: 97,
        sourceOrigin: 80 - input.offset,
        layoutRevision: input.layout?.revision,
        rowIndices: rows.map((_, index) => index),
        snapshot: { ...frame.snapshot, rows: 20, cols: 20, rowData: rows, dirtyRows: rows.map((_, index) => index) }
      }
    }
  })
  const presentation = newTerminalPresentation()
  const view = () => (
    <TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} presentation={presentation} />
  )
  let rendered = render(view())
  await input()
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('SOURCE_94'))
  expect(screen.queryByRole('button', { name: t('terminal.blocks.show_more') })).not.toBeInTheDocument()
  completed = true
  const more = await screen.findByRole('button', { name: t('terminal.blocks.show_more') })
  expect(screen.getByRole('log')).toHaveTextContent('SOURCE_10')
  expect(screen.getByRole('log')).not.toHaveTextContent('SOURCE_11')
  expect(screen.getByRole('log')).toHaveTextContent('SOURCE_95')
  effects.length = 0
  await user.click(more)
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('SOURCE_11'))
  expect(screen.getByRole('log').textContent?.trimStart().split('\n')[0]).toBe('SOURCE_0')
  expect(screen.getByRole('textbox')).toHaveFocus()
  expect(effects).toEqual([])
  rendered.unmount()
  rendered = render(view())
  await input()
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('SOURCE_11'))
  expect(screen.queryByRole('button', { name: t('terminal.blocks.show_more') })).not.toBeInTheDocument()
  rendered.unmount()
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  await screen.findByRole('button', { name: t('terminal.blocks.show_more') })
  fireEvent.keyDown(area, { key: 'f', code: 'KeyF', metaKey: true })
  await user.type(within(screen.getByRole('search')).getByRole('textbox'), 'TARGET')
  await waitFor(() => expect(screen.getByRole('button', { name: t('common.next') })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: t('common.next') }))
  await waitFor(() => expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('1/2'))
  await screen.findByRole('button', { name: t('terminal.blocks.show_more') })
  await user.click(screen.getByRole('button', { name: t('common.next') }))
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('SOURCE_94'))
  await user.click(screen.getByRole('button', { name: t('common.close') }))
  expect(screen.getByRole('log')).toHaveTextContent('SOURCE_94')
})

it('aligns the cursor and IME input to the first row while retaining the horizontal gutter', async () => {
  const original = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation()!
  const cursorBoxes: { left: number; top: number }[] = []
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    const context = original.call(this, '2d')
    if (context && 'strokeRect' in context)
      context.strokeRect = (left: number, top: number) => {
        cursorBoxes.push({ left, top })
      }
    return context
  })
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  await waitFor(() => expect(cursorBoxes).toContainEqual({ left: 8.5, top: 0.5 }))
  expect(area.style.left).toBe('8px')
  expect(area.style.top).toBe('0px')
})

it('keeps unused observing-grid rows out of the scroll range and scrolls occupied rows through the viewport', async () => {
  controlling = false
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  let contentEnd = 2
  let alternate = false
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
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
    const frame = result.data as TerminalViewFrame
    const input = payload as InputFor<'terminal.frame'>
    const source = Array.from({ length: 50 }, (_, index) => ({
      text: index < contentEnd ? `SOURCE_${index}` : '',
      cells: [],
      isWrapContinuation: false,
      wrapsToNext: false
    }))
    const rows = source.map((row) => ({ ...row, text: '' }))
    if (input.layout && !alternate) {
      for (const span of input.layout.spans)
        for (let index = 0; index < span.count; index++)
          rows[span.targetStart + index] = source[span.sourceStart + index]
    } else rows.splice(0, rows.length, ...source)
    return {
      ok: true,
      data: {
        ...frame,
        sourceOrigin: 0,
        alternate,
        sourceTotal: 50,
        sourceContentEnd: contentEnd,
        layoutRevision: alternate ? undefined : input.layout?.revision,
        rowIndices: rows.map((_, index) => index),
        snapshot: { ...frame.snapshot, rows: 50, cursorY: 1, rowData: rows, dirtyRows: rows.map((_, index) => index) }
      }
    }
  })
  let resize: (width: number, height: number) => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const measure = (width: number, height: number) =>
          this.callback([{ target, contentRect: { width, height } } as ResizeObserverEntry], this)
        if (target.getAttribute('data-slot') === 'scroll-area-viewport') resize = measure
        measure(675.6, 734.6)
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
  contentEnd = 50
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('SOURCE_49'))
  const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')!
  fireEvent.scroll(viewport, { target: { scrollTop: 0 } })
  await waitFor(() => {
    expect(screen.getByRole('log')).toHaveTextContent('SOURCE_0')
    expect(screen.getByRole('log')).not.toHaveTextContent('SOURCE_49')
  })
  fireEvent.scroll(viewport, { target: { scrollTop: 13 * 19 } })
  await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('SOURCE_49'))
  expect(surfaces.map((surface) => surface.style.height)).toEqual(['734.5px', '734.5px'])
  alternate = true
  await waitFor(() => expect(surfaces.map((surface) => surface.style.height)).toEqual(['966px', '966px']))
  fireEvent.wheel(screen.getByRole('region', { name: t('terminal.title') }), { deltaY: 95, shiftKey: true })
  await waitFor(() =>
    expect(surfaces.map((surface) => surface.style.transform)).toEqual(['translateY(-95px)', 'translateY(-95px)'])
  )
  alternate = false
  await waitFor(() => {
    expect(surfaces.map((surface) => surface.style.height)).toEqual(['734.5px', '734.5px'])
    expect(surfaces.map((surface) => surface.style.transform)).toEqual(['', ''])
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

it('keeps the PTY at its settled size through pane motion and preserves the input draft', async () => {
  let width = 640
  let measure: (width: number) => void = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const resize = (next: number) => {
          width = next
          this.callback([{ target, contentRect: { width, height: 400 } } as ResizeObserverEntry], this)
        }
        if (target.getAttribute('data-slot') === 'scroll-area-viewport') measure = resize
        resize(width)
      }
      unobserve() {}
      disconnect() {}
    }
  )
  const original = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  const appliedCols: number[] = []
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route === 'terminal.action') {
      const { action } = payload as InputFor<'terminal.action'>
      if (action.kind === 'resize') appliedCols.push(action.cols)
    }
    return original(route, payload)
  })
  const { rerender } = render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  fireEvent.input(area, { target: { value: 'unfinished-draft' } })
  await waitFor(() => expect(stdin).toBe('unfinished-draft'))
  rerender(<TerminalCanvas onClose={() => {}} resource={current} active resizeSuspended onResource={() => {}} />)
  act(() => {
    measure(900)
    measure(700)
    measure(600)
  })
  expect(area).toHaveAttribute('readonly')
  expect(appliedCols).toEqual([78])
  rerender(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  await input()
  expect(appliedCols).toEqual([78, 73])
  expect(stdin).toBe('unfinished-draft')
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

it('coalesces wheel and scrollbar changes without the idle poll or rewinding to a pending frame', async () => {
  controlling = false
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  const delayed = Promise.withResolvers<void>()
  let hold = false
  let pending = false
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route !== 'terminal.frame') return request(route, payload)
    if (pending) throw new Error('Concurrent terminal frame request')
    pending = true
    try {
      if (hold) {
        hold = false
        await delayed.promise
      }
      const result = await request(route, payload)
      if (typeof result === 'object' && result !== null && 'ok' in result && result.ok && 'data' in result) {
        const frame = result.data as TerminalViewFrame
        frame.snapshot.rowData[0].text = `HISTORY_${(payload as InputFor<'terminal.frame'>).offset}`
      }
      return result
    } finally {
      pending = false
    }
  })
  try {
    render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
    await act(async () => {})
    expect(screen.getByRole('log')).toHaveTextContent('HISTORY_0')
    const region = screen.getByRole('region', { name: t('terminal.title') })
    const viewport = region.closest('[data-slot="scroll-area-viewport"]')!
    await act(async () => {
      fireEvent.wheel(region, { deltaY: -19, shiftKey: true })
      await vi.advanceTimersByTimeAsync(32)
    })
    expect(screen.getByRole('log')).toHaveTextContent('HISTORY_1')
    hold = true
    await act(async () => {
      fireEvent.wheel(region, { deltaY: -19, shiftKey: true })
      await vi.advanceTimersByTimeAsync(16)
      fireEvent.scroll(viewport, { target: { scrollTop: 20 * 19 } })
      fireEvent.wheel(region, { deltaY: -19, shiftKey: true })
      await vi.advanceTimersByTimeAsync(16)
      delayed.resolve()
      await vi.advanceTimersByTimeAsync(32)
    })
    expect(screen.getByRole('log')).toHaveTextContent('HISTORY_81')
    expect(viewport.scrollTop).toBe(19 * 19)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(stdin).toBe('')
  } finally {
    delayed.resolve()
    cleanup()
    vi.useRealTimers()
  }
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

it('keeps left matches in place and reveals only matches covered by the floating bar without PTY input or resize', async () => {
  const user = userEvent.setup()
  const outlines: { left: number; top: number; width: number }[] = []
  const getRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'search' ? new DOMRect(40, 0, 416, 40) : getRect.call(this)
  })
  const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation()!
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    const context = getContext.call(this, '2d')
    if (context && 'strokeRect' in context) {
      context.strokeRect = (left, top, width) => {
        if (context.lineWidth === 2 && width > 8) outlines.push({ left, top, width })
      }
    }
    return context
  })
  const first = { start: { x: 0, y: 0 }, end: { x: 2, y: 0 } }
  const second = { start: { x: 4, y: 0 }, end: { x: 6, y: 0 } }
  const result: TerminalSearchProjection = {
    queryRevision: 0,
    resultRevision: 1,
    status: 'caught-up',
    count: 2,
    selected: { index: 0, range: first },
    matches: [second],
    highlightsLimited: true,
    partial: false
  }
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route === 'terminal.blocks.list')
      return { ok: true, data: { kind: 'blocks', indexRevision: 0, blocks: [], cursor: null } }
    if (route === 'terminal.search.close') return { ok: true, data: undefined }
    if (route === 'terminal.search.set') {
      const query = payload as InputFor<'terminal.search.set'>
      result.queryRevision = query.queryRevision
      return {
        ok: true,
        data: { ...result, ...(!query.needle ? { count: 0, selected: null, matches: [] } : {}) }
      }
    }
    if (route === 'terminal.search.navigate') {
      result.selected = result.selected?.index === 0 ? { index: 1, range: second } : { index: 0, range: first }
      return { ok: true, data: { ...result } }
    }
    const response = await request(route, payload)
    if (
      route === 'terminal.frame' &&
      typeof response === 'object' &&
      response !== null &&
      'ok' in response &&
      response.ok &&
      'data' in response
    ) {
      const frame = response.data as TerminalViewFrame
      const input = payload as InputFor<'terminal.frame'>
      const rows = Array.from({ length: 12 }, () => ({ ...frame.snapshot.rowData[0], text: '' }))
      const first = input.layout?.spans.find((span) => span.sourceStart === 0)
      if (!input.layout || first) rows[first?.targetStart ?? 0].text = 'foo foo'
      return {
        ok: true,
        data: {
          ...frame,
          nativeRevision: 1,
          sourceTotal: 12,
          sourceOrigin: 0,
          sourceContentEnd: 1,
          layoutRevision: input.layout?.revision,
          rowIndices: rows.map((_, index) => index),
          snapshot: {
            ...frame.snapshot,
            cols: 12,
            rows: 12,
            dirtyRows: rows.map((_, index) => index),
            rowData: rows
          }
        }
      }
    }
    return response
  })
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  const area = await input()
  const resizes = () =>
    vi
      .mocked(window.api.ipcApi.request)
      .mock.calls.filter(
        ([route, payload]) =>
          route === 'terminal.action' && (payload as InputFor<'terminal.action'>).action.kind === 'resize'
      ).length
  const before = resizes()
  fireEvent.keyDown(area, { key: 'f', code: 'KeyF', metaKey: true })
  await user.type(within(screen.getByRole('search')).getByRole('textbox'), 'foo')
  await waitFor(() => expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('1/2'))
  await waitFor(() => expect(outlines.at(-1)?.left).toBeLessThan(16))
  expect(outlines.at(-1)?.top).toBe(1)
  expect(screen.getByRole('log').textContent).toMatch(/^foo foo/)
  await user.click(screen.getByRole('button', { name: t('common.next') }))
  await waitFor(() => expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('2/2'))
  await waitFor(() => expect(outlines.at(-1)?.left).toBeGreaterThan(32))
  await waitFor(() => expect(outlines.at(-1)?.top).toBeGreaterThanOrEqual(48))
  await user.click(screen.getByRole('button', { name: t('common.next') }))
  await waitFor(() => expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('1/2'))
  await waitFor(() => expect(outlines.at(-1)?.top).toBe(1))
  expect(outlines.at(-1)?.left).toBeLessThan(16)
  await user.click(screen.getByRole('button', { name: t('common.close') }))
  await waitFor(() => expect(screen.getByRole('log').textContent).toMatch(/^foo foo/))
  expect(resizes()).toBe(before)
  expect(stdin).toBe('')
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
  const viewport = area.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!
  viewport.focus()
  fireEvent.keyDown(viewport, { key: 'f', code: 'KeyF', metaKey: true })
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

it('retargets block find on a plain click, removes its metadata rows and keeps keyboard find terminal-wide', async () => {
  const interactionLayer = { canvas: undefined as HTMLCanvasElement | undefined, shaded: false }
  const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation()!
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    const context = getContext.call(this, '2d')
    if (context && 'fillRect' in context) {
      context.clearRect = () => {
        if (this === interactionLayer.canvas) interactionLayer.shaded = false
      }
      context.fillRect = (left, _top, width, height) => {
        if (this === interactionLayer.canvas && left === 0 && width >= 600 && height > 0) interactionLayer.shaded = true
      }
    }
    return context
  })
  const painted = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  const first: TerminalBlockSummary = {
    timing: null,
    id: 'first',
    contentRevision: 1,
    command: 'printf first',
    cwd: '/project',
    status: 'completed',
    exitCode: 0,
    reliable: true,
    outputEmpty: true,
    prompt: { x: 0, y: 0 },
    output: { x: 0, y: 1 },
    end: { x: 0, y: 2 }
  }
  const latest: TerminalBlockSummary = {
    ...first,
    id: 'latest',
    command: 'printf latest',
    prompt: { x: 0, y: 3 },
    output: { x: 0, y: 4 },
    end: { x: 0, y: 5 }
  }
  let retired = false
  let mouseTracking = false
  const searches: InputFor<'terminal.search.set'>[] = []
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route === 'terminal.action' && (payload as InputFor<'terminal.action'>).action.kind === 'mouse')
      return { ok: true, data: { kind: 'resource', resource: current, inputHandled: mouseTracking } }
    if (route === 'terminal.blocks.list')
      return {
        ok: true,
        data: {
          kind: 'blocks',
          indexRevision: retired ? 2 : 1,
          blocks: retired ? [latest] : [first, latest],
          cursor: null
        }
      }
    if (route === 'terminal.search.close') return { ok: true, data: undefined }
    if (route === 'terminal.search.set') {
      const input = payload as InputFor<'terminal.search.set'>
      searches.push(input)
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
    const frame = result.data as TerminalViewFrame
    const input = payload as InputFor<'terminal.frame'>
    const rows = Array.from({ length: 12 }, () => ({
      text: '',
      cells: [],
      isWrapContinuation: false,
      wrapsToNext: false
    }))
    return {
      ok: true,
      data: {
        ...frame,
        nativeRevision: retired ? 2 : 1,
        sourceTotal: 12,
        sourceOrigin: 0,
        sourceContentEnd: 6,
        blockIndexRevision: retired ? 2 : 1,
        layoutRevision: input.layout?.revision,
        rowIndices: rows.map((_, n) => n),
        snapshot: { ...frame.snapshot, rows: 12, rowData: rows, dirtyRows: rows.map((_, n) => n) }
      }
    }
  })
  const user = userEvent.setup()
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  interactionLayer.canvas = screen.getByRole('region').querySelectorAll('canvas')[1]
  const area = await input()
  const triggers = await screen.findAllByRole('button', { name: t('common.more') })
  await user.click(triggers[0])
  await user.click(screen.getByRole('menuitem', { name: t('terminal.blocks.find_in_block') }))
  await waitFor(() => expect(interactionLayer.shaded).toBe(true))
  await user.click(screen.getByRole('button', { name: t('common.close') }))
  await painted()
  expect(interactionLayer.shaded).toBe(false)
  await waitFor(() => expect(document.querySelector('[data-terminal-block="first"]')).toBeInTheDocument())
  await user.click((await screen.findAllByRole('button', { name: t('common.more') }))[0])
  await user.click(screen.getByRole('menuitem', { name: t('terminal.blocks.find_in_block') }))
  const query = within(screen.getByRole('search')).getByRole('textbox')
  await waitFor(() => expect(query).toHaveFocus())
  const scope = screen.getByRole('button', { name: t('terminal.blocks.find_in_block') })
  expect(scope).toHaveAttribute('aria-pressed', 'true')
  expect(scope).toHaveAttribute('aria-description', t('terminal.blocks.search_target', { command: first.command }))
  await waitFor(() => expect(document.querySelector('[data-terminal-block="first"]')).not.toBeInTheDocument())
  expect(screen.queryByText(t('terminal.blocks.scope_block'))).not.toBeInTheDocument()
  await user.type(query, 'needle')
  await waitFor(() => expect(searches.at(-1)?.scope).toEqual({ kind: 'block', blockId: first.id }))
  await user.click(scope)
  await waitFor(() => expect(searches.at(-1)?.scope).toEqual({ kind: 'terminal' }))
  await painted()
  expect(interactionLayer.shaded).toBe(false)
  expect(query).toHaveValue('needle')
  await user.click(scope)
  await waitFor(() => expect(searches.at(-1)?.scope).toEqual({ kind: 'block', blockId: first.id }))
  await waitFor(() => expect(interactionLayer.shaded).toBe(true))
  const region = screen.getByRole('region')
  const latestHeader = document.querySelector<HTMLElement>('[data-terminal-block="latest"]')!
  const y =
    Number.parseFloat(latestHeader.parentElement!.style.top) +
    Number.parseFloat(latestHeader.style.top) +
    Number.parseFloat(latestHeader.style.height) +
    1
  await user.pointer([
    { target: region, coords: { x: 12, y }, keys: '[MouseLeft>]' },
    { coords: { x: 48, y } },
    { keys: '[/MouseLeft]' }
  ])
  expect(searches.at(-1)?.scope).toEqual({ kind: 'block', blockId: first.id })
  mouseTracking = true
  await user.pointer({ target: region, coords: { x: 12, y }, keys: '[MouseLeft]' })
  expect(scope).toHaveAttribute('aria-description', t('terminal.blocks.search_target', { command: first.command }))
  mouseTracking = false
  await user.pointer({ target: region, coords: { x: 12, y }, keys: '[MouseLeft]' })
  await waitFor(() => expect(searches.at(-1)?.scope).toEqual({ kind: 'block', blockId: latest.id }))
  expect(query).toHaveValue('needle')
  expect(query).toHaveFocus()
  await waitFor(() => expect(document.querySelector('[data-terminal-block="latest"]')).not.toBeInTheDocument())
  const firstHeader = document.querySelector<HTMLElement>('[data-terminal-block="first"]')!
  await user.pointer({
    target: region,
    coords: {
      x: 12,
      y:
        Number.parseFloat(firstHeader.parentElement!.style.top) +
        Number.parseFloat(firstHeader.style.top) +
        Number.parseFloat(firstHeader.style.height) +
        1
    },
    keys: '[MouseLeft]'
  })
  await waitFor(() => expect(searches.at(-1)?.scope).toEqual({ kind: 'block', blockId: first.id }))
  retired = true
  await waitFor(() => expect(scope).toHaveAttribute('aria-description', t('terminal.blocks.unavailable')))
  expect(screen.queryByText(t('terminal.blocks.search_target', { command: latest.command }))).not.toBeInTheDocument()
  expect(searches.at(-1)?.scope).toEqual({ kind: 'block', blockId: first.id })
  fireEvent.keyDown(query, { key: 'f', code: 'KeyF', metaKey: true })
  expect(screen.getByRole('search', { name: t('terminal.blocks.scope_terminal') })).toBeVisible()
  expect(query).toHaveFocus()
  await waitFor(() => expect(searches.at(-1)?.scope).toEqual({ kind: 'terminal' }))
  await user.type(query, 'updated')
  await waitFor(() => expect(searches.at(-1)?.needle).toContain('updated'))
  expect(searches.at(-1)?.scope).toEqual({ kind: 'terminal' })
  await user.keyboard('{Escape}')
  fireEvent.keyDown(area, { key: 'f', code: 'KeyF', metaKey: true })
  expect(screen.getByRole('search', { name: t('terminal.blocks.scope_terminal') })).toBeVisible()
  expect(stdin).toBe('')
})

it('keeps block controls and output coherent across source refresh, screen switches, reattachment and retirement', async () => {
  controlling = false
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  const block: TerminalBlockSummary = {
    timing: null,
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
  let retired = false
  let nativeRevision = 1
  let holdProjection = false
  let waitingForProjection = false
  const projection = Promise.withResolvers<void>()
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    if (route === 'terminal.attach')
      return { ok: true, data: `33333333-3333-4333-8333-${String(++attachments).padStart(12, '0')}` }
    if (route === 'terminal.blocks.list')
      return {
        ok: true,
        data: {
          kind: 'blocks',
          indexRevision: retired ? 2 : 1,
          blocks: alternate || retired ? [] : [block],
          cursor: null
        }
      }
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
    const projected = input.layout && !alternate && input.layout.sourceRevision === nativeRevision
    if (projected && holdProjection) {
      waitingForProjection = true
      await projection.promise
    }
    const source = Array.from({ length: 12 }, (_, n) => ({
      text: `row${n}`,
      cells: [],
      isWrapContinuation: false,
      wrapsToNext: false
    }))
    const rows = projected ? Array.from({ length: 12 }, () => ({ ...source[0], text: '' })) : [...source]
    for (const span of (projected && input.layout?.spans) || [])
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
        blockIndexRevision: retired ? 2 : 1,
        blocks: alternate || retired ? [] : [block],
        layoutRevision: projected ? input.layout?.revision : undefined,
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
  const controls = await firstView.findByRole('button', { name: /更多|More/ })
  await waitFor(() => expect(secondView.getByRole('log')).toHaveTextContent('row7'))
  await waitFor(() => expect(firstView.getByRole('log')).toHaveTextContent('row7'))
  expect(secondView.getByRole('log')).toHaveTextContent('row7')
  holdProjection = true
  nativeRevision++
  try {
    await waitFor(() => expect(waitingForProjection).toBe(true))
    expect(controls).toBeInTheDocument()
    expect(firstView.getByRole('log')).toHaveTextContent('row7')
    expect(secondView.getByRole('button', { name: /更多|More/ })).toBeInTheDocument()
  } finally {
    holdProjection = false
    projection.resolve()
  }
  alternate = true
  nativeRevision++
  await waitFor(() => expect(firstView.queryByRole('button', { name: /更多|More/ })).not.toBeInTheDocument())
  alternate = false
  nativeRevision++
  await firstView.findByRole('button', { name: /更多|More/ })
  await waitFor(() => expect(firstView.getByRole('log')).toHaveTextContent('row7'))
  rendered.rerender(views(false))
  rendered.rerender(views(true))
  await waitFor(() => expect(attachments).toBe(3))
  await firstView.findByRole('button', { name: /更多|More/ })
  await waitFor(() => expect(firstView.getByRole('log')).toHaveTextContent('row7'))
  expect(resizes).toBe(0)
  expect(stdin).toBe('')
  retired = true
  nativeRevision++
  await waitFor(() => expect(firstView.queryByRole('button', { name: /更多|More/ })).not.toBeInTheDocument())
  await waitFor(() => expect(firstView.getByRole('log')).toHaveTextContent('row7'))
})

it('preserves a text selection through an unchanged frame and limits its menu to copying and finding', async () => {
  const user = userEvent.setup()
  const request = vi.mocked(window.api.ipcApi.request).getMockImplementation()!
  const refreshed = Promise.withResolvers<void>()
  let observeRefresh = false
  vi.mocked(window.api.ipcApi.request).mockImplementation(async (route, payload) => {
    const result = await request(route, payload)
    if (route !== 'terminal.frame' || typeof result !== 'object' || result === null || !('data' in result))
      return result
    const frame = result.data as TerminalViewFrame
    if (observeRefresh) refreshed.resolve()
    const text = frame.snapshot.rowData[0].text
    const encoded = encodeTerminalRows([
      {
        text,
        isWrapContinuation: false,
        wrapsToNext: false,
        cells: Array.from(text, (text) => ({
          text,
          wide: 0,
          foreground: frame.snapshot.foreground,
          background: frame.snapshot.background,
          bold: false,
          italic: false,
          invisible: false,
          strikethrough: false,
          overline: false,
          underline: false,
          selected: false
        }))
      }
    ])
    return {
      ok: true,
      data: {
        ...frame,
        styles: encoded.styles,
        snapshot: { ...frame.snapshot, cols: text.length, rowData: encoded.rowData }
      }
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
  render(<TerminalCanvas onClose={() => {}} resource={current} active onResource={() => {}} />)
  await input()
  const region = screen.getByRole('region')
  await user.pointer({ target: region, keys: '[MouseLeft>]', coords: { x: 8, y: 8 } })
  await user.pointer({ target: region, coords: { x: 40, y: 8 } })
  await user.pointer({ keys: '[/MouseLeft]' })
  observeRefresh = true
  await act(async () => refreshed.promise)
  await user.pointer({ target: region, keys: '[MouseRight]', coords: { x: 24, y: 8 } })
  expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  expect(screen.queryByRole('menuitem', { name: /关闭终端|Close terminal/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: /光标样式|Cursor style/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('menuitem', { name: /查找|Find/ }))
  expect(within(await screen.findByRole('search')).getByRole('textbox')).toHaveValue('LIVE_')
  expect(stdin).toBe('')
})
