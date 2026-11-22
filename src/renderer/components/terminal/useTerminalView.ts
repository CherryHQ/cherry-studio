import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ipcApi } from '@renderer/ipc'
import { attachGeneratedText } from '@renderer/services/EventService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { InputFor } from '@shared/ipc/types'
import type {
  GhosttySnapshot,
  GhosttyTheme,
  GhosttyMouseInput,
  TerminalResourceState,
  TerminalBlockSummary,
  TerminalSearchProjection,
  TerminalViewFrame
} from '@shared/types/terminal'

import {
  measureGhosttyCell,
  renderGhosttyCursor,
  renderGhosttySnapshot,
  type GhosttyCellMetrics
} from './canvasRenderer'
import { ghosttyKeyForEvent, loadGhosttyKeyboardLayoutMap, type GhosttyKeyboardLayoutMap } from './keyCodes'
import { terminalBlockActions, terminalBlockActionLabels, type TerminalBlockAction } from './TerminalBlockControls'
import {
  newTerminalPresentation,
  terminalBlockLayout,
  terminalVisibleSpans,
  terminalSourceAt,
  terminalVisualAt,
  terminalOffsetForSource,
  type TerminalPresentation,
  type TerminalBlockLayout
} from './terminalBlockLayout'
import { useTerminalSettings, type TerminalMenuAction } from './TerminalContextMenu'
import { applyTerminalFrame } from './terminalFrames'

type WireAction = InputFor<'terminal.action'>['action']
type LocalInput<T> = T extends { kind: 'key' | 'paste' } ? Omit<T, 'geometryEpoch'> : T
type Action = LocalInput<WireAction>
const mods = (event: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }) =>
  Number(event.shiftKey) | (Number(event.ctrlKey) << 1) | (Number(event.altKey) << 2) | (Number(event.metaKey) << 3)
interface Selection {
  start: { x: number; y: number }
  end: { x: number; y: number }
  epoch: number
  rectangle: boolean
}

export interface TerminalViewProps {
  resource: TerminalResourceState
  active: boolean
  onResource: (state: TerminalResourceState) => void
  takeControlOnAttach?: boolean
  onAttached?: () => void
  renderHeader?: (controls: ReactNode) => ReactNode
  onClose: () => void
  closing?: boolean
  presentation?: TerminalPresentation
}

