import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ScrollArea, Textarea } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'

import { ghosttyKeyForEvent, ghosttyConsumedMods, ghosttyUnshiftedCodepoint } from './keyCodes'
import { TerminalBlockControls } from './TerminalBlockControls'
import { TerminalContextMenu, TerminalDropdownMenu } from './TerminalContextMenu'
import { TerminalFindBar } from './TerminalFindBar'
import { useTerminalView, type TerminalViewProps } from './useTerminalView'
const mods = (event: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }) =>
  Number(event.shiftKey) | (Number(event.ctrlKey) << 1) | (Number(event.altKey) << 2) | (Number(event.metaKey) << 3)
const textKey = (text: string) => ({
  kind: 'key' as const,
  event: { key: 0, mods: 0, consumedMods: 0, composing: false, unshiftedCodepoint: 0, text, repeat: false }
})
export function TerminalCanvas(props: TerminalViewProps) {
  const { resource, renderHeader, onClose, closing = false } = props
  const { t } = useTranslation()
  const {
    root,
    scrollViewport,
    chrome,
    scrollGeometry,
    onScroll,
    canvas,
    overlay,
    input,
    findBar,
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
    menuActions,
    contextMenuActions,
    contextScope,
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
    findBlock,
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
  } = useTerminalView(props)
  const blockClick = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {renderHeader?.(<TerminalDropdownMenu actions={menuActions} onCloseAutoFocus={restoreInputFocus} />)}
      {(resource.cleanup === 'unconfirmed' || resource.process.kind === 'lost') && (
        <div role="alert" className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-warning">
          <span className="flex-1">{t('terminal.cleanup.protected')}</span>
          <Button size="sm" variant="outline" disabled={closing} onClick={onClose}>
            {t('terminal.retry_close')}
          </Button>
        </div>
      )}
      {(error || viewError) && (
        <div role="alert" className="px-3 py-2 text-xs text-destructive">
          {error || viewError}
        </div>
      )}
      <TerminalContextMenu onCloseAutoFocus={restoreInputFocus} actions={contextMenuActions} scope={contextScope}>
        <ScrollArea
          orientation="both"
          type="auto"
          className="min-h-0 flex-1 [&>[data-slot=scroll-area-scrollbar]]:z-40"
          onPointerUp={(event) => {
            if (
              event.button === 0 &&
              event.target instanceof Element &&
              event.target.closest('[data-slot="scroll-area-scrollbar"]')
            )
              input.current?.focus({ preventScroll: true })
          }}
          onKeyDownCapture={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
              event.preventDefault()
              event.stopPropagation()
              openFind()
            }
          }}
          viewportProps={{ ref: scrollViewport, onScroll, tabIndex: -1 }}
          contentProps={{
            style: {
              display: 'block',
              width: scrollGeometry.contentWidth || '100%',
              height: scrollGeometry.contentHeight || '100%'
            }
          }}>
          <div
            ref={root}
            role="region"
            aria-label={t('terminal.title')}
            className="sticky top-0 min-h-0 overflow-clip bg-[oklch(from_var(--background)_l_c_h_/_1)] text-foreground"
            style={{ fontFamily: 'var(--code-font-family)', height: scrollGeometry.height || '100%' }}
            onContextMenuCapture={contextAt}
            onPointerDown={(event) => {
              if (event.button === 2) return
              event.preventDefault()
              mousePress.current = null
              blockClick.current =
                event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
                  ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
                  : null
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
              semanticSelection.current = null
              presentation.selection = null
              input.current?.focus({ preventScroll: true })
              event.currentTarget.setPointerCapture(event.pointerId)
              const at = point(event)
              selection.current = { start: at, end: at, epoch: epoch.current, rectangle: event.altKey }
              schedule()
              if (canInput && !event.shiftKey && !event.altKey && offset.current === 0) {
                const accepted = mouse(event, 'press')
                mousePress.current = accepted
                void accepted.then((handled) => {
                  if (handled && mousePress.current === accepted) {
                    selection.current = null
                    schedule()
                  }
                })
              }
            }}
            onPointerMove={(event) => {
              if (!event.buttons || (event.buttons & 2) !== 0) return
              const click = blockClick.current
              if (click && Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) blockClick.current = null
              if (mousePress.current) void mouse(event, 'motion', mousePress.current)
              if (selection.current) {
                extendSelection(event)
              }
            }}
            onPointerUp={(event) => {
              if (event.button === 2) return
              if (mousePress.current) void mouse(event, 'release', mousePress.current)
              const click = blockClick.current,
                range = selection.current,
                viewId = view.current
              blockClick.current = null
              if (
                click?.pointerId === event.pointerId &&
                range &&
                Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 4
              )
                void (mousePress.current ?? Promise.resolve(false)).then((handled) => {
                  if (
                    !handled &&
                    view.current === viewId &&
                    selection.current === range &&
                    epoch.current === range.epoch
                  ) {
                    selection.current = null
                    selectBlockAt(range.start.y)
                    schedule()
                  }
                })
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId)
            }}>
            <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 size-full" />
            <canvas ref={overlay} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
            <div
              ref={chrome}
              className="@container/terminal pointer-events-none absolute inset-y-0 left-0"
              style={{ width: scrollGeometry.width || '100%' }}>
              {props.active && controls && (
                <TerminalBlockControls
                  layout={controls.layout}
                  height={controls.height}
                  inset={0}
                  canRun={canRun}
                  navigationForBlock={navigationForBlock}
                  onShowMore={showMore}
                  readOutput={(block) => readBlock(block, 'output')}
                  onSelect={selectBlock}
                  onFindFocus={focusFind}
                  onAction={(block, action) => void blockAction(block, action)}
                />
              )}
              {findOpen && (
                <TerminalFindBar
                  ref={findBar}
                  needle={find.needle}
                  target={{ kind: find.scope, block: findBlock }}
                  result={searchResult}
                  onChange={changeFind}
                  onToggleScope={toggleFindScope}
                  onNavigate={(direction) => void navigateFind(direction).catch((cause) => setError(String(cause)))}
                  onClose={closeFind}
                />
              )}
            </div>
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
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) return
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
                if (!acceptsActions()) return
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
                  top: Math.max(0, snapshot.current?.cursorY ?? 0) * metrics.current.height
                }}>
                {composition}
              </span>
            )}
            <pre
              className="sr-only"
              role="log"
              aria-live={focused ? 'polite' : 'off'}
              aria-label={t('terminal.output')}>
              {accessible}
            </pre>
          </div>
        </ScrollArea>
      </TerminalContextMenu>
    </div>
  )
}
