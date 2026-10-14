// 32px row surface + 4px breathing room, the same rhythm the settings sidebar uses (DESIGN.md puts
// menu items at 32px). Keep the measured size and rendered class together: virtual-list estimates
// must never drift from the row that they describe.
export const RESOURCE_LIST_DEFAULT_ROW_LAYOUT = {
  className: 'h-9',
  size: 36
} as const

export const estimateResourceListDefaultRowSize = () => RESOURCE_LIST_DEFAULT_ROW_LAYOUT.size

export const RESOURCE_LIST_VISUAL_ROW_CLASS = 'h-8 rounded-lg'

export type ResourceListPresentation = 'left-panel' | 'right-panel'

type ResourceListPresentationClassNames = {
  body: string
  frame: string
  header?: string
  searchIconPadding: string
  searchInput: string
  searchWrapper?: string
}

/**
 * Placement changes geometry, not product identity. Both presentations sit on the page background
 * and share row semantics; this map owns the small structural differences between the left
 * navigation pane and the classic-layout right panel.
 */
export const RESOURCE_LIST_PRESENTATION_CLASS_NAMES: Record<
  ResourceListPresentation,
  ResourceListPresentationClassNames
> = {
  'left-panel': {
    body: 'pt-0 pb-3',
    frame: 'border-border border-r-[0.5px]',
    searchIconPadding: 'pl-6',
    searchInput: 'h-7 rounded-full text-[10px] md:text-[10px] placeholder:text-[10px]'
  },
  'right-panel': {
    body: 'pt-0 pb-8',
    frame: 'h-full',
    header: 'pb-1',
    searchIconPadding: 'pl-7',
    searchInput: 'h-8 rounded-lg text-xs md:text-xs placeholder:text-xs',
    searchWrapper: 'pt-1'
  }
}

// ResourceList spans left- and right-panel hosts. Hover is the quiet product surface and preserves
// each row's existing foreground hierarchy; persistent states own explicit product surface pairs.
export const RESOURCE_LIST_INTERACTIVE_ROW_CLASS =
  'hover:bg-resource-list-row-hover focus-visible:bg-resource-list-row-hover'

export const RESOURCE_LIST_DESCENDANT_FOCUS_ROW_CLASS = 'has-[:focus-visible]:bg-resource-list-row-hover'

export const RESOURCE_LIST_ACTIVE_ROW_CLASS =
  'bg-resource-list-row-active text-resource-list-row-active-foreground hover:bg-resource-list-row-active focus-visible:bg-resource-list-row-active'

export const RESOURCE_LIST_ROW_STATE_FOREGROUND_CLASS =
  'group-data-[active-descendant=true]:text-resource-list-row-active-foreground group-data-[selected=true]:text-resource-list-row-selected-foreground'

export const RESOURCE_LIST_TEXT_START_PADDING_CLASS = 'pl-9'

export const RESOURCE_LIST_LEADING_SLOT_BASE_CLASS = 'flex size-6 shrink-0 items-center justify-center'

export const RESOURCE_LIST_ITEM_LEADING_SLOT_CLASS = `rounded-lg text-muted-foreground ${RESOURCE_LIST_ROW_STATE_FOREGROUND_CLASS} [&_svg]:size-4 [&_svg]:shrink-0`

export const RESOURCE_LIST_GROUP_HEADER_LEADING_SLOT_CLASS =
  'rounded-lg text-inherit [&_svg]:size-4 [&_svg]:text-inherit'

export const RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS = RESOURCE_LIST_LEADING_SLOT_BASE_CLASS

// Selection is persistent, so hover and focus must not replace it with the quieter interactive fill.
// Weight is the only additional emphasis selection adds.
export const RESOURCE_LIST_SELECTED_ROW_CLASS =
  'bg-resource-list-row-selected text-resource-list-row-selected-foreground shadow-none hover:bg-resource-list-row-selected focus-visible:bg-resource-list-row-selected'

/**
 * ONE type voice for every label in the list — structure headers, entity rows and item titles all
 * share this size and weight. Hierarchy is carried by colour depth (`muted-foreground` for the
 * labels that structure the list, `foreground` for the things it lists), by indent, and by the icon
 * a row does or doesn't have. The single exception is the selected row, which goes to
 * `font-medium` on top of its fill — the same way the settings submenu marks its active row.
 */
export const RESOURCE_LIST_LABEL_CLASS = 'font-normal text-[13px] leading-5'

/**
 * Fade-out title treatment for topic/session rows and group headers (agent /
 * assistant / workdir names), replacing the ellipsis: a
 * SINGLE constant 16px mask band hugging the title's right edge. mask-image
 * cannot transition, so it is never swapped — in-flow trailing siblings (e.g.
 * the awaiting-approval badge) keep flex space so the fade hugs them at rest,
 * and yielding to the hover actions is done purely with animatable geometry,
 * letting the fade
 * slide continuously with the edge. Absolutely-positioned trailing elements
 * (e.g. the right-panel detached stream indicator) keep NO space — consumers
 * must add a standing margin for those themselves. Margin, not padding: the
 * mask clips at the border-box edge, so a padding reserve would hard-crop the
 * text at the content edge instead of fading it.
 *
 * Group headers reuse the same band. Their in-flow action rail expands from a
 * zero max-width, so the flex label yields directly without a separate padding
 * reserve.
 */
export const RESOURCE_LIST_TITLE_FADE_CLASS =
  'overflow-hidden text-clip whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)]'
