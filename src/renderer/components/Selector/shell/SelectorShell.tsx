import { Input, Popover, PopoverContent, PopoverTrigger, Switch, usePortalContainer } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Search } from 'lucide-react'
import {
  type ComponentPropsWithoutRef,
  isValidElement,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

type PopoverContentProps = ComponentPropsWithoutRef<typeof PopoverContent>
/**
 * Use `lazy-keep` only for high-frequency popovers where remounting list state is noticeably costly.
 * Low-frequency selectors should keep the default `destroy` behavior.
 */
export type SelectorShellMountStrategy = 'destroy' | 'lazy-keep'
const DEFAULT_COLLISION_PADDING = 12
export const DEFAULT_SELECTOR_CONTENT_HEIGHT = 344

export type SelectorShellLayout = {
  availableListHeight?: number
  portalContainer?: PopoverContentProps['portalContainer'] | null
}

export type SelectorShellSearch = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  inputRef?: RefObject<HTMLInputElement | null>
  ariaControls?: string
  activeDescendant?: string
  dataTestId?: string
  autoFocus?: boolean
  spellCheck?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

export type SelectorShellMultiSelect = {
  label: ReactNode
  hint?: ReactNode
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  dataTestId?: string
  rowTestId?: string
}

export type SelectorShellBottomCommandAction = {
  type?: 'command'
  icon?: ReactNode
  label: ReactNode
  onClick: () => void
  disabled?: boolean
}

export type SelectorShellBottomSelectableAction = {
  type: 'selectable'
  icon?: ReactNode
  label: ReactNode
  onClick: () => void
  disabled?: boolean
  selected: boolean
}

export type SelectorShellBottomAction = SelectorShellBottomCommandAction | SelectorShellBottomSelectableAction

export type SelectorShellProps = {
  trigger: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  search?: SelectorShellSearch
  filterContent?: ReactNode
  multiSelect?: SelectorShellMultiSelect
  bottomAction?: SelectorShellBottomAction | SelectorShellBottomAction[]
  children: ReactNode | ((layout: SelectorShellLayout) => ReactNode)
  contentClassName?: string
  width?: number | string
  side?: PopoverContentProps['side']
  align?: PopoverContentProps['align']
  sideOffset?: PopoverContentProps['sideOffset']
  contentHeight?: number | string
  maxContentHeight?: number | string
  portalContainer?: PopoverContentProps['portalContainer']
  mountStrategy?: SelectorShellMountStrategy
  contentProps?: Omit<
    PopoverContentProps,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'portalContainer'
  >
  'data-testid'?: string
}

function parsePixelValue(value: string | null | undefined) {
  if (!value) return undefined

  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/)
  if (!match) return undefined

  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseCssSize(value: number | string | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined
  }

  return parsePixelValue(value)
}

function getAvailablePopoverHeight(element: HTMLElement, contentHeight?: number | string) {
  const styles = window.getComputedStyle(element)
  const parentStyles = element.parentElement ? window.getComputedStyle(element.parentElement) : null
  const heightCandidates = [
    parsePixelValue(styles.getPropertyValue('--radix-popover-content-available-height')),
    parsePixelValue(styles.getPropertyValue('--radix-popper-available-height')),
    parsePixelValue(parentStyles?.getPropertyValue('--radix-popper-available-height')),
    parsePixelValue(styles.maxHeight),
    parseCssSize(contentHeight)
  ].filter((height): height is number => height !== undefined)

  return heightCandidates.length > 0 ? Math.min(...heightCandidates) : undefined
}

function createLocalPortalContainer() {
  if (typeof document === 'undefined') {
    return null
  }

  const element = document.createElement('div')
  element.dataset.selectorShellPortal = 'true'
  element.style.display = 'contents'
  return element
}

function toCssSize(value: number | string | undefined) {
  return typeof value === 'number' ? `${value}px` : value
}

