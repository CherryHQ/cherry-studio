import { Input, Popover, PopoverContent, PopoverTrigger, Switch } from '@cherrystudio/ui'
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
const MIN_SELECTOR_LIST_HEIGHT = 36

export type SelectorShellLayout = {
  availableListHeight?: number
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

export type SelectorShellBottomAction = {
  icon?: ReactNode
  label: ReactNode
  onClick: () => void
  disabled?: boolean
}

export type SelectorShellProps = {
  trigger: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  search?: SelectorShellSearch
  filterContent?: ReactNode
  multiSelect?: SelectorShellMultiSelect
  bottomAction?: SelectorShellBottomAction
  children: ReactNode | ((layout: SelectorShellLayout) => ReactNode)
  contentClassName?: string
  width?: number | string
  side?: PopoverContentProps['side']
  align?: PopoverContentProps['align']
  sideOffset?: PopoverContentProps['sideOffset']
  maxListHeight?: number | string
  contentProps?: Omit<PopoverContentProps, 'children' | 'className' | 'side' | 'align' | 'sideOffset'>
  'data-testid'?: string
}

function parsePixelValue(value: string | null | undefined) {
  if (!value) return undefined

  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/)
  if (!match) return undefined

  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function getAvailablePopoverHeight(element: HTMLElement) {
  const styles = window.getComputedStyle(element)
  const parentStyles = element.parentElement ? window.getComputedStyle(element.parentElement) : null

  return (
    parsePixelValue(styles.getPropertyValue('--radix-popover-content-available-height')) ??
    parsePixelValue(styles.getPropertyValue('--radix-popper-available-height')) ??
    parsePixelValue(parentStyles?.getPropertyValue('--radix-popper-available-height')) ??
    parsePixelValue(styles.maxHeight)
  )
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
  side,
  align = 'start',
  sideOffset = 4,
  maxListHeight,
  contentProps,
  'data-testid': dataTestId
}: SelectorShellProps) {
  const triggerNode = isValidElement(trigger) ? trigger : <span>{trigger}</span>
  const { onInteractOutside, onOpenAutoFocus, onKeyDown, style, ...restContentProps } = contentProps ?? {}
  const contentRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const filterRef = useRef<HTMLDivElement | null>(null)
  const multiSelectRef = useRef<HTMLDivElement | null>(null)
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const bottomActionRef = useRef<HTMLDivElement | null>(null)
  const measureFrameRef = useRef<number | null>(null)
  const [availableListHeight, setAvailableListHeight] = useState<number | undefined>(undefined)

  const measureAvailableListHeight = useCallback(() => {
    const contentElement = contentRef.current
    if (!contentElement) {
      setAvailableListHeight(undefined)
      return
    }

    const availablePopoverHeight = getAvailablePopoverHeight(contentElement)
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
    const nextListHeight = Math.max(
      MIN_SELECTOR_LIST_HEIGHT,
      Math.floor(availablePopoverHeight - chromeHeight - verticalPadding)
    )

    setAvailableListHeight((previousHeight) => (previousHeight === nextListHeight ? previousHeight : nextListHeight))
  }, [])

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

  useLayoutEffect(() => {
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
  }, [bottomAction, filterContent, measureAvailableListHeight, multiSelect, open, search])

  useLayoutEffect(() => {
    return () => {
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current)
        measureFrameRef.current = null
      }
    }
  }, [])

  const layout = useMemo(() => ({ availableListHeight }), [availableListHeight])
  const body = typeof children === 'function' ? children(layout) : children

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        {...restContentProps}
        style={{
          width: typeof width === 'number' ? `${width}px` : width,
          maxHeight: typeof maxListHeight === 'number' ? `${maxListHeight}px` : maxListHeight,
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
              {multiSelect.hint ? <span className="truncate text-muted-foreground/60">{multiSelect.hint}</span> : null}
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

        <div ref={setListBodyElement} className="min-h-0 flex-1" data-selector-shell-body="true">
          {body}
        </div>
        {bottomAction ? (
          <div ref={setBottomActionElement} data-selector-shell-chrome="bottom-action">
            <div className="border-border border-t" />
            <button
              type="button"
              disabled={bottomAction.disabled}
              onClick={bottomAction.onClick}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-muted-foreground text-xs transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
              {bottomAction.icon}
              <span className="flex-1">{bottomAction.label}</span>
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
