import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Textarea } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { InputFor } from '@shared/ipc/types'
import type { GhosttySnapshot, GhosttyTheme, GhosttyMouseInput, TerminalResourceState } from '@shared/types/terminal'

import {
  measureGhosttyCell,
  renderGhosttyCursor,
  renderGhosttySnapshot,
  type GhosttyCellMetrics
} from './canvasRenderer'
import {
  ghosttyConsumedMods,
  ghosttyKeyForEvent,
  ghosttyUnshiftedCodepoint,
  loadGhosttyKeyboardLayoutMap,
  type GhosttyKeyboardLayoutMap
} from './keyCodes'
import { applyTerminalFrame } from './terminalFrames'
import { useTerminalSettings } from './TerminalSettingsMenu'

type WireAction = InputFor<'terminal.action'>['action']
type LocalInput<T> = T extends { kind: 'key' | 'paste' } ? Omit<T, 'geometryEpoch'> : T
type Action = LocalInput<WireAction>
const textKey = (text: string) => ({
  kind: 'key' as const,
  event: { key: 0, mods: 0, consumedMods: 0, composing: false, unshiftedCodepoint: 0, text, repeat: false }
})
const mods = (event: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }) =>
  Number(event.shiftKey) | (Number(event.ctrlKey) << 1) | (Number(event.altKey) << 2) | (Number(event.metaKey) << 3)
interface Selection {
  start: { x: number; y: number }
  end: { x: number; y: number }
  epoch: number
}

