// 32px row surface + 4px breathing room, the same rhythm the settings sidebar uses (DESIGN.md puts
// menu items at 32px). The list is dense by design: the surface owns the height, the gap is the
// smallest one that still separates two filled rows.
export const RESOURCE_LIST_DEFAULT_ROW_SIZE = 36

export const RESOURCE_LIST_ROW_HEIGHT_CLASS = 'h-[36px]'

/**
 * Rows sit on one rhythm; the only break in it is between modules. A header that opens a new module
 * (a section, or a bucket group such as a time range) grows by 8px and bottom-aligns its pill, so
 * the extra space lands above the label instead of splitting it from the rows it introduces.
 */
export const RESOURCE_LIST_MODULE_START_ROW_SIZE = 44

export const RESOURCE_LIST_MODULE_START_ROW_CLASS = 'h-[44px] items-end'

export const RESOURCE_LIST_VISUAL_ROW_CLASS = 'h-8 rounded-lg'

// Hover takes the lightest surface there is (`background-subtle`), leaving `sidebar-accent` free to
// mean "selected" one step above it — see RESOURCE_LIST_SELECTED_ROW_CLASS. Hover moves the fill and
// NOTHING else: recolouring the text used to pull structure labels up to the content shade, so the
// two voices collapsed into one for as long as the pointer sat there.
export const RESOURCE_LIST_INTERACTIVE_ROW_CLASS = 'hover:bg-background-subtle focus-visible:bg-background-subtle'

export const RESOURCE_LIST_TEXT_START_PADDING_CLASS = 'pl-9'

export const RESOURCE_LIST_LEADING_SLOT_BASE_CLASS = 'flex size-6 shrink-0 items-center justify-center'

export const RESOURCE_LIST_ITEM_LEADING_SLOT_CLASS =
  'rounded-lg text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground group-data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0'

export const RESOURCE_LIST_GROUP_HEADER_LEADING_SLOT_CLASS =
  'rounded-lg text-inherit [&_svg]:size-4 [&_svg]:text-inherit'

export const RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS = RESOURCE_LIST_LEADING_SLOT_BASE_CLASS

// DESIGN.md's sidebar spec puts an active row on `sidebar-accent`, so that's the fill — a lighter
// surface than a general-purpose `accent`, which the label's `font-medium` makes up for. The text
// colour never changes; weight is the only thing selection adds to it.
//
// The hover fill has to be restated here: `hover:bg-*` out-specifies a plain `bg-*`, so without this
// the row would go LIGHTER under the pointer — the open conversation would look like any hovered row.
export const RESOURCE_LIST_SELECTED_ROW_CLASS =
  'bg-sidebar-accent text-foreground shadow-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent'

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
 * and yielding to the hover actions is done purely with animatable geometry
 * (the margins in RESOURCE_LIST_TITLE_FADE_YIELD_CLASS), letting the fade
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
  'overflow-hidden text-clip whitespace-nowrap transition-[margin] duration-150 [mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)]'

/**
 * Companion to RESOURCE_LIST_TITLE_FADE_CLASS: shift the faded edge left of
 * the hover actions ONLY while they are actually visible — pointer hover,
 * keyboard focus inside the actions, or the forced-active dot/delete-confirm
 * state. All three variants reserve the same two-icon zone (mr-12, the icon
 * zone plus ~12px of breathing room so the fading text never touches the
 * icons): the forced-active :has() variant out-specifies group-hover, so any
 * smaller margin there would win the cascade while the row is hovered — the
 * normal way delete-confirm is entered — and slide the title under the pin
 * icon. NOT group-focus-within: clicking a row focuses it and would pin the
 * yield while the icons stay hidden.
 */
export const RESOURCE_LIST_TITLE_FADE_YIELD_CLASS =
  'group-has-[[data-resource-list-item-actions][data-active=true]]:mr-12 group-has-[[data-resource-list-item-actions]:focus-within]:mr-12 group-hover:mr-12'

/**
 * Same yield for rows that reveal a single action (a pinned row drops delete): reserving the
 * two-icon zone there would open a visibly empty gap where the second icon isn't.
 */
export const RESOURCE_LIST_TITLE_FADE_YIELD_SINGLE_ACTION_CLASS =
  'group-has-[[data-resource-list-item-actions][data-active=true]]:mr-7 group-has-[[data-resource-list-item-actions]:focus-within]:mr-7 group-hover:mr-7'

/** Compact search input used by the right-panel presentation of the topic/session lists (classic layout). */
export const RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS =
  'h-8 rounded-lg border-border-subtle bg-background-subtle pl-7 pr-2 text-xs shadow-none md:text-xs placeholder:text-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'
