import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  terminalFindReveal,
  terminalBlockSourceRows,
  terminalBlockNavigation,
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
  resizeSuspended?: boolean
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
  resizeSuspended = false,
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
  const scrollViewport = useRef<HTMLDivElement>(null)
  const chrome = useRef<HTMLDivElement>(null)
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
  const expandedBlocks = useMemo(() => (presentation.expandedBlocks ??= new Set<string>()), [presentation])
  const expansionRevision = useRef(0)
  const rememberExpansion = useCallback(
    (id: string) => {
      if (expandedBlocks.has(id)) return false
      expandedBlocks.add(id)
      expansionRevision.current++
      return true
    },
    [expandedBlocks]
  )
  const offset = useRef(presentation.offset)
  const blocks = useRef<TerminalBlockSummary[]>([])
  const sourceFrame = useRef<TerminalViewFrame | null>(null)
  const projected = useRef<TerminalBlockLayout | null>(null)
  const layoutSequence = useRef(0)
  const [context, setContext] = useState<
    { kind: 'terminal' } | { kind: 'block'; id: string } | { kind: 'selection'; text: string }
  >({ kind: 'terminal' })
  const [controls, setControls] = useState<{ layout: TerminalBlockLayout; height: number } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const findPadding = useRef(0)
  const findVisible = useRef(false)
  const [find, setFind] = useState(presentation.find)
  const findRef = useRef(find)
  findRef.current = find
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const currentBlock = useRef<string | null>(null)
  const hiddenHeader = useCallback(
    () => (findVisible.current && findRef.current.scope === 'block' ? findRef.current.blockId : null),
    []
  )
  const controlBlocks = useCallback(
    (values: TerminalBlockSummary[]) => values.filter((block) => block.id !== hiddenHeader()),
    [hiddenHeader]
  )
  const projectedHeader = useRef<string | null>(null)
  const [searchResult, setSearchResult] = useState<TerminalSearchProjection | null>(null)
  const searchQuery = useRef({ revision: 0, signature: '' })
  const findTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const highlight = useRef<TerminalSearchProjection | null>(null)
  const metrics = useRef<GhosttyCellMetrics>({ width: 8, height: 19, baseline: 15 })
  const font = useRef('monospace')
  const theme = useRef<GhosttyTheme | undefined>(undefined)
  const currentMatchColor = useRef('transparent')
  const blockSelectionColor = useRef<CanvasRenderingContext2D['fillStyle']>('transparent')
  const layout = useRef<GhosttyKeyboardLayoutMap | undefined>(undefined)
  const selection = useRef<Selection | null>(null)
  const semanticSelection = useRef(presentation.selection)
  const mousePress = useRef<Promise<boolean> | null>(null)
  const draw = useRef<number | null>(null)
  const refreshView = useRef<(() => void) | null>(null)
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
  const [scrollGeometry, setScrollGeometry] = useState({
    width: 0,
    height: 0,
    contentWidth: 0,
    contentHeight: 0,
    maxOffset: 0,
    offset: 0
  })
  const scrollRange = useRef(0)
  const visibleRows = useCallback(
    (rows: number) =>
      viewport.current
        ? Math.min(rows, Math.max(1, Math.floor((viewport.current.height - 16) / metrics.current.height)))
        : rows,
    []
  )
  const findPaddingRows = useCallback(
    (rows: number) => Math.min(Math.max(0, visibleRows(rows) - 1), findVisible.current ? findPadding.current : 0),
    [visibleRows]
  )

  useLayoutEffect(() => {
    const element = scrollViewport.current
    if (!element || offset.current !== scrollGeometry.offset) return
    const top = (scrollGeometry.maxOffset - scrollGeometry.offset) * metrics.current.height
    if (Math.round(element.scrollTop / metrics.current.height) !== Math.round(top / metrics.current.height))
      element.scrollTop = top
  }, [scrollGeometry])

  const paint = useCallback(() => {
    draw.current = null
    const screen = snapshot.current
    const content = canvas.current?.getContext('2d')
    const cursor = overlay.current?.getContext('2d')
    const bounds = viewport.current
    if (!screen || !content || !cursor || !bounds) return
    const frame = sourceFrame.current
    const projection = projected.current
    const width = Math.max(bounds.width, screen.cols * metrics.current.width + 16)
    const height = frame?.alternate ? Math.max(bounds.height, screen.rows * metrics.current.height + 16) : bounds.height
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
      surface.style.transform = frame?.alternate ? `translateY(-${scrollViewport.current?.scrollTop ?? 0}px)` : ''
    }
    renderGhosttySnapshot({
      context: content,
      snapshot: { ...screen, cursorVisible: false, dirtyRows: dirty.current },
      metrics: metrics.current,
      fontSize: 14,
      fontFamily: font.current,
      padding: 8,
      originY: 0,
      forceFull: force.current,
      cursorOn: false
    })
    cursor.clearRect(0, 0, cursor.canvas.width, cursor.canvas.height)
    const activeBlock = findVisible.current && findRef.current.scope === 'block' ? findRef.current.blockId : null
    const block = !frame?.alternate && blocks.current.find((block) => block.id === activeBlock)
    const blockRows = block && terminalBlockSourceRows(block, frame?.sourceContentEnd ?? 0)
    if (blockRows && projection) {
      const first = terminalVisualAt(projection, { x: 0, y: blockRows.start })
      const last = terminalVisualAt(projection, { x: 0, y: blockRows.end - 1 })
      if (first !== null && last !== null) {
        const top = Math.max(0, first),
          bottom = Math.min(screen.rows, last + 1)
        if (bottom > top) {
          cursor.fillStyle = blockSelectionColor.current
          cursor.fillRect(0, top * metrics.current.height, width, (bottom - top) * metrics.current.height)
        }
      }
    }
    renderGhosttyCursor({
      context: cursor,
      snapshot: screen,
      metrics: metrics.current,
      fontSize: 14,
      fontFamily: font.current,
      padding: 8,
      originY: 0,
      cursorOn: cursorOn.current || !screen.cursorBlinking || !focus.current,
      focused: focus.current
    })
    if (projection && theme.current) {
      const { r, g, b } = theme.current.foreground
      cursor.fillStyle = `rgba(${r},${g},${b},0.16)`
      for (let row = 0; row < screen.rows; row++) {
        const source = terminalSourceAt(projection, row)
        if (
          source !== null &&
          blocks.current.some(
            (block) =>
              block.reliable &&
              block.output?.x === 0 &&
              block.end?.x === 0 &&
              source >= block.output.y &&
              source < block.end.y
          )
        )
          cursor.fillRect(3, row * metrics.current.height, 1, metrics.current.height)
      }
    }
    if (highlight.current) {
      cursor.save()
      const paintMatch = (match: TerminalSearchProjection['matches'][number], selected: boolean) => {
        const first = projection
            ? terminalVisualAt(projection, match.start)
            : match.start.y - (sourceFrame.current?.sourceOrigin ?? 0),
          last = projection
            ? terminalVisualAt(projection, match.end)
            : match.end.y - (sourceFrame.current?.sourceOrigin ?? 0)
        if (first === null || last === null) return
        cursor.fillStyle = selected ? currentMatchColor.current : 'rgba(234,179,8,0.22)'
        for (let y = Math.max(0, first); y <= Math.min(screen.rows - 1, last); y++) {
          if (projection && terminalSourceAt(projection, y) === null) continue
          const left = 8 + (y === first ? match.start.x : 0) * metrics.current.width
          const top = y * metrics.current.height
          const width =
            ((y === last ? match.end.x + 1 : screen.cols) - (y === first ? match.start.x : 0)) * metrics.current.width
          cursor.fillRect(left, top, width, metrics.current.height)
          if (selected) {
            const { r, g, b } = screen.foreground
            cursor.strokeStyle = `rgb(${r},${g},${b})`
            cursor.lineWidth = 2
            cursor.strokeRect(left + 1, top + 1, width - 2, metrics.current.height - 2)
          }
        }
      }
      for (const match of highlight.current.matches) paintMatch(match, false)
      if (highlight.current.selected?.range) paintMatch(highlight.current.selected.range, true)
      cursor.restore()
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
          row * metrics.current.height,
          (right - left) * metrics.current.width,
          metrics.current.height
        )
      }
    }
    if (input.current) {
      input.current.style.left = `${8 + Math.max(0, screen.cursorX) * metrics.current.width}px`
      input.current.style.top = `${Math.max(0, screen.cursorY) * metrics.current.height - (frame?.alternate ? (scrollViewport.current?.scrollTop ?? 0) : 0)}px`
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
          refreshView.current?.()
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
    let refreshAnimation: number | undefined
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
        let receivedFrame = sourceFrame.current
        let receivedSnapshot = snapshot.current
        let receivedBlocks = [...blocks.current]
        let refreshBlocks = false
        let updating = false
        let refreshRequested = false
        const refresh = () => {
          refreshRequested = true
          if (timer) clearTimeout(timer)
          if (updating || refreshAnimation !== undefined) return
          refreshAnimation = requestAnimationFrame(() => {
            refreshAnimation = undefined
            void update()
          })
        }
        const update = async () => {
          if (stopped || !attached || updating) return
          updating = true
          refreshRequested = false
          const viewportOffset = offset.current
          const omittedHeader = hiddenHeader()
          const requestedExpansion = expansionRevision.current
          const origin = receivedFrame
          const leadingRows = findPaddingRows(origin?.snapshot.rows ?? 1)
          const requestedLayout =
            origin &&
            !origin.alternate &&
            (leadingRows || receivedBlocks.length || visibleRows(origin.snapshot.rows) < origin.snapshot.rows)
              ? terminalBlockLayout(
                  controlBlocks(receivedBlocks),
                  origin.sourceTotal ?? 0,
                  visibleRows(origin.snapshot.rows),
                  viewportOffset,
                  origin.sourceContentEnd,
                  origin.snapshot.rows,
                  leadingRows,
                  expandedBlocks
                )
              : null
          const layoutToken = ++layoutSequence.current
          const requestedControlEpoch = controlEpoch.current
          let rowStart = 0
          let next = receivedSnapshot
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
                receivedSnapshot = next
                const previousSource = receivedFrame
                receivedFrame = frame
                if (frame.blocks) {
                  receivedBlocks = [...receivedBlocks]
                  for (const block of frame.blocks) {
                    const previous = receivedBlocks.findIndex((value) => value.id === block.id)
                    if (previous >= 0) receivedBlocks[previous] = block
                  }
                }
                if (
                  !frame.alternate &&
                  (refreshBlocks ||
                    frame.nativeRevision !== previousSource?.nativeRevision ||
                    frame.blockIndexRevision !== previousSource?.blockIndexRevision)
                ) {
                  refreshBlocks = true
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
                    receivedBlocks = updated
                    refreshBlocks = false
                    for (const id of expandedBlocks)
                      if (!updated.some((block) => block.id === id)) {
                        expandedBlocks.delete(id)
                        expansionRevision.current++
                      }
                  }
                }
                // A rejected row projection is a new source baseline, not a displayable layout.
                const hasProjection = requestedLayout !== null && frame.layoutRevision === layoutToken
                if (epoch.current !== frame.geometryEpoch) findPadding.current = 0
                const needsProjection =
                  Boolean(findPaddingRows(frame.snapshot.rows) || receivedBlocks.length) ||
                  visibleRows(frame.snapshot.rows) < frame.snapshot.rows
                if (
                  omittedHeader !== hiddenHeader() ||
                  requestedExpansion !== expansionRevision.current ||
                  leadingRows !== findPaddingRows(frame.snapshot.rows) ||
                  (!frame.alternate && (refreshBlocks || needsProjection !== hasProjection))
                ) {
                  revision = frame.revision
                  refreshRequested = true
                  return
                }
                sourceFrame.current = frame
                blocks.current = receivedBlocks
                if (epoch.current !== frame.geometryEpoch) {
                  selection.current = null
                  force.current = true
                }
                const nextLayout = !frame.alternate && hasProjection ? requestedLayout : null
                if (
                  projected.current?.top !== nextLayout?.top ||
                  projected.current?.total !== nextLayout?.total ||
                  projectedHeader.current !== omittedHeader
                ) {
                  selection.current = null
                  force.current = true
                }
                projected.current = nextLayout
                projectedHeader.current = omittedHeader
                setControls(nextLayout ? { layout: nextLayout, height: metrics.current.height } : null)
                if (offset.current === viewportOffset)
                  offset.current = nextLayout ? nextLayout.total - nextLayout.rows - nextLayout.top : frame.scrollOffset
                presentation.offset = offset.current
                if (frame.search?.queryRevision === searchQuery.current.revision) {
                  highlight.current = frame.search
                  setSearchResult(frame.search)
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
                const bounds = viewport.current
                if (bounds) {
                  const maxOffset = nextLayout
                    ? nextLayout.total - nextLayout.rows
                    : Math.max(0, (frame.sourceTotal ?? next.rows) - next.rows)
                  scrollRange.current = frame.alternate ? 0 : maxOffset
                  const committedOffset = nextLayout ? maxOffset - nextLayout.top : frame.scrollOffset
                  const geometry = {
                    width: bounds.width,
                    height: bounds.height,
                    contentWidth: Math.max(bounds.width, next.cols * metrics.current.width + 16),
                    contentHeight: frame.alternate
                      ? Math.max(bounds.height, next.rows * metrics.current.height + 16)
                      : bounds.height + maxOffset * metrics.current.height,
                    maxOffset: scrollRange.current,
                    offset: committedOffset
                  }
                  setScrollGeometry((previous) =>
                    previous.width === geometry.width &&
                    previous.height === geometry.height &&
                    previous.contentWidth === geometry.contentWidth &&
                    previous.contentHeight === geometry.contentHeight &&
                    previous.maxOffset === geometry.maxOffset &&
                    previous.offset === geometry.offset
                      ? previous
                      : geometry
                  )
                }
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
          } finally {
            updating = false
            if (!stopped) {
              if (refreshRequested) refresh()
              else timer = setTimeout(() => void update(), 100)
            }
          }
        }
        refreshView.current = refresh
        void update()
      } catch (cause) {
        if (!stopped) setViewError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void pull()
    return () => {
      stopped = true
      refreshView.current = null
      view.current = null
      setViewReady(false)
      setGeometryReady(false)
      composing.current = null
      if (timer) clearTimeout(timer)
      if (refreshAnimation !== undefined) cancelAnimationFrame(refreshAnimation)
      if (attached) void ipcApi.request('terminal.detach', { viewId: attached }).catch(() => {})
      if (draw.current !== null) {
        cancelAnimationFrame(draw.current)
        draw.current = null
      }
    }
  }, [
    active,
    resource.id,
    resource.host.generation,
    schedule,
    send,
    t,
    presentation,
    expandedBlocks,
    visibleRows,
    controlBlocks,
    hiddenHeader,
    findPaddingRows
  ])

  useEffect(() => {
    if (!active || !root.current || !scrollViewport.current) return
    const measure = () => {
      const element = root.current
      const context = canvas.current?.getContext('2d')
      const rect = viewport.current
      if (!element || !context || !rect) return
      const style = getComputedStyle(element)
      font.current = style.fontFamily
      metrics.current = measureGhosttyCell(context, 14, font.current)
      setScrollGeometry((previous) => ({ ...previous, width: rect.width, height: rect.height }))
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
      const { r, g, b } = color(style.getPropertyValue('--highlight-accent'))
      currentMatchColor.current = `rgba(${r},${g},${b},0.35)`
      color(style.getPropertyValue('--cherry-code-selection'))
      blockSelectionColor.current = swatch.fillStyle
      force.current = true
      schedule()
      refreshView.current?.()
      if (
        !resizeSuspended &&
        acceptsActions() &&
        controlling &&
        current.current.control.kind === 'user' &&
        view.current
      ) {
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
    observer.observe(scrollViewport.current)
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
  }, [
    active,
    resizeSuspended,
    resource.control.kind,
    resource.geometryEpoch,
    controlling,
    viewReady,
    schedule,
    send,
    acceptsActions
  ])

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
          Math.floor(
            (event.clientY -
              rect.top +
              (sourceFrame.current?.alternate ? (scrollViewport.current?.scrollTop ?? 0) : 0)) /
              metrics.current.height
          )
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
          const pan = sourceFrame.current?.alternate ? (scrollViewport.current?.scrollTop ?? 0) : 0
          const visual = Math.floor((event.clientY - rect.top + pan) / metrics.current.height)
          const source = projected.current ? terminalSourceAt(projected.current, visual) : null
          return source === null
            ? Math.max(0, event.clientY - rect.top + pan)
            : (source - ((sourceFrame.current?.sourceTotal ?? 0) - (snapshot.current?.rows ?? 0))) *
                metrics.current.height
        })(),
        screenWidth: Math.max(rect.width, (snapshot.current?.cols ?? 1) * metrics.current.width + 16),
        screenHeight: Math.max(rect.height, (snapshot.current?.rows ?? 1) * metrics.current.height + 16),
        cellWidth: metrics.current.width,
        cellHeight: metrics.current.height,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 0,
        paddingBottom: 16,
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
    (terminalSourceAt(projected.current, point(event).y) === null || mouseData(event, action).y < 0)
      ? Promise.resolve(false)
      : send({ kind: 'mouse', geometryEpoch: epoch.current, event: mouseData(event, action) }, undefined, acceptedPress)
  const onScroll = useCallback(() => {
    const element = scrollViewport.current
    if (!element) return
    if (chrome.current) chrome.current.style.left = `${element.scrollLeft}px`
    if (sourceFrame.current?.alternate) {
      schedule()
      return
    }
    const next = Math.max(0, scrollRange.current - Math.round(element.scrollTop / metrics.current.height))
    if (next === offset.current) return
    offset.current = next
    presentation.offset = next
    selection.current = null
    force.current = true
    refreshView.current?.()
  }, [presentation, schedule])
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
        const scroller = scrollViewport.current
        if (!scroller) return
        const maxTop = sourceFrame.current?.alternate
          ? Math.max(0, (snapshot.current?.rows ?? 0) * metrics.current.height + 16 - (viewport.current?.height ?? 0))
          : scrollRange.current * metrics.current.height
        scroller.scrollTop = Math.max(0, Math.min(maxTop, scroller.scrollTop + rows * metrics.current.height))
        onScroll()
      }
      const data = mouseData(event, 'press')
      const visual = Math.floor((event.clientY - element.getBoundingClientRect().top) / metrics.current.height)
      const source = !projected.current || terminalSourceAt(projected.current, visual) !== null
      if (
        controlling &&
        geometryReady &&
        current.current.control.kind === 'user' &&
        offset.current === 0 &&
        source &&
        data.y >= 0 &&
        !event.shiftKey
      )
        void send({ kind: 'wheel', rows, geometryEpoch: epoch.current, event: data }).then((handled) => {
          if (!handled) scroll()
        })
      else scroll()
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [active, controlling, geometryReady, mouseData, send, onScroll])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      cursorOn.current = !cursorOn.current
      schedule()
    }, 500)
    return () => clearInterval(timer)
  }, [active, schedule])
  const selectedText = () => {
    const screen = snapshot.current
    const range = selection.current
    if (!screen || !range) return null
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
    return text
  }
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
    const text = selectedText()
    if (text !== null) void navigator.clipboard.writeText(text).catch((cause: unknown) => setError(String(cause)))
  }
  const controlled = acceptsActions() && controlling && resource.control.kind === 'user'
  const canInput = controlled && geometryReady && !resizeSuspended
  const canRun =
    canInput &&
    current.current.editor?.kind === 'empty' &&
    current.current.shellFacts?.kind === 'prompt' &&
    !queued.current &&
    !composing.current
  const closeFind = () => {
    findVisible.current = false
    findPadding.current = 0
    setFindOpen(false)
    if (findTimer.current) clearTimeout(findTimer.current)
    const viewId = view.current,
      queryRevision = searchQuery.current.revision
    searchQuery.current = { revision: queryRevision + 1, signature: '' }
    if (viewId) void ipcApi.request('terminal.search.close', { viewId, queryRevision }).catch(() => {})
    highlight.current = null
    setSearchResult(null)
    refreshView.current?.()
    schedule()
    if (active) input.current?.focus({ preventScroll: true })
  }
  const flushFind = useCallback(async () => {
    if (findTimer.current) clearTimeout(findTimer.current)
    const state = findRef.current,
      viewId = view.current
    if (!viewId) return null
    const scope =
      state.scope === 'block' ? { kind: 'block' as const, blockId: state.blockId } : { kind: 'terminal' as const }
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
  const changeFind = (needle: string) => {
    if (findPadding.current) {
      findPadding.current = 0
      refreshView.current?.()
    }
    const next = { ...findRef.current, needle }
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
  const focusFind = () => {
    const field = findBar.current?.querySelector('input')
    field?.focus()
    field?.select()
  }
  const openFind = ({
    block,
    needle = findRef.current.needle
  }: { block?: TerminalBlockSummary; needle?: string } = {}) => {
    const next: TerminalPresentation['find'] = block
      ? { needle, scope: 'block', blockId: block.id }
      : { needle, scope: 'terminal' }
    findRef.current = next
    if (block) {
      rememberExpansion(block.id)
      currentBlock.current = block.id
      setCurrentBlockId(block.id)
    }
    findVisible.current = true
    changeFind(next.needle)
    setFindOpen(true)
    refreshView.current?.()
    schedule()
    focusFind()
  }
  const selectBlock = (block: TerminalBlockSummary) => {
    if (findVisible.current && findRef.current.scope === 'block') openFind({ block })
    else {
      currentBlock.current = block.id
      setCurrentBlockId(block.id)
      schedule()
    }
  }
  const selectBlockAt = (row: number) => {
    const frame = sourceFrame.current
    if (!frame || frame.alternate) return
    const source = projected.current ? terminalSourceAt(projected.current, row) : (frame.sourceOrigin ?? 0) + row
    const block = blocks.current.find((block) => {
      const range = terminalBlockSourceRows(block, frame.sourceContentEnd ?? 0)
      return range && source !== null && source >= range.start && source < range.end
    })
    if (block) selectBlock(block)
  }
  const toggleFindScope = () => {
    if (findRef.current.scope === 'block') openFind()
    else {
      const block = blocks.current.find((block) => block.id === currentBlock.current)
      if (block) openFind({ block })
    }
  }
  const showMore = (block: TerminalBlockSummary) => {
    const frame = sourceFrame.current,
      previous = projected.current,
      target = blocks.current.find((value) => value.id === block.id)
    if (!frame || frame.alternate || !previous || !target || !rememberExpansion(target.id)) return
    const anchor = terminalVisibleSpans(previous)[0]
    const next = terminalBlockLayout(
      controlBlocks(blocks.current),
      frame.sourceTotal ?? 0,
      visibleRows(frame.snapshot.rows),
      offset.current,
      frame.sourceContentEnd,
      frame.snapshot.rows,
      findPaddingRows(frame.snapshot.rows),
      expandedBlocks
    )
    offset.current = anchor ? terminalOffsetForSource(next, anchor.sourceStart, anchor.targetStart) : 0
    presentation.offset = offset.current
    selection.current = null
    force.current = true
    refreshView.current?.()
    if (findBar.current) focusFind()
    else input.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!active || closing) {
      const queryRevision = searchQuery.current.revision
      if (closing) {
        findVisible.current = false
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
    const target = next.selected?.range,
      frame = sourceFrame.current,
      bar = findBar.current?.getBoundingClientRect(),
      bounds = canvas.current?.getBoundingClientRect()
    if (target && frame && bar && bounds && !frame.alternate) {
      const block = blocks.current.find((value) => {
        const rows = terminalBlockSourceRows(value, frame.sourceContentEnd ?? 0)
        return rows && target.start.y >= rows.start && target.start.y < rows.end
      })
      if (
        block &&
        projected.current?.runs.some(
          (run) =>
            run.kind === 'fold' &&
            run.block.id === block.id &&
            target.start.y < run.sourceStart + run.sourceCount &&
            target.end.y >= run.sourceStart
        )
      )
        rememberExpansion(block.id)
      const nextLayout = terminalBlockLayout(
        controlBlocks(blocks.current),
        frame.sourceTotal ?? 0,
        visibleRows(frame.snapshot.rows),
        offset.current,
        frame.sourceContentEnd,
        frame.snapshot.rows,
        0,
        expandedBlocks
      )
      const header = nextLayout.runs.find((run) => {
        if (run.kind !== 'controls') return false
        const rows = terminalBlockSourceRows(run.block, frame.sourceContentEnd ?? 0)
        return rows && target.start.y >= rows.start && target.start.y < rows.end
      })
      const revealed = terminalFindReveal({
        layout: nextLayout,
        range: target,
        cols: frame.snapshot.cols,
        cell: metrics.current,
        obstruction: {
          left: bar.left - bounds.left - 8,
          right: bar.right - bounds.left - 8,
          top: bar.top - bounds.top,
          bottom: bar.bottom - bounds.top
        },
        headerRows: header?.count ?? 0
      })
      findPadding.current = revealed.leadingRows
      offset.current = revealed.offset
      force.current = true
      refreshView.current?.()
    }
    schedule()
  }
  const readBlock = async (block: TerminalBlockSummary, part: 'command' | 'output' | 'block', signal?: AbortSignal) => {
    const viewId = view.current
    if (!viewId || signal?.aborted) throw new Error(t('terminal.blocks.unavailable'))
    const read = await ipcApi.request('terminal.blocks.read', {
      viewId,
      blockId: block.id,
      part,
      consistency: { kind: 'latest' }
    })
    if (read.kind !== 'content' || signal?.aborted) throw new Error(t('terminal.blocks.unavailable'))
    if (read.partial.length) setError(t('terminal.blocks.partial'))
    return read.text
  }
  const navigationForBlock = (block: TerminalBlockSummary) => {
    const frame = sourceFrame.current,
      layout = projected.current
    return frame && !frame.alternate && layout
      ? terminalBlockNavigation(layout, blocks.current, block.id, frame.sourceContentEnd ?? 0)
      : null
  }
  const blockAction = async (block: TerminalBlockSummary, action: TerminalBlockAction) => {
    const viewId = view.current
    if (!viewId) return
    try {
      if (
        action === 'scroll_top' ||
        action === 'scroll_bottom' ||
        action === 'previous_block' ||
        action === 'next_block'
      ) {
        const target = navigationForBlock(block)?.[action]
        if (target == null) return
        offset.current = target
        presentation.offset = target
        selection.current = null
        force.current = true
        refreshView.current?.()
        return
      }
      if (action === 'find') {
        openFind({ block })
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
        selectBlock(block)
        rememberExpansion(block.id)
        semanticSelection.current = { blockId: block.id, contentRevision: block.contentRevision }
        presentation.selection = semanticSelection.current
        const frame = sourceFrame.current
        if (!block.prompt || !block.end || !frame) return
        const layout = terminalBlockLayout(
          controlBlocks(blocks.current),
          frame.sourceTotal ?? 0,
          visibleRows(frame.snapshot.rows),
          0,
          frame.sourceContentEnd,
          frame.snapshot.rows,
          findPaddingRows(frame.snapshot.rows),
          expandedBlocks
        )
        offset.current = terminalOffsetForSource(layout, block.prompt.y)
        // A semantic selection is installed only after its matching projected frame arrives.
        pendingSelection.current = { blockId: block.id, revision: block.contentRevision }
        refreshView.current?.()
        return
      }
      const capture = (signal?: AbortSignal) =>
        readBlock(block, action === 'copy_command' ? 'command' : action === 'copy_output' ? 'output' : 'block', signal)
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
  const chosenBlock = context.kind === 'block' ? blocks.current.find((block) => block.id === context.id) : null
  const contextMenuActions: TerminalMenuAction[] =
    context.kind === 'selection'
      ? [
          {
            label: t('terminal.copy'),
            onSelect: () =>
              void navigator.clipboard.writeText(context.text).catch((cause: unknown) => setError(String(cause)))
          },
          {
            label: t('terminal.blocks.find'),
            onSelect: () => openFind({ needle: context.text })
          }
        ]
      : chosenBlock
        ? terminalBlockActions(chosenBlock, canRun, navigationForBlock(chosenBlock)).map(
            ({ action, disabled, separator }) => ({
              label: terminalBlockActionLabels(t)[action],
              disabled,
              separator,
              onSelect: () => void blockAction(chosenBlock, action)
            })
          )
        : menuActions
  const contextAt = (event: React.MouseEvent) => {
    const id =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-terminal-block]')?.dataset.terminalBlock
        : null
    const text = id ? null : selectedText()
    if (text) {
      setContext({ kind: 'selection', text })
      return
    }
    const source = projected.current ? terminalSourceAt(projected.current, point(event).y) : null
    const blockId =
      id ??
      blocks.current.find(
        (block) => block.prompt && block.end && source !== null && source >= block.prompt.y && source <= block.end.y
      )?.id
    setContext(blockId ? { kind: 'block', id: blockId } : { kind: 'terminal' })
  }
  const restoreInputFocus = (event: Event) => {
    event.preventDefault()
    if (active) {
      if (findBar.current) focusFind()
      else input.current?.focus({ preventScroll: true })
    }
  }
  return {
    scrollViewport,
    chrome,
    scrollGeometry,
    onScroll,
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
    contextScope: context.kind === 'terminal' ? ('terminal' as const) : ('content' as const),
    contextAt,
    restoreInputFocus,
    copy,
    controls,
    canRun,
    navigationForBlock,
    showMore,
    readBlock,
    blockAction,
    selectBlock,
    selectBlockAt,
    findOpen,
    find,
    findBlock:
      blocks.current.find((block) => block.id === (find.scope === 'block' ? find.blockId : currentBlockId)) ?? null,
    focusFind,
    searchResult,
    changeFind,
    openFind,
    toggleFindScope,
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