export function TerminalCanvas({
  resource,
  active,
  onResource,
  takeControlOnAttach = false,
  onAttached
}: {
  resource: TerminalResourceState
  active: boolean
  onResource: (state: TerminalResourceState) => void
  takeControlOnAttach?: boolean
  onAttached?: () => void
}) {
  const { t } = useTranslation()
  const [settings] = useTerminalSettings()
  const cursorSettings = useRef(settings)
  cursorSettings.current = settings
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const viewport = useRef<DOMRectReadOnly | null>(null)
  const current = useRef(resource)
  if (resource.id !== current.current.id || resource.revision >= current.current.revision) current.current = resource
  const callback = useRef(onResource)
  callback.current = onResource
  const view = useRef<string | null>(null)
  const snapshot = useRef<GhosttySnapshot | null>(null)
  const epoch = useRef(0)
  const offset = useRef(0)
  const metrics = useRef<GhosttyCellMetrics>({ width: 8, height: 19, baseline: 15 })
  const font = useRef('monospace')
  const theme = useRef<GhosttyTheme | undefined>(undefined)
  const layout = useRef<GhosttyKeyboardLayoutMap | undefined>(undefined)
  const selection = useRef<Selection | null>(null)
  const mouseReported = useRef(false)
  const draw = useRef<number | null>(null)
  const dirty = useRef(new Set<number>())
  const force = useRef(true)
  const cursorOn = useRef(true)
  const composing = useRef<{ viewId: string; controlRevision: number; epoch: number; operationId: string } | null>(null)
  const suppressInput = useRef(false)
  const queue = useRef(Promise.resolve())
  const queued = useRef(0)
  const queuedBytes = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)
  const [accessible, setAccessible] = useState('')
  const [composition, setComposition] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [controlling, setControlling] = useState(false)
  const [viewReady, setViewReady] = useState(false)
  const focus = useRef(false)
  const claim = useRef(false)
  const attachedCallback = useRef(onAttached)
  attachedCallback.current = onAttached
  const printable = useRef<Extract<Action, { kind: 'key' }> | null>(null)
  const viewRevision = useRef(0)
  const controlEpoch = useRef(0)
  const resizing = useRef(0)
  const [geometryReady, setGeometryReady] = useState(false)
  const measuredGeometry = useRef('')

  const paint = useCallback(() => {
    draw.current = null
    const screen = snapshot.current
    const content = canvas.current?.getContext('2d')
    const cursor = overlay.current?.getContext('2d')
    const bounds = viewport.current
    if (!screen || !content || !cursor || !bounds) return
    const width = Math.max(bounds.width, screen.cols * metrics.current.width + 16)
    const height = Math.max(bounds.height, screen.rows * metrics.current.height + 16)
    const ratio = devicePixelRatio || 1
    for (const surface of [content.canvas, cursor.canvas]) {
      const pixels = Math.round(width * ratio)
      const pixelHeight = Math.round(height * ratio)
      if (surface.width !== pixels || surface.height !== pixelHeight) {
        surface.width = pixels
        surface.height = pixelHeight
        surface.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)
        force.current = true
      }
      surface.style.width = `${width}px`
      surface.style.height = `${height}px`
    }
    renderGhosttySnapshot({
      context: content,
      snapshot: { ...screen, cursorVisible: false, dirtyRows: dirty.current },
      metrics: metrics.current,
      fontSize: 14,
      fontFamily: font.current,
      padding: 8,
      forceFull: force.current,
      cursorOn: false
    })
    cursor.clearRect(0, 0, cursor.canvas.width, cursor.canvas.height)
    renderGhosttyCursor({
      context: cursor,
      snapshot: screen,
      metrics: metrics.current,
      fontSize: 14,
      fontFamily: font.current,
      padding: 8,
      cursorOn: cursorOn.current || !screen.cursorBlinking || !focus.current,
      focused: focus.current
    })
    const range = selection.current
    if (range && range.epoch === epoch.current) {
      const [start, end] =
        range.start.y * screen.cols + range.start.x <= range.end.y * screen.cols + range.end.x
          ? [range.start, range.end]
          : [range.end, range.start]
      cursor.fillStyle = 'rgba(72, 122, 191, 0.35)'
      for (let row = start.y; row <= end.y; row++) {
        const left = row === start.y ? start.x : 0
        const right = row === end.y ? end.x + 1 : screen.cols
        cursor.fillRect(
          8 + left * metrics.current.width,
          8 + row * metrics.current.height,
          (right - left) * metrics.current.width,
          metrics.current.height
        )
      }
    }
    if (input.current) {
      input.current.style.left = `${8 + Math.max(0, screen.cursorX) * metrics.current.width}px`
      input.current.style.top = `${8 + Math.max(0, screen.cursorY) * metrics.current.height}px`
    }
    dirty.current.clear()
    force.current = false
  }, [])
  const schedule = useCallback(() => {
    if (draw.current === null) draw.current = requestAnimationFrame(paint)
  }, [paint])

  const send = useCallback(
    (intent: Action, operationId: string = crypto.randomUUID()) => {
      const action: WireAction =
        intent.kind === 'key' || intent.kind === 'paste' ? { ...intent, geometryEpoch: epoch.current } : intent
      const controlChange = action.kind === 'take-control' || action.kind === 'return-control'
      if (controlChange) controlEpoch.current++
      const viewId = view.current
      const controlRevision = current.current.controlRevision
      if (action.kind === 'key' || action.kind === 'paste') {
        offset.current = 0
        selection.current = null
        force.current = true
      }
      const bytes = new TextEncoder().encode(JSON.stringify(action)).byteLength
      if (!viewId || queued.current >= 32 || queuedBytes.current + bytes > 128 * 1024) {
        setError(t('terminal.error.input_queue'))
        return Promise.resolve(false)
      }
      queued.current++
      queuedBytes.current += bytes
      let handled = false
      const work = queue.current
        .then(async () => {
          if (view.current !== viewId) throw new Error(t('terminal.error.view_changed'))
          const receipt = await ipcApi.request('terminal.action', { viewId, operationId, controlRevision, action })
          if (receipt.kind !== 'resource')
            throw new Error(
              t('terminal.error.rejected', { reason: receipt.kind === 'rejected' ? receipt.reason : 'unknown' })
            )
          if (receipt.resource.revision >= current.current.revision) current.current = receipt.resource
          if (action.kind === 'take-control') setControlling(true)
          if (action.kind === 'take-control') input.current?.focus()
          if (action.kind === 'return-control') setControlling(false)
          callback.current(receipt.resource)
          handled = receipt.inputHandled === true
          setError(null)
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          if (controlChange) controlEpoch.current++
          queued.current--
          queuedBytes.current -= bytes
        })
      queue.current = work
      return work.then(() => handled)
    },
    [t]
  )

  useEffect(() => {
    if (!takeControlOnAttach) {
      claim.current = false
      return
    }
    if (!active || !viewReady || claim.current) return
    claim.current = true
    void send({ kind: 'take-control' }).finally(() => attachedCallback.current?.())
  }, [takeControlOnAttach, active, viewReady, send])

  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attached: string | null = null
    const pull = async () => {
      try {
        const initial = current.current
        attached = await ipcApi.request('terminal.attach', { host: initial.host, id: initial.id })
        if (stopped) {
          await ipcApi.request('terminal.detach', { viewId: attached })
          return
        }
        view.current = attached
        setViewReady(true)
        let revision: number | null = null
        const update = async () => {
          if (stopped || !attached) return
          const viewportOffset = offset.current
          const requestedControlEpoch = controlEpoch.current
          let rowStart = 0
          let next = snapshot.current
          let baseline: { revision: number; geometryEpoch: number; baseRevision: number | null } | undefined
          let bytes = 0
          try {
            while (!stopped) {
              const frame = await ipcApi.request('terminal.frame', {
                viewId: attached,
                rowStart,
                offset: viewportOffset,
                revision: baseline?.revision ?? revision,
                theme: theme.current && { ...theme.current, ...cursorSettings.current }
              })
              bytes += new TextEncoder().encode(JSON.stringify(frame)).byteLength
              if (frame.rowStart !== rowStart || (!frame.complete && !frame.rowIndices.length))
                throw new Error(t('terminal.error.frame_gap'))
              if (bytes > 1024 * 1024) throw new Error(t('terminal.error.frame_capacity'))
              if (
                baseline &&
                (baseline.revision !== frame.revision ||
                  baseline.geometryEpoch !== frame.geometryEpoch ||
                  baseline.baseRevision !== frame.baseRevision)
              )
                throw new Error(t('terminal.error.frame_gap'))
              next = applyTerminalFrame(next, frame, {
                viewId: attached,
                generation: initial.host.generation,
                resourceId: initial.id,
                revision
              })
              baseline = frame
              if (frame.complete) {
                if (stopped) return
                if (epoch.current !== frame.geometryEpoch) {
                  selection.current = null
                  force.current = true
                }
                if (offset.current === viewportOffset) offset.current = frame.scrollOffset
                epoch.current = frame.geometryEpoch
                if (frame.baseRevision === null) force.current = true
                viewRevision.current = frame.revision
                if (
                  requestedControlEpoch === controlEpoch.current &&
                  frame.resource.controlRevision >= current.current.controlRevision
                )
                  setControlling(frame.controlling)
                setGeometryReady(!resizing.current && frame.geometryEpoch >= (current.current.geometryEpoch ?? 0))
                if (
                  selection.current &&
                  snapshot.current &&
                  next.rowData.some((row, index) => row.text !== snapshot.current?.rowData[index]?.text)
                )
                  selection.current = null
                snapshot.current = next
                frame.snapshot.dirtyRows.forEach((row) => dirty.current.add(row))
                if (frame.resource.revision >= current.current.revision) current.current = frame.resource
                callback.current(frame.resource)
                revision = frame.revision
                setAccessible(
                  next.rowData
                    .map((row) => row.text)
                    .join('\n')
                    .slice(-16 * 1024)
                )
                setViewError(null)
                schedule()
                break
              }
              rowStart += frame.rowIndices.length
            }
          } catch (cause) {
            revision = null
            force.current = true
            if (!stopped) setViewError(cause instanceof Error ? cause.message : String(cause))
          }
          if (!stopped) timer = setTimeout(() => void update(), 100)
        }
        void update()
      } catch (cause) {
        if (!stopped) setViewError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void pull()
    return () => {
      stopped = true
      view.current = null
      setViewReady(false)
      setGeometryReady(false)
      composing.current = null
      if (timer) clearTimeout(timer)
      if (attached) void ipcApi.request('terminal.detach', { viewId: attached }).catch(() => {})
      if (draw.current !== null) {
        cancelAnimationFrame(draw.current)
        draw.current = null
      }
    }
  }, [active, resource.id, resource.host.generation, schedule, send, t])

  useEffect(() => {
    if (!active || !root.current) return
    const measure = () => {
      const element = root.current
      const context = canvas.current?.getContext('2d')
      const rect = viewport.current
      if (!element || !context || !rect) return
      const style = getComputedStyle(element)
      font.current = style.fontFamily
      metrics.current = measureGhosttyCell(context, 14, font.current)
      const swatch = document.createElement('canvas').getContext('2d')!
      const color = (value: string) => {
        swatch.clearRect(0, 0, 1, 1)
        swatch.fillStyle = value
        swatch.fillRect(0, 0, 1, 1)
        const data = swatch.getImageData(0, 0, 1, 1).data
        return { r: data[0], g: data[1], b: data[2] }
      }
      theme.current = {
        foreground: color(style.color),
        background: color(style.backgroundColor),
        cursor: color(style.color)
      }
      force.current = true
      schedule()
      if (controlling && current.current.control.kind === 'user' && view.current) {
        const cols = Math.max(2, Math.min(256, Math.floor((rect.width - 16) / metrics.current.width)))
        const rows = Math.max(2, Math.min(80, Math.floor((rect.height - 16) / metrics.current.height)))
        const geometry = `${view.current}:${cols}:${rows}:${metrics.current.width}:${metrics.current.height}`
        if (measuredGeometry.current !== geometry) {
          measuredGeometry.current = geometry
          resizing.current++
          setGeometryReady(false)
          void send({
            kind: 'resize',
            cols,
            rows,
            cellWidth: metrics.current.width,
            cellHeight: metrics.current.height,
            geometryEpoch: epoch.current
          }).finally(() => {
            resizing.current--
          })
        }
      }
    }
    const observer = new ResizeObserver(([entry]) => {
      viewport.current = entry.contentRect
      measure()
    })
    observer.observe(root.current)
    const themeObserver = new MutationObserver(measure)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    window.addEventListener('resize', measure)
    void document.fonts.ready.then(measure)
    void loadGhosttyKeyboardLayoutMap().then((value) => {
      layout.current = value
    })
    measure()
    return () => {
      observer.disconnect()
      viewport.current = null
      themeObserver.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [active, resource.control.kind, resource.geometryEpoch, controlling, viewReady, schedule, send])

  const point = (event: { clientX: number; clientY: number }) => {
    const rect = root.current!.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        Math.min(
          (snapshot.current?.cols ?? 1) - 1,
          Math.floor((event.clientX - rect.left + root.current!.scrollLeft - 8) / metrics.current.width)
        )
      ),
      y: Math.max(
        0,
        Math.min(
          (snapshot.current?.rows ?? 1) - 1,
          Math.floor((event.clientY - rect.top + root.current!.scrollTop - 8) / metrics.current.height)
        )
      )
    }
  }
  const mouseData = useCallback(
    (event: MouseEvent | React.PointerEvent, action: 'press' | 'motion' | 'release'): GhosttyMouseInput => {
      const rect = root.current!.getBoundingClientRect()
      return {
        action,
        button: event.button === 0 ? 1 : event.button === 1 ? 3 : event.button === 2 ? 2 : null,
        mods: mods(event),
        x: Math.max(0, event.clientX - rect.left + root.current!.scrollLeft),
        y: Math.max(0, event.clientY - rect.top + root.current!.scrollTop),
        screenWidth: Math.max(rect.width, (snapshot.current?.cols ?? 1) * metrics.current.width + 16),
        screenHeight: Math.max(rect.height, (snapshot.current?.rows ?? 1) * metrics.current.height + 16),
        cellWidth: metrics.current.width,
        cellHeight: metrics.current.height,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 8,
        paddingBottom: 8,
        anyButtonPressed: event.buttons !== 0
      }
    },
    []
  )
  const mouse = (event: React.PointerEvent, action: 'press' | 'motion' | 'release') =>
    send({ kind: 'mouse', geometryEpoch: epoch.current, event: mouseData(event, action) })
  useEffect(() => {
    const element = root.current
    if (!element || !active) return
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      event.preventDefault()
      const rows =
        Math.sign(event.deltaY) * Math.min(30, Math.max(1, Math.round(Math.abs(event.deltaY) / metrics.current.height)))
      const scroll = () => {
        const top = element.scrollTop
        element.scrollTop = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, top + event.deltaY))
        if (top !== element.scrollTop) return
        offset.current = Math.max(0, Math.min(5000, offset.current - rows))
        selection.current = null
        force.current = true
      }
      if (
        controlling &&
        geometryReady &&
        current.current.control.kind === 'user' &&
        offset.current === 0 &&
        !event.shiftKey
      )
        void send({ kind: 'wheel', rows, geometryEpoch: epoch.current, event: mouseData(event, 'press') }).then(
          (handled) => {
            if (!handled) scroll()
          }
        )
      else scroll()
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [active, controlling, geometryReady, mouseData, send])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      cursorOn.current = !cursorOn.current
      schedule()
    }, 500)
    return () => clearInterval(timer)
  }, [active, schedule])
  const copy = () => {
    const screen = snapshot.current
    const range = selection.current
    if (!screen || !range) return
    const [start, end] =
      range.start.y * screen.cols + range.start.x <= range.end.y * screen.cols + range.end.x
        ? [range.start, range.end]
        : [range.end, range.start]
    const text = screen.rowData
      .slice(start.y, end.y + 1)
      .map(
        (row, i) =>
          row.cells
            .slice(i === 0 ? start.x : 0, i === end.y - start.y ? end.x + 1 : screen.cols)
            .filter((cell) => cell.wide !== 2 && cell.wide !== 3)
            .map((cell) => cell.text || ' ')
            .join('')
            .trimEnd() + (row.wrapsToNext || i === end.y - start.y ? '' : '\n')
      )
      .join('')
    void navigator.clipboard.writeText(text).catch((cause: unknown) => setError(String(cause)))
  }
  const controlled = controlling && resource.control.kind === 'user' && resource.process.kind === 'running'
  const canInput = controlled && geometryReady
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          disabled={resource.process.kind !== 'running'}
          onClick={() => void send({ kind: controlled ? 'return-control' : 'take-control' })}>
          {t(controlled ? 'terminal.return_control' : 'terminal.take_control')}
        </Button>
        <Button size="sm" variant="ghost" onClick={copy}>
          {t('terminal.copy')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canInput}
          onClick={() =>
            void send({
              kind: 'key',
              event: {
                key: ghosttyKeyForEvent({ code: 'KeyC', key: 'c' }),
                mods: 2,
                consumedMods: 0,
                composing: false,
                unshiftedCodepoint: 99,
                text: 'c',
                repeat: false
              }
            })
          }>
          {t('terminal.interrupt')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={resource.cleanup === 'confirmed'}
          onClick={() => void send({ kind: 'stop' })}>
          {t(resource.cleanup === 'unconfirmed' ? 'terminal.retry_close' : 'terminal.close')}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {t(controlled ? 'terminal.user_control' : 'terminal.observing')}
        </span>
      </div>
      {(error || viewError) && (
        <div role="alert" className="px-3 py-2 text-xs text-destructive">
          {error || viewError}
        </div>
      )}
      <div
        ref={root}
        className="relative min-h-0 flex-1 overflow-auto bg-[oklch(from_var(--background)_l_c_h_/_1)] text-foreground focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring"
        style={{ fontFamily: 'var(--code-font-family)' }}
        onPointerDown={(event) => {
          event.preventDefault()
          if ((event.metaKey || event.ctrlKey) && view.current) {
            const at = point(event)
            void ipcApi
              .request('terminal.link', {
                viewId: view.current,
                revision: viewRevision.current,
                geometryEpoch: epoch.current,
                ...at
              })
              .then((url) => {
                if (url) return ipcApi.request('system.shell.open_external_website', url)
                return undefined
              })
              .catch((cause: unknown) => setError(String(cause)))
            return
          }
          input.current?.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          const at = point(event)
          selection.current = { start: at, end: at, epoch: epoch.current }
          mouseReported.current = false
          schedule()
          if (canInput && !event.shiftKey && offset.current === 0)
            void mouse(event, 'press').then((handled) => {
              mouseReported.current = handled
              if (handled) {
                selection.current = null
                schedule()
              }
            })
        }}
        onPointerMove={(event) => {
          if (!event.buttons) return
          if (mouseReported.current) void mouse(event, 'motion')
          else if (selection.current) {
            selection.current.end = point(event)
            schedule()
          }
        }}
        onPointerUp={(event) => {
          if (mouseReported.current) void mouse(event, 'release')
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}>
        <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 size-full" />
        <canvas ref={overlay} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
        <Textarea.Input
          ref={input}
          value={inputValue}
          onValueChange={setInputValue}
          aria-label={t('terminal.input')}
          readOnly={!canInput}
          className="absolute z-10 h-5 min-h-0 w-px resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 shadow-none focus-visible:ring-0"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            focus.current = true
            setFocused(true)
            schedule()
          }}
          onBlur={() => {
            focus.current = false
            setFocused(false)
            schedule()
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === 'c') {
              if (selection.current) {
                event.preventDefault()
                copy()
              }
              return
            }
            if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === 'v') return
            if (
              !canInput ||
              event.nativeEvent.isComposing ||
              composing.current ||
              event.key === 'Dead' ||
              event.key === 'Process' ||
              event.keyCode === 229
            )
              return
            if (
              [...event.key].length === 1 &&
              !event.ctrlKey &&
              !event.metaKey &&
              (!event.altKey || /mac/i.test(navigator.platform))
            ) {
              printable.current = {
                kind: 'key',
                event: {
                  key: ghosttyKeyForEvent(event.nativeEvent),
                  mods: mods(event),
                  consumedMods: ghosttyConsumedMods(event.nativeEvent),
                  composing: false,
                  unshiftedCodepoint: ghosttyUnshiftedCodepoint(event.nativeEvent, layout.current),
                  text: event.key,
                  repeat: event.repeat
                }
              }
              return
            }
            if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return
            event.preventDefault()
            void send({
              kind: 'key',
              event: {
                key: ghosttyKeyForEvent(event.nativeEvent),
                mods: mods(event),
                consumedMods: ghosttyConsumedMods(event.nativeEvent),
                composing: false,
                unshiftedCodepoint: ghosttyUnshiftedCodepoint(event.nativeEvent, layout.current),
                text: [...event.key].length === 1 ? event.key : '',
                repeat: event.repeat
              }
            })
          }}
          onInput={(event) => {
            if (composing.current || (event.nativeEvent as InputEvent).isComposing) return
            const value = event.currentTarget.value
            event.currentTarget.value = ''
            setInputValue('')
            if (suppressInput.current) return
            const key = printable.current
            printable.current = null
            if (canInput && value)
              void send(
                key && key.event.text === value ? { ...key, event: { ...key.event, text: value } } : textKey(value)
              )
          }}
          onPaste={(event) => {
            event.preventDefault()
            if (canInput) void send({ kind: 'paste', data: event.clipboardData.getData('text/plain') })
          }}
          onCompositionStart={() => {
            printable.current = null
            if (canInput && view.current)
              composing.current = {
                viewId: view.current,
                controlRevision: current.current.controlRevision,
                epoch: epoch.current,
                operationId: crypto.randomUUID()
              }
          }}
          onCompositionUpdate={(event) => setComposition(event.data)}
          onCompositionEnd={(event) => {
            const commit = composing.current
            composing.current = null
            setComposition('')
            event.currentTarget.value = ''
            setInputValue('')
            suppressInput.current = true
            queueMicrotask(() => {
              suppressInput.current = false
            })
            if (
              !commit ||
              !canInput ||
              commit.viewId !== view.current ||
              commit.controlRevision !== current.current.controlRevision ||
              commit.epoch !== epoch.current
            ) {
              setError(t('terminal.error.view_changed'))
              return
            }
            if (event.data) void send(textKey(event.data), commit.operationId)
          }}
        />
        {composition && (
          <span
            className="pointer-events-none absolute z-20 bg-background text-foreground underline"
            style={{
              left: 8 + Math.max(0, snapshot.current?.cursorX ?? 0) * metrics.current.width,
              top: 8 + Math.max(0, snapshot.current?.cursorY ?? 0) * metrics.current.height
            }}>
            {composition}
          </span>
        )}
        <pre className="sr-only" role="log" aria-live={focused ? 'polite' : 'off'} aria-label={t('terminal.output')}>
          {accessible}
        </pre>
      </div>
    </div>
  )
}