export function useTerminalView({
  resource,
  active,
  onResource,
  takeControlOnAttach = false,
  onAttached,
  onClose,
  closing = false,
  presentation: savedPresentation
}: TerminalViewProps) {
  const { t } = useTranslation()
  const [settings] = useTerminalSettings()
  const cursorSettings = useRef(settings)
  cursorSettings.current = settings
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const findBar = useRef<HTMLDivElement>(null)
  const viewport = useRef<DOMRectReadOnly | null>(null)
  const current = useRef(resource)
  if (resource.id !== current.current.id || resource.revision >= current.current.revision) current.current = resource
  const closingRef = useRef(closing)
  closingRef.current = closing
  const acceptsActions = useCallback(
    () => !closingRef.current && current.current.cleanup === 'none' && current.current.process.kind === 'running',
    []
  )
  const callback = useRef(onResource)
  callback.current = onResource
  const view = useRef<string | null>(null)
  const snapshot = useRef<GhosttySnapshot | null>(null)
  const epoch = useRef(0)
  const fallbackPresentation = useRef(newTerminalPresentation())
  const presentation = savedPresentation ?? fallbackPresentation.current
  const offset = useRef(presentation.offset)
  const blocks = useRef<TerminalBlockSummary[]>([])
  const sourceFrame = useRef<TerminalViewFrame | null>(null)
  const projected = useRef<TerminalBlockLayout | null>(null)
  const layoutSequence = useRef(0)
  const [contextBlock, setContextBlock] = useState<string | null>(null)
  const [controls, setControls] = useState<{ layout: TerminalBlockLayout; height: number } | null>(null)
  const [collapsed, setCollapsed] = useState(presentation.collapsed)
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed
  const [findOpen, setFindOpen] = useState(false)
  const [find, setFind] = useState(presentation.find)
  const findRef = useRef(find)
  findRef.current = find
  const [searchResult, setSearchResult] = useState<TerminalSearchProjection | null>(null)
  const searchQuery = useRef({ revision: 0, signature: '' })
  const findTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const highlight = useRef<TerminalSearchProjection | null>(null)
  const metrics = useRef<GhosttyCellMetrics>({ width: 8, height: 19, baseline: 15 })
  const font = useRef('monospace')
  const theme = useRef<GhosttyTheme | undefined>(undefined)
  const layout = useRef<GhosttyKeyboardLayoutMap | undefined>(undefined)
  const selection = useRef<Selection | null>(null)
  const semanticSelection = useRef(presentation.selection)
  const mousePress = useRef<Promise<boolean> | null>(null)
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
  const [agentConnected, setAgentConnected] = useState(false)
  const [controlPending, setControlPending] = useState(false)
  const [viewReady, setViewReady] = useState(false)
  const focus = useRef(false)
  const claim = useRef(false)
  const attachedCallback = useRef(onAttached)
  attachedCallback.current = onAttached
  const pendingSelection = useRef<{ blockId: string; revision: number } | null>(null)
  const printable = useRef<Extract<Action, { kind: 'key' }> | null>(null)
  const viewRevision = useRef(0)
  const controlEpoch = useRef(0)
  const resizing = useRef(0)
  const [geometryReady, setGeometryReady] = useState(false)
  const measuredGeometry = useRef('')
  const confirmedGeometry = useRef('')

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
    const projection = projected.current
    if (highlight.current) {
      cursor.fillStyle = 'rgba(234,179,8,0.22)'
      for (const match of highlight.current.matches) {
        const first = projection
            ? terminalVisualAt(projection, match.start)
            : match.start.y - (sourceFrame.current?.sourceOrigin ?? 0),
          last = projection
            ? terminalVisualAt(projection, match.end)
            : match.end.y - (sourceFrame.current?.sourceOrigin ?? 0)
        if (first === null || last === null) continue
        for (let y = Math.max(0, first); y <= Math.min(screen.rows - 1, last); y++)
          cursor.fillRect(
            8 + (y === first ? match.start.x : 0) * metrics.current.width,
            8 + y * metrics.current.height,
            ((y === last ? match.end.x + 1 : screen.cols) - (y === first ? match.start.x : 0)) * metrics.current.width,
            metrics.current.height
          )
      }
    }
    const range = selection.current
    if (range && range.epoch === epoch.current) {
      const [start, end] =
        range.start.y * screen.cols + range.start.x <= range.end.y * screen.cols + range.end.x
          ? [range.start, range.end]
          : [range.end, range.start]
      cursor.fillStyle = 'rgba(72, 122, 191, 0.35)'
      for (let row = start.y; row <= end.y; row++) {
        if (projected.current && terminalSourceAt(projected.current, row) === null) continue
        const left = range.rectangle ? Math.min(start.x, end.x) : row === start.y ? start.x : 0
        const right = range.rectangle ? Math.max(start.x, end.x) + 1 : row === end.y ? end.x + 1 : screen.cols
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
    (intent: Action, operationId: string = crypto.randomUUID(), acceptedPress?: Promise<boolean>) => {
      if (!acceptsActions() || (intent.kind === 'rerun' && (composing.current || queued.current)))
        return Promise.resolve(false)
      const action: WireAction =
        intent.kind === 'key' || intent.kind === 'paste' ? { ...intent, geometryEpoch: epoch.current } : intent
      const controlChange = action.kind === 'take-control' || action.kind === 'return-control'
      if (controlChange) {
        controlEpoch.current++
        setGeometryReady(false)
        setControlPending(true)
      }
      const viewId = view.current
      const controlRevision = current.current.controlRevision
      if (action.kind === 'key' || action.kind === 'paste') {
        offset.current = 0
        selection.current = null
        force.current = true
      }
      const bytes = new TextEncoder().encode(JSON.stringify(action)).byteLength
      if (!viewId || queued.current >= 32 || queuedBytes.current + bytes > 128 * 1024) {
        if (controlChange) setControlPending(false)
        setError(t('terminal.error.input_queue'))
        return Promise.resolve(false)
      }
      queued.current++
      queuedBytes.current += bytes
      let handled = false
      const work = queue.current
        .then(async () => {
          if (acceptedPress && !(await acceptedPress)) return
          if (!acceptsActions()) return
          if (view.current !== viewId) throw new Error(t('terminal.error.view_changed'))
          const submitted =
            action.kind === 'resize'
              ? { ...action, geometryEpoch: current.current.geometryEpoch ?? epoch.current }
              : action
          const receipt = await ipcApi.request('terminal.action', {
            viewId,
            operationId,
            controlRevision,
            action: submitted
          })
          if (receipt.kind !== 'resource')
            throw new Error(
              t('terminal.error.rejected', { reason: receipt.kind === 'rejected' ? receipt.reason : 'unknown' })
            )
          if (receipt.resource.revision >= current.current.revision) current.current = receipt.resource
          callback.current(receipt.resource)
          if (!acceptsActions()) return
          if (controlChange) {
            measuredGeometry.current = ''
            confirmedGeometry.current = ''
          }
          if (action.kind === 'take-control') setControlling(true)
          if (action.kind === 'take-control') input.current?.focus()
          if (action.kind === 'return-control') setControlling(false)
          handled = receipt.inputHandled === true || action.kind === 'resize'
          setError(null)
        })
        .catch((cause: unknown) => {
          if (acceptsActions()) setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          if (controlChange) {
            controlEpoch.current++
            setControlPending(false)
          }
          queued.current--
          queuedBytes.current -= bytes
        })
      queue.current = work
      return work.then(() => handled)
    },
    [t, acceptsActions]
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
          const origin = sourceFrame.current
          const requestedLayout =
            origin && !origin.alternate && blocks.current.length
              ? terminalBlockLayout(
                  blocks.current,
                  collapsedRef.current,
                  origin.sourceTotal ?? 0,
                  origin.snapshot.rows,
                  viewportOffset,
                  origin.sourceContentEnd
                )
              : null
          const layoutToken = ++layoutSequence.current
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
                offset: requestedLayout ? 0 : viewportOffset,
                layout:
                  requestedLayout && origin
                    ? {
                        revision: layoutToken,
                        sourceRevision: origin.nativeRevision ?? 0,
                        geometryEpoch: origin.geometryEpoch,
                        spans: terminalVisibleSpans(requestedLayout)
                      }
                    : undefined,
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
                const nextLayout = frame.layoutRevision === layoutToken ? requestedLayout : null
                if (
                  projected.current?.top !== nextLayout?.top ||
                  projected.current?.total !== nextLayout?.total ||
                  !nextLayout
                ) {
                  selection.current = null
                  force.current = true
                }
                projected.current = nextLayout
                setControls(nextLayout ? { layout: nextLayout, height: metrics.current.height } : null)
                if (!requestedLayout && offset.current === viewportOffset) offset.current = frame.scrollOffset
                presentation.offset = offset.current
                if (frame.search?.queryRevision === searchQuery.current.revision) {
                  highlight.current = frame.search
                  setSearchResult(frame.search)
                }
                const previousSource = sourceFrame.current
                sourceFrame.current = frame
                if (frame.blocks)
                  for (const block of frame.blocks) {
                    const previous = blocks.current.findIndex((value) => value.id === block.id)
                    if (previous >= 0) blocks.current[previous] = block
                  }
                if (
                  !frame.alternate &&
                  (frame.nativeRevision !== previousSource?.nativeRevision ||
                    frame.blockIndexRevision !== previousSource?.blockIndexRevision)
                ) {
                  let cursor: string | null = null,
                    indexRevision: number | null = null
                  const updated: TerminalBlockSummary[] = []
                  do {
                    const page = await ipcApi.request('terminal.blocks.list', {
                      viewId: attached,
                      cursor,
                      expectedIndexRevision: indexRevision,
                      limit: 32
                    })
                    if (stopped) return
                    if (page.kind === 'stale') break
                    indexRevision = page.indexRevision
                    updated.push(...page.blocks)
                    cursor = page.cursor
                  } while (cursor && updated.length < 256)
                  if (!cursor && indexRevision !== null) {
                    blocks.current = updated
                    const retained = new Set(updated.map((block) => block.id))
                    const next = collapsedRef.current.filter((id) => retained.has(id))
                    if (next.length !== collapsedRef.current.length) {
                      collapsedRef.current = next
                      presentation.collapsed = next
                      setCollapsed(next)
                    }
                  }
                }
                epoch.current = frame.geometryEpoch
                if (frame.baseRevision === null) force.current = true
                viewRevision.current = frame.revision
                if (
                  requestedControlEpoch === controlEpoch.current &&
                  frame.resource.controlRevision >= current.current.controlRevision
                )
                  setControlling(frame.controlling)
                setGeometryReady(
                  !resizing.current &&
                    measuredGeometry.current.startsWith(`${attached}:`) &&
                    confirmedGeometry.current === measuredGeometry.current &&
                    frame.geometryEpoch >= (current.current.geometryEpoch ?? 0)
                )
                if (
                  selection.current &&
                  snapshot.current &&
                  next.rowData.some((row, index) => row.text !== snapshot.current?.rowData[index]?.text)
                )
                  selection.current = null
                snapshot.current = next
                if (pendingSelection.current && nextLayout) {
                  const target = blocks.current.find(
                    (block) =>
                      block.id === pendingSelection.current?.blockId &&
                      block.contentRevision === pendingSelection.current?.revision
                  )
                  if (target?.prompt && target.end) {
                    const start = terminalVisualAt(nextLayout, target.prompt),
                      end = terminalVisualAt(nextLayout, { x: 0, y: Math.max(target.prompt.y, target.end.y - 1) })
                    if (start !== null && end !== null)
                      selection.current = {
                        start: { x: target.prompt.x, y: Math.max(0, start) },
                        end: { x: next.cols - 1, y: Math.min(next.rows - 1, end) },
                        epoch: frame.geometryEpoch,
                        rectangle: false
                      }
                  }
                  pendingSelection.current = null
                }
                frame.snapshot.dirtyRows.forEach((row) => dirty.current.add(row))
                if (frame.resource.revision >= current.current.revision) current.current = frame.resource
                callback.current(frame.resource)
                setAgentConnected(frame.agentConnected)
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
  }, [active, resource.id, resource.host.generation, schedule, send, t, presentation])

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
      if (acceptsActions() && controlling && current.current.control.kind === 'user' && view.current) {
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
          })
            .then((accepted) => {
              if (accepted) confirmedGeometry.current = geometry
            })
            .finally(() => {
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
  }, [active, resource.control.kind, resource.geometryEpoch, controlling, viewReady, schedule, send, acceptsActions])

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
  const extendSelection = (event: { clientX: number; clientY: number }) => {
    const range = selection.current
    if (!range) return
    const end = point(event),
      layout = projected.current
    if (range.rectangle && layout) {
      const step = end.y >= range.start.y ? 1 : -1
      let previous = terminalSourceAt(layout, range.start.y)
      for (let row = range.start.y + step; step > 0 ? row <= end.y : row >= end.y; row += step) {
        const source = terminalSourceAt(layout, row)
        if (source === null || previous === null || source !== previous + step) {
          end.y = row - step
          break
        }
        previous = source
      }
    }
    range.end = end
    schedule()
  }
  const mouseData = useCallback(
    (event: MouseEvent | React.PointerEvent, action: 'press' | 'motion' | 'release'): GhosttyMouseInput => {
      const rect = root.current!.getBoundingClientRect()
      return {
        action,
        button: event.button === 0 ? 1 : event.button === 1 ? 3 : event.button === 2 ? 2 : null,
        mods: mods(event),
        x: Math.max(0, event.clientX - rect.left + root.current!.scrollLeft),
        y: (() => {
          const visual = Math.floor((event.clientY - rect.top + root.current!.scrollTop - 8) / metrics.current.height)
          const source = projected.current ? terminalSourceAt(projected.current, visual) : null
          return source === null
            ? Math.max(0, event.clientY - rect.top + root.current!.scrollTop)
            : 8 +
                (source - ((sourceFrame.current?.sourceTotal ?? 0) - (snapshot.current?.rows ?? 0))) *
                  metrics.current.height
        })(),
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
  const mouse = (
    event: React.PointerEvent,
    action: 'press' | 'motion' | 'release',
    acceptedPress?: Promise<boolean>
  ) =>
    projected.current &&
    (terminalSourceAt(projected.current, point(event).y) === null || mouseData(event, action).y < 8)
      ? Promise.resolve(false)
      : send({ kind: 'mouse', geometryEpoch: epoch.current, event: mouseData(event, action) }, undefined, acceptedPress)
  useEffect(() => {
    const element = root.current
    if (!element || !active) return
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      if (event.target instanceof Element && event.target.closest('[role="search"]')) return
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
      const data = mouseData(event, 'press')
      const visual = Math.floor(
        (event.clientY - element.getBoundingClientRect().top + element.scrollTop - 8) / metrics.current.height
      )
      const source = !projected.current || terminalSourceAt(projected.current, visual) !== null
      if (
        controlling &&
        geometryReady &&
        current.current.control.kind === 'user' &&
        offset.current === 0 &&
        source &&
        data.y >= 8 &&
        !event.shiftKey
      )
        void send({ kind: 'wheel', rows, geometryEpoch: epoch.current, event: data }).then((handled) => {
          if (!handled) scroll()
        })
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
    const semantic = semanticSelection.current,
      viewId = view.current
    if (semantic && viewId) {
      void ipcApi
        .request('terminal.blocks.read', {
          viewId,
          blockId: semantic.blockId,
          part: 'block',
          consistency: { kind: 'exact', contentRevision: semantic.contentRevision }
        })
        .then((read) => {
          if (read.kind !== 'content') throw new Error(t('terminal.blocks.unavailable'))
          return navigator.clipboard.writeText(read.text)
        })
        .catch((cause) => setError(String(cause)))
      return
    }
    const screen = snapshot.current
    const range = selection.current
    if (!screen || !range) return
    const [start, end] =
      range.start.y * screen.cols + range.start.x <= range.end.y * screen.cols + range.end.x
        ? [range.start, range.end]
        : [range.end, range.start]
    const text = screen.rowData
      .slice(start.y, end.y + 1)
      .map((row, i) =>
        projected.current && terminalSourceAt(projected.current, start.y + i) === null
          ? ''
          : row.cells
              .slice(
                range.rectangle ? Math.min(start.x, end.x) : i === 0 ? start.x : 0,
                range.rectangle ? Math.max(start.x, end.x) + 1 : i === end.y - start.y ? end.x + 1 : screen.cols
              )
              .filter((cell) => cell.wide !== 2 && cell.wide !== 3)
              .map((cell) => cell.text || ' ')
              .join('')
              .trimEnd() + ((!range.rectangle && row.wrapsToNext) || i === end.y - start.y ? '' : '\n')
      )
      .join('')
    void navigator.clipboard.writeText(text).catch((cause: unknown) => setError(String(cause)))
  }
  const controlled = acceptsActions() && controlling && resource.control.kind === 'user'
  const canInput = controlled && geometryReady
  const toggleBlock = (block: TerminalBlockSummary) => {
    const layout = projected.current
    const anchor = layout ? terminalSourceAt(layout, 0) : null
    const next = collapsedRef.current.includes(block.id)
      ? collapsedRef.current.filter((id) => id !== block.id)
      : [...collapsedRef.current, block.id]
    collapsedRef.current = next
    presentation.collapsed = next
    setCollapsed(next)
    if (offset.current > 0 && anchor !== null && sourceFrame.current) {
      const nextLayout = terminalBlockLayout(
        blocks.current,
        next,
        sourceFrame.current.sourceTotal ?? 0,
        sourceFrame.current.snapshot.rows,
        offset.current,
        sourceFrame.current.sourceContentEnd
      )
      offset.current = terminalOffsetForSource(nextLayout, anchor)
    }
    selection.current = null
    force.current = true
  }
  const canRun =
    canInput &&
    current.current.editor?.kind === 'empty' &&
    current.current.shellFacts?.kind === 'prompt' &&
    !queued.current &&
    !composing.current
  const closeFind = () => {
    setFindOpen(false)
    if (findTimer.current) clearTimeout(findTimer.current)
    const viewId = view.current,
      queryRevision = searchQuery.current.revision
    searchQuery.current = { revision: queryRevision + 1, signature: '' }
    if (viewId) void ipcApi.request('terminal.search.close', { viewId, queryRevision }).catch(() => {})
    highlight.current = null
    setSearchResult(null)
    schedule()
    if (active) input.current?.focus({ preventScroll: true })
  }
  const flushFind = useCallback(async () => {
    if (findTimer.current) clearTimeout(findTimer.current)
    const state = findRef.current,
      viewId = view.current
    if (!viewId) return null
    const scope =
      state.scope === 'block' && state.blockId
        ? { kind: 'block' as const, blockId: state.blockId }
        : { kind: 'terminal' as const }
    const signature = JSON.stringify({ scope, needle: state.needle })
    if (signature !== searchQuery.current.signature) {
      void ipcApi
        .request('terminal.search.close', { viewId, queryRevision: searchQuery.current.revision })
        .catch(() => {})
      searchQuery.current = { revision: searchQuery.current.revision + 1, signature }
    }
    const revision = searchQuery.current.revision
    const result = await ipcApi.request('terminal.search.set', {
      viewId,
      queryRevision: revision,
      scope,
      needle: state.needle
    })
    if (view.current !== viewId || searchQuery.current.revision !== revision) return null
    setSearchResult(result)
    highlight.current = result
    schedule()
    return result
  }, [schedule])
  const changeFind = (needle: string, scope: 'terminal' | 'block') => {
    const next = { ...findRef.current, needle, scope }
    const previousRevision = searchQuery.current.revision
    searchQuery.current = { revision: previousRevision + 1, signature: '' }
    const viewId = view.current
    if (viewId)
      void ipcApi.request('terminal.search.close', { viewId, queryRevision: previousRevision }).catch(() => {})
    findRef.current = next
    presentation.find = next
    setFind(next)
    if (findTimer.current) clearTimeout(findTimer.current)
    highlight.current = null
    setSearchResult(null)
    if (new TextEncoder().encode(needle).length > 4096) {
      setError(t('terminal.blocks.search_capacity'))
      return
    }
    if (!needle) void flushFind().catch((cause) => setError(String(cause)))
    else findTimer.current = setTimeout(() => void flushFind().catch((cause) => setError(String(cause))), 100)
  }
  const openFind = (block?: TerminalBlockSummary) => {
    const blockScope = block !== undefined
    block ??= blocks.current.at(-1)
    const next = {
      ...findRef.current,
      scope: blockScope ? ('block' as const) : findRef.current.scope,
      blockId: block?.id ?? findRef.current.blockId
    }
    findRef.current = next
    setFind(next)
    setFindOpen(true)
    if (next.needle) void flushFind().catch((cause) => setError(String(cause)))
  }
  useEffect(() => {
    if (!active || closing) {
      const queryRevision = searchQuery.current.revision
      if (closing) {
        setFindOpen(false)
        searchQuery.current = { revision: searchQuery.current.revision + 1, signature: '' }
      }
      if (findTimer.current) clearTimeout(findTimer.current)
      highlight.current = null
      setSearchResult(null)
      const viewId = view.current
      if (viewId) void ipcApi.request('terminal.search.close', { viewId, queryRevision }).catch(() => {})
      return
    }
    if (viewReady && findOpen) void flushFind().catch((cause) => setError(String(cause)))
  }, [active, closing, viewReady, findOpen, flushFind])
  const navigateFind = async (direction: 'next' | 'previous') => {
    const result = await flushFind(),
      viewId = view.current
    if (!viewId || !result) return
    const next = await ipcApi.request('terminal.search.navigate', {
      viewId,
      queryRevision: result.queryRevision,
      resultRevision: result.resultRevision,
      direction
    })
    if (!next || view.current !== viewId || next.queryRevision !== searchQuery.current.revision) return
    highlight.current = next
    setSearchResult(next)
    const target = next.selected?.range?.start
    if (target && sourceFrame.current) {
      const containing = blocks.current.find(
        (block) => block.output && block.end && target.y >= block.output.y && target.y < block.end.y
      )
      if (containing && collapsedRef.current.includes(containing.id)) toggleBlock(containing)
      const nextLayout = terminalBlockLayout(
        blocks.current,
        collapsedRef.current,
        sourceFrame.current.sourceTotal ?? 0,
        sourceFrame.current.snapshot.rows,
        0,
        sourceFrame.current.sourceContentEnd
      )
      const coveredRows = Math.ceil((findBar.current?.getBoundingClientRect().height ?? 0) / metrics.current.height) + 1
      offset.current = terminalOffsetForSource(nextLayout, Math.max(0, target.y - coveredRows))
      force.current = true
    }
    schedule()
  }
  const blockAction = async (block: TerminalBlockSummary, action: TerminalBlockAction) => {
    const viewId = view.current
    if (!viewId) return
    try {
      if (action === 'find') {
        openFind(block)
        return
      }
      if (action === 'rerun') {
        const facts = current.current.shellFacts,
          editor = current.current.editor
        if (!canRun || facts?.kind !== 'prompt' || editor?.kind !== 'empty') throw new Error(t('terminal.blocks.busy'))
        await send({
          kind: 'rerun',
          blockId: block.id,
          contentRevision: block.contentRevision,
          promptRevision: facts.revision,
          draftRevision: editor.revision
        })
        return
      }
      if (action === 'select') {
        semanticSelection.current = { blockId: block.id, contentRevision: block.contentRevision }
        presentation.selection = semanticSelection.current
        if (collapsedRef.current.includes(block.id)) toggleBlock(block)
        const frame = sourceFrame.current
        if (!block.prompt || !block.end || !frame) return
        const layout = terminalBlockLayout(
          blocks.current,
          collapsedRef.current,
          frame.sourceTotal ?? 0,
          frame.snapshot.rows,
          0,
          frame.sourceContentEnd
        )
        offset.current = terminalOffsetForSource(layout, block.prompt.y)
        // A semantic selection is installed only after its matching projected frame arrives.
        pendingSelection.current = { blockId: block.id, revision: block.contentRevision }
        return
      }
      const capture = async (signal?: AbortSignal) => {
        if (signal?.aborted) throw new Error(t('terminal.blocks.unavailable'))
        const read = await ipcApi.request('terminal.blocks.read', {
          viewId,
          blockId: block.id,
          part: action === 'copy_command' ? 'command' : action === 'copy_output' ? 'output' : 'block',
          consistency: { kind: 'latest' }
        })
        if (read.kind !== 'content' || signal?.aborted) throw new Error(t('terminal.blocks.unavailable'))
        if (read.partial.length) setError(t('terminal.blocks.partial'))
        return read.text
      }
      if (action === 'attach') {
        const result = await attachGeneratedText({
          intentId: crypto.randomUUID(),
          topicId: buildAgentSessionTopicId(current.current.host.conversationId),
          name: t('terminal.blocks.attachment_name'),
          capture
        })
        if (result.kind !== 'attached' && result.kind !== 'cancelled') throw new Error(t('terminal.blocks.unavailable'))
      } else await navigator.clipboard.writeText(await capture())
    } catch (cause) {
      setError(String(cause))
    }
  }
  const menuActions: TerminalMenuAction[] = [
    ...(acceptsActions() && (!controlled || agentConnected)
      ? [
          {
            label: t(controlled ? 'terminal.return_control' : 'terminal.take_control'),
            disabled: !acceptsActions() || controlPending || takeControlOnAttach,
            onSelect: () => void send({ kind: controlled ? 'return-control' : 'take-control' })
          }
        ]
      : []),
    { label: t('terminal.copy'), onSelect: copy },
    { label: t('terminal.blocks.find'), onSelect: () => openFind() },
    {
      label: t('terminal.interrupt'),
      disabled: !canInput,
      onSelect: () =>
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
    },
    {
      label: t(resource.cleanup === 'unconfirmed' ? 'terminal.retry_close' : 'terminal.close'),
      disabled: closing,
      onSelect: onClose
    }
  ]
  const contextMenuActions = [...menuActions]
  const chosenBlock = blocks.current.find((block) => block.id === contextBlock)
  if (chosenBlock)
    contextMenuActions.push(
      ...terminalBlockActions(chosenBlock, canRun).map(({ action, disabled }) => ({
        label: terminalBlockActionLabels(t)[action],
        disabled,
        onSelect: () => void blockAction(chosenBlock, action)
      }))
    )
  const contextAt = (event: React.MouseEvent) => {
    const id =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-terminal-block]')?.dataset.terminalBlock
        : null
    const source = projected.current ? terminalSourceAt(projected.current, point(event).y) : null
    setContextBlock(
      id ??
        blocks.current.find(
          (block) => block.prompt && block.end && source !== null && source >= block.prompt.y && source <= block.end.y
        )?.id ??
        null
    )
  }
  const restoreInputFocus = (event: Event) => {
    event.preventDefault()
    if (active) input.current?.focus({ preventScroll: true })
  }
  return {
    findBar,
    root,
    canvas,
    overlay,
    input,
    snapshot,
    epoch,
    current,
    focus,
    composing,
    printable,
    suppressInput,
    view,
    viewRevision,
    metrics,
    layout,
    selection,
    semanticSelection,
    presentation,
    mousePress,
    offset,
    error,
    viewError,
    accessible,
    composition,
    inputValue,
    focused,
    canInput,
    controlled,
    menuActions,
    contextMenuActions,
    contextAt,
    restoreInputFocus,
    copy,
    controls,
    collapsed,
    canRun,
    toggleBlock,
    blockAction,
    findOpen,
    find,
    searchResult,
    changeFind,
    openFind,
    closeFind,
    navigateFind,
    acceptsActions,
    point,
    extendSelection,
    mouse,
    schedule,
    send,
    setInputValue,
    setFocused,
    setComposition,
    setError
  }
}