export function SelectorShell({
  trigger,
  open,
  onOpenChange,
  search,
  filterContent,
  multiSelect,
  bottomAction,
  children,
  contentClassName,
  width,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  contentHeight,
  maxContentHeight,
  portalContainer,
  mountStrategy = 'destroy',
  contentProps,
  'data-testid': dataTestId
}: SelectorShellProps) {
  const triggerNode = isValidElement(trigger) ? trigger : <span>{trigger}</span>
  const {
    forceMount,
    hidden,
    onInteractOutside,
    onOpenAutoFocus,
    onKeyDown,
    style,
    collisionPadding = DEFAULT_COLLISION_PADDING,
    ...restContentProps
  } = contentProps ?? {}
  const contentRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const filterRef = useRef<HTMLDivElement | null>(null)
  const multiSelectRef = useRef<HTMLDivElement | null>(null)
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const bottomActionRef = useRef<HTMLDivElement | null>(null)
  const localPortalRootRef = useRef<HTMLDivElement | null>(null)
  const measureFrameRef = useRef<number | null>(null)
  const [localPortalContainer] = useState(createLocalPortalContainer)
  const [availableListHeight, setAvailableListHeight] = useState<number | undefined>(undefined)
  const [hasOpened, setHasOpened] = useState(open)
  const pagePortalContainer = usePortalContainer()
  const hasSearch = Boolean(search)
  const hasFilterContent = Boolean(filterContent)
  const hasMultiSelect = Boolean(multiSelect)
  const resolvedBottomActions = Array.isArray(bottomAction) ? bottomAction : bottomAction ? [bottomAction] : []
  const hasBottomAction = resolvedBottomActions.length > 0

  const measureAvailableListHeight = useCallback(() => {
    const contentElement = contentRef.current
    if (!contentElement) {
      setAvailableListHeight(undefined)
      return
    }

    const availablePopoverHeight = getAvailablePopoverHeight(contentElement, contentHeight)
    if (!availablePopoverHeight) {
      setAvailableListHeight(undefined)
      return
    }

    const contentStyles = window.getComputedStyle(contentElement)
    const verticalPadding =
      (parsePixelValue(contentStyles.paddingTop) ?? 0) + (parsePixelValue(contentStyles.paddingBottom) ?? 0)
    const chromeHeight = [searchRef.current, filterRef.current, multiSelectRef.current, bottomActionRef.current].reduce(
      (height, element) => height + (element?.getBoundingClientRect().height ?? 0),
      0
    )
    const nextListHeight = Math.max(0, Math.floor(availablePopoverHeight - chromeHeight - verticalPadding))

    setAvailableListHeight((previousHeight) => (previousHeight === nextListHeight ? previousHeight : nextListHeight))
  }, [contentHeight])

  const scheduleMeasureAvailableListHeight = useCallback(() => {
    if (!open) {
      return
    }

    if (measureFrameRef.current !== null) {
      window.cancelAnimationFrame(measureFrameRef.current)
    }

    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null
      measureAvailableListHeight()
    })
  }, [measureAvailableListHeight, open])

  const setContentElement = useCallback(
    (element: HTMLDivElement | null) => {
      contentRef.current = element
      scheduleMeasureAvailableListHeight()
    },
    [scheduleMeasureAvailableListHeight]
  )

  const setSearchElement = useCallback(
    (element: HTMLDivElement | null) => {
      searchRef.current = element
      scheduleMeasureAvailableListHeight()
    },
    [scheduleMeasureAvailableListHeight]
  )

  const setFilterElement = useCallback(
    (element: HTMLDivElement | null) => {
      filterRef.current = element
      scheduleMeasureAvailableListHeight()
    },
    [scheduleMeasureAvailableListHeight]
  )

  const setMultiSelectElement = useCallback(
    (element: HTMLDivElement | null) => {
      multiSelectRef.current = element
      scheduleMeasureAvailableListHeight()
    },
    [scheduleMeasureAvailableListHeight]
  )

  const setListBodyElement = useCallback(
    (element: HTMLDivElement | null) => {
      listBodyRef.current = element
      scheduleMeasureAvailableListHeight()
    },
    [scheduleMeasureAvailableListHeight]
  )

  const setBottomActionElement = useCallback(
    (element: HTMLDivElement | null) => {
      bottomActionRef.current = element
      scheduleMeasureAvailableListHeight()
    },
    [scheduleMeasureAvailableListHeight]
  )

  const setLocalPortalRootElement = useCallback((element: HTMLDivElement | null) => {
    localPortalRootRef.current = element
  }, [])

  useLayoutEffect(() => {
    const root = localPortalRootRef.current
    if (!root || !localPortalContainer || portalContainer || pagePortalContainer) {
      return undefined
    }

    root.appendChild(localPortalContainer)
    return () => {
      if (localPortalContainer.parentElement === root) {
        root.removeChild(localPortalContainer)
      }
    }
  }, [localPortalContainer, pagePortalContainer, portalContainer])

  useLayoutEffect(() => {
    if (open) {
      setHasOpened(true)
    }

    if (!open) {
      setAvailableListHeight(undefined)
      return undefined
    }

    measureAvailableListHeight()

    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(measureAvailableListHeight)
    const observedElements = [
      contentRef.current,
      searchRef.current,
      filterRef.current,
      multiSelectRef.current,
      listBodyRef.current,
      bottomActionRef.current
    ].filter((element): element is HTMLDivElement => Boolean(element))

    observedElements.forEach((element) => observer.observe(element))
    window.addEventListener('resize', measureAvailableListHeight)

    return () => {
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current)
        measureFrameRef.current = null
      }
      observer.disconnect()
      window.removeEventListener('resize', measureAvailableListHeight)
    }
  }, [
    contentHeight,
    hasBottomAction,
    hasFilterContent,
    hasMultiSelect,
    hasSearch,
    maxContentHeight,
    measureAvailableListHeight,
    open
  ])

  useLayoutEffect(() => {
    return () => {
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current)
        measureFrameRef.current = null
      }
    }
  }, [])

  const shouldRenderContent = mountStrategy === 'lazy-keep' ? open || hasOpened : true
  const shouldForceMount = mountStrategy === 'lazy-keep' || forceMount ? true : undefined
  const resolvedPortalContainer = portalContainer ?? pagePortalContainer ?? localPortalContainer ?? undefined
  const layout = useMemo(
    () => ({ availableListHeight, portalContainer: resolvedPortalContainer ?? null }),
    [availableListHeight, resolvedPortalContainer]
  )
  const canRenderContent = shouldRenderContent && resolvedPortalContainer !== undefined
  const body = canRenderContent ? (typeof children === 'function' ? children(layout) : children) : null

  return (
    <div ref={setLocalPortalRootElement} className="contents" data-selector-shell-root="true">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
        {canRenderContent ? (
          <PopoverContent
            side={side}
            align={align}
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            portalContainer={resolvedPortalContainer}
            forceMount={shouldForceMount}
            hidden={mountStrategy === 'lazy-keep' && !open ? true : hidden}
            {...restContentProps}
            style={{
              width: toCssSize(width),
              height: toCssSize(contentHeight),
              maxHeight: toCssSize(maxContentHeight),
              ...style
            }}
            onInteractOutside={(event) => {
              const originalTarget = (event.detail?.originalEvent?.target ?? event.target) as Element | null
              if (originalTarget?.closest?.('[data-entity-context-menu-root]')) {
                event.preventDefault()
              }
              onInteractOutside?.(event)
            }}
            onOpenAutoFocus={(event) => {
              if (search && search.autoFocus !== false) {
                event.preventDefault()
                search.inputRef?.current?.focus()
              }
              onOpenAutoFocus?.(event)
            }}
            onKeyDown={onKeyDown}
            className={cn(
              'flex max-h-[var(--radix-popover-content-available-height)] w-90 flex-col overflow-hidden rounded-lg border-border bg-popover p-0 py-1 shadow-lg',
              contentClassName
            )}
            data-selector-shell-content="true"
            ref={setContentElement}
            data-testid={dataTestId}>
            {search ? (
              <div
                ref={setSearchElement}
                className="flex items-center gap-2 border-border border-b px-3 py-1"
                data-selector-shell-chrome="search">
                <Search className="pointer-events-none size-3.25 shrink-0 text-muted-foreground/50" />
                <Input
                  ref={search.inputRef}
                  value={search.value}
                  autoFocus={search.autoFocus ?? true}
                  spellCheck={search.spellCheck ?? false}
                  placeholder={search.placeholder}
                  aria-activedescendant={search.activeDescendant}
                  aria-controls={search.ariaControls}
                  className={cn(
                    'h-[var(--cs-size-xs)] flex-1 border-0 bg-transparent p-0 shadow-none transition-none',
                    'text-xs md:text-xs',
                    'focus-visible:border-transparent focus-visible:ring-0',
                    'placeholder:text-muted-foreground/40'
                  )}
                  data-testid={search.dataTestId}
                  onChange={(event) => search.onChange(event.target.value)}
                  onKeyDown={search.onKeyDown}
                />
              </div>
            ) : null}

            {filterContent ? (
              <div
                ref={setFilterElement}
                className="flex flex-wrap items-center gap-1.5 border-border border-b px-3 py-2"
                data-selector-shell-chrome="filter">
                {filterContent}
              </div>
            ) : null}

            {multiSelect ? (
              <div
                ref={setMultiSelectElement}
                className="flex items-center justify-between gap-3 border-border border-b px-3 py-2"
                data-selector-shell-chrome="multi-select"
                data-testid={multiSelect.rowTestId}>
                <div className="flex min-w-0 flex-1 items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="truncate">{multiSelect.label}</span>
                  {multiSelect.hint ? (
                    <span className="truncate text-muted-foreground/60">{multiSelect.hint}</span>
                  ) : null}
                </div>
                <Switch
                  checked={multiSelect.checked}
                  disabled={multiSelect.disabled}
                  size="sm"
                  data-testid={multiSelect.dataTestId}
                  onCheckedChange={multiSelect.onCheckedChange}
                />
              </div>
            ) : null}

            <div ref={setListBodyElement} className="min-h-0 flex-1 overflow-hidden" data-selector-shell-body="true">
              {body}
            </div>
            {hasBottomAction ? (
              <div
                ref={setBottomActionElement}
                className="relative z-1 shrink-0 border-border border-t bg-popover"
                data-selector-shell-chrome="bottom-action">
                {resolvedBottomActions.map((action, index) => {
                  const selected = action.type === 'selectable' && action.selected

                  return (
                    <button
                      key={index}
                      type="button"
                      disabled={action.disabled}
                      aria-pressed={action.type === 'selectable' ? selected : undefined}
                      onClick={action.onClick}
                      className={cn(
                        'relative flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        selected
                          ? 'bg-accent/70 text-foreground'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                      )}>
                      {selected ? (
                        <span
                          aria-hidden="true"
                          className="-translate-y-1/2 absolute start-0 top-1/2 block h-[60%] w-0.75 rounded-full bg-muted-foreground/60"
                        />
                      ) : null}
                      {action.icon}
                      <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </PopoverContent>
        ) : null}
      </Popover>
    </div>
  )
}
