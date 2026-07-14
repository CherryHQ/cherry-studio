export const RESOURCE_LIST_DEFAULT_ROW_SIZE = 38

export const RESOURCE_LIST_ROW_HEIGHT_CLASS = 'h-[38px]'

export const RESOURCE_LIST_VISUAL_ROW_CLASS = 'h-8 rounded-lg'

export const RESOURCE_LIST_INTERACTIVE_ROW_CLASS =
  'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring'

export const RESOURCE_LIST_TEXT_START_PADDING_CLASS = 'pl-9'

export const RESOURCE_LIST_LEADING_SLOT_BASE_CLASS = 'flex size-6 shrink-0 items-center justify-center'

export const RESOURCE_LIST_ITEM_LEADING_SLOT_CLASS =
  'rounded-lg text-foreground/70 group-hover:text-foreground group-focus-visible:text-foreground group-data-[selected=true]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0'

export const RESOURCE_LIST_GROUP_HEADER_LEADING_SLOT_CLASS =
  'rounded-lg text-inherit [&_svg]:size-4 [&_svg]:text-inherit'

export const RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS = RESOURCE_LIST_LEADING_SLOT_BASE_CLASS

export const RESOURCE_LIST_SELECTED_ROW_CLASS = 'bg-sidebar-accent text-sidebar-foreground shadow-none'

/**
 * Fade-out title treatment for topic/session rows, replacing the ellipsis: a
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
 */
export const RESOURCE_LIST_TITLE_FADE_CLASS =
  'overflow-hidden text-clip whitespace-nowrap transition-[margin] duration-150 [mask-image:linear-gradient(to_right,#000_calc(100%-16px),transparent)]'

/**
 * Companion to RESOURCE_LIST_TITLE_FADE_CLASS: shift the faded edge left of
 * the hover actions ONLY while they are actually visible — pointer hover,
 * keyboard focus inside the actions (two icons, mr-12), or the forced-active
 * dot/delete-confirm state (one icon, mr-7). Each margin is the icon zone
 * plus ~12px of breathing room so the fading text never touches the icons.
 * NOT group-focus-within: clicking a row focuses it and would pin the yield
 * while the icons stay hidden.
 */
export const RESOURCE_LIST_TITLE_FADE_YIELD_CLASS =
  'group-has-[[data-resource-list-item-actions][data-active=true]]:mr-7 group-has-[[data-resource-list-item-actions]:focus-within]:mr-12 group-hover:mr-12'

/** Compact search input used by the right-panel presentation of the topic/session lists (classic layout). */
export const RESOURCE_LIST_RIGHT_PANEL_SEARCH_INPUT_CLASS =
  'h-8 rounded-lg border-border-subtle bg-background-subtle pl-7 pr-2 text-xs shadow-none md:text-xs placeholder:text-xs placeholder:text-foreground-muted focus-visible:border-border-hover focus-visible:bg-background focus-visible:ring-0'
