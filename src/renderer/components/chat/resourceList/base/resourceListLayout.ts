// 32px row surface + 4px breathing room, the same rhythm the settings sidebar uses (DESIGN.md puts
// menu items at 32px). Keep the measured size and rendered class together: virtual-list estimates
// must never drift from the row that they describe.
export const RESOURCE_LIST_DEFAULT_ROW_LAYOUT = {
  className: 'h-9',
  size: 36
} as const

/**
 * Rows sit on one rhythm; the only break in it is between modules. A header that opens a new module
 * (a section, or a bucket group such as a time range) grows by 8px and bottom-aligns its pill, so
 * the extra space lands above the label instead of splitting it from the rows it introduces.
 */
export const RESOURCE_LIST_MODULE_START_ROW_LAYOUT = {
  className: 'h-11 items-end',
  size: 44
} as const

export const RESOURCE_LIST_VISUAL_ROW_CLASS = 'h-8 rounded-lg'

// Hover takes the lightest surface there is (`background-subtle`), leaving `sidebar-accent` free to
// mean "selected" one step above it — see RESOURCE_LIST_SELECTED_ROW_CLASS. Hover moves the fill and
// NOTHING else: recolouring the text used to pull structure labels up to the content shade, so the
// two voices collapsed into one for as long as the pointer sat there.
export const RESOURCE_LIST_INTERACTIVE_ROW_CLASS = 'hover:bg-background-subtle focus-visible:bg-background-subtle'

export const RESOURCE_LIST_TEXT_START_PADDING_CLASS = 'pl-9'

export const RESOURCE_LIST_LEADING_SLOT_BASE_CLASS = 'flex size-6 shrink-0 items-center justify-center'

export const RESOURCE_LIST_ITEM_LEADING_SLOT_CLASS =
  'rounded-lg text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground group-data-[active-descendant=true]:text-sidebar-accent-foreground group-data-[selected=true]:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0'

export const RESOURCE_LIST_GROUP_HEADER_LEADING_SLOT_CLASS =
  'rounded-lg text-inherit [&_svg]:size-4 [&_svg]:text-inherit'

export const RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS = RESOURCE_LIST_LEADING_SLOT_BASE_CLASS

// DESIGN.md's sidebar spec puts an active row on `sidebar-accent`, so that's the fill — a lighter
// surface than a general-purpose `accent`, paired with its matching foreground token. Weight is the
// only additional emphasis selection adds.
//
// The hover fill has to be restated here: `hover:bg-*` out-specifies a plain `bg-*`, so without this
// the row would go LIGHTER under the pointer — the open conversation would look like any hovered row.
export const RESOURCE_LIST_SELECTED_ROW_CLASS =
  'bg-sidebar-accent text-sidebar-accent-foreground shadow-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent'

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
 * Group headers reuse the same band but yield differently: their hover actions
 * are absolutely positioned, so the animated reserve lives in the header
 * button's own padding-right instead of a margin on the label.
 */
export const RESOURCE_LIST_TITLE_FADE_CLASS =
  'overflow-hidden text-clip whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)]'

/**
 * Reserve the rendered action slots while they are visible. Consumers provide
 * actions; ResourceList owns the slot-to-spacing scale, so page code never has
 * to choose raw margins. NOT group-focus-within: clicking a row focuses it and
 * would pin the yield while the icons stay hidden.
 */
export function getResourceListItemActionYieldClassName(actionCount: number) {
  if (actionCount >= 3) {
    return 'transition-[margin] duration-150 group-has-[[data-resource-list-item-actions][data-active=true]]:mr-16 group-has-[[data-resource-list-item-actions]:focus-within]:mr-16 group-hover:mr-16'
  }
  if (actionCount === 2) {
    return 'transition-[margin] duration-150 group-has-[[data-resource-list-item-actions][data-active=true]]:mr-12 group-has-[[data-resource-list-item-actions]:focus-within]:mr-12 group-hover:mr-12'
  }
  if (actionCount === 1) {
    return 'transition-[margin] duration-150 group-has-[[data-resource-list-item-actions][data-active=true]]:mr-7 group-has-[[data-resource-list-item-actions]:focus-within]:mr-7 group-hover:mr-7'
  }
  return undefined
}

/** The same action-slot scale for absolutely positioned group-header actions. */
export function getResourceListGroupHeaderActionYieldClassName(actionCount: number) {
  if (actionCount >= 3) {
    return 'transition-[padding-right] duration-150 group-hover/resource-list-group:pr-16 group-has-[:focus-visible]/resource-list-group:pr-16 group-has-data-[state=open]/resource-list-group:pr-16'
  }
  if (actionCount === 2) {
    return 'transition-[padding-right] duration-150 group-hover/resource-list-group:pr-12 group-has-[:focus-visible]/resource-list-group:pr-12 group-has-data-[state=open]/resource-list-group:pr-12'
  }
  if (actionCount === 1) {
    return 'transition-[padding-right] duration-150 group-hover/resource-list-group:pr-7 group-has-[:focus-visible]/resource-list-group:pr-7 group-has-data-[state=open]/resource-list-group:pr-7'
  }
  return undefined
}

/** Compact search input used by the right-panel presentation of the topic/session lists (classic layout). */
export const RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS =
  'h-8 rounded-lg border-border-subtle bg-background-subtle pl-7 pr-2 text-xs shadow-none md:text-xs placeholder:text-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'
