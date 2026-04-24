import type { PopoverContent } from '@cherrystudio/ui/components/primitives/popover'
import type { ComponentProps, MouseEvent, ReactNode } from 'react'

export type EntityItemBase = {
  id: string
  disabled?: boolean
}

export type EntitySelectorMultiSelect = {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}

export type EntitySelectorRowContext = {
  isSelected: boolean
  isMultiMode: boolean
  isActive: boolean
  /** Fires the configured selection behavior (toggle in multi-mode, select + close in single-mode). */
  onSelect: () => void
  /** Bind to row's `onContextMenu`. Only present when `renderItemContextMenu` is configured. */
  onContextMenu?: (e: MouseEvent) => void
}

export type EntitySelectorContextMenuFactory<T> = (item: T, ctx: { close: () => void }) => ReactNode | null

export type EntitySelectorSearch = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export type EntitySelectorPopoverContentProps = Omit<ComponentProps<typeof PopoverContent>, 'children' | 'asChild'>

/**
 * Named group of items with an optional header node. Use `sections` instead of flat `items` when
 * the list needs non-item rows interleaved (e.g. a "Pinned" heading above the pinned rows).
 * Section headers are presentational — they are not focusable, not selectable, and do not
 * participate in keyboard navigation or active-descendant tracking.
 * Keyboard navigation walks across all sections in order as if it were a flat list.
 */
export type EntitySelectorSection<T extends EntityItemBase> = {
  /** Stable key for React reconciliation. */
  key: string
  /** Rendered immediately before this section's items. Hidden when the section has zero items. */
  header?: ReactNode
  items: T[]
}

// Three-branch union so TS rejects passing BOTH items and sections, while still admitting a
// zero-arg shape (`{}`) — Storybook's args typing requires a legal default, and callers that
// omit both fields get an empty list at runtime.
type EntitySelectorItemsPayload<T extends EntityItemBase> =
  | { items: T[]; sections?: undefined }
  | { items?: undefined; sections: EntitySelectorSection<T>[] }
  | { items?: undefined; sections?: undefined }

type EntitySelectorBaseProps<T extends EntityItemBase> = {
  /** Controlled open state; pair with `onOpenChange`. Omit for uncontrolled. */
  open?: boolean
  onOpenChange?: (open: boolean) => void

  /** Trigger node, rendered outside the popover (any clickable element). */
  trigger: ReactNode

  /** 'single' = single value; 'multi' = array of values. */
  mode: 'single' | 'multi'
  value: string | string[] | null
  onChange: (value: string | string[]) => void

  /** Required row renderer. The composite owns the row's click + hover + context-menu plumbing; visuals are yours. */
  renderItem: (item: T, ctx: EntitySelectorRowContext) => ReactNode

  /** Search input config (controlled). Omit to hide the search input entirely. The caller does the filtering. */
  search?: EntitySelectorSearch

  /** Filter panel slot. When provided, the filter toggle button appears inside the search input. */
  filterPanel?: ReactNode
  /** Show the filter toggle button in the active state (e.g. when the consumer's filter has any value applied). */
  filterActive?: boolean

  /** Multi-select toolbar (toggle + label/hint slots). */
  multiSelect?: EntitySelectorMultiSelect

  /**
   * Right-click menu content factory. Return a node or null to suppress the menu.
   * The composite handles portal, positioning, and outside-click / escape / scroll dismissal — the slot owns visuals.
   * Use `ctx.close()` to dismiss the menu programmatically.
   */
  renderItemContextMenu?: EntitySelectorContextMenuFactory<T>

  /** Distance (px) the context-menu keeps from viewport edges. Default: 8. */
  contextMenuViewportMargin?: number

  /** Sticky footer slot (any node). Hidden when omitted. */
  footer?: ReactNode

  /** Max scrollable list height in CSS units. Default: 320. */
  maxListHeight?: number | string

  /** Node shown when items is empty and loading is false. Omit to render nothing. */
  emptyState?: ReactNode

  loading?: boolean
  /** Node shown while loading. Omit to render nothing. */
  loadingState?: ReactNode

  /** Width of the popover content. Default: 320. */
  width?: number | string

  /** ClassName forwarded to the popover content root. */
  className?: string

  /**
   * Passthrough props for the underlying Radix PopoverContent.
   * Defaults applied by the composite: `align="start"`, `sideOffset={6}`.
   * `onInteractOutside` is composed with the composite's right-click-menu guard — your handler runs after.
   * `className` is merged with the composite's base classes.
   */
  popoverContentProps?: EntitySelectorPopoverContentProps
}

/**
 * Exactly one of `items` or `sections` must be provided. `items` is the flat form;
 * `sections` groups items with optional per-group headers.
 */
export type EntitySelectorProps<T extends EntityItemBase> = EntitySelectorBaseProps<T> & EntitySelectorItemsPayload<T>
