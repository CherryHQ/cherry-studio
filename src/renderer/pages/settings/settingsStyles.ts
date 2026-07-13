// Left submenu scroll column — fixed settings width with a hairline right border.
export const settingsSubmenuScrollClassName =
  'h-[calc(100vh-var(--navbar-height))] w-(--settings-width) border-border border-r-[0.5px]'

// Submenu list wrapper — vertical stack of MenuItems with small gaps and side padding.
export const settingsSubmenuListClassName = 'flex flex-col gap-0.5 px-2.5 pb-2.5 [box-sizing:border-box]'

// Submenu MenuItem — idle/hover/active states for a settings nav entry (selected surface + medium weight when active).
export const settingsSubmenuItemClassName =
  'h-7.5 gap-2.5 rounded-lg border-transparent px-2.5 font-normal text-foreground/80 text-sm hover:!bg-muted hover:text-foreground data-[active=true]:!border-transparent data-[active=true]:!bg-selected data-[active=true]:!shadow-(--shadow-selected-outline) data-[active=true]:!font-medium data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-current [&_svg]:[stroke-width:var(--icon-stroke)]'

// Submenu MenuItem label — bumps to medium weight when the item is active.
export const settingsSubmenuItemLabelClassName = 'group-data-[active=true]:font-medium'

// Submenu section heading between groups of nav entries (muted, 12px).
export const settingsSubmenuSectionTitleClassName =
  'px-2.5 pt-2 pb-0.5 font-normal text-foreground-muted text-xs first:pt-0'

// Submenu group divider — transparent spacer between nav sections.
export const settingsSubmenuDividerClassName = 'my-0 bg-transparent'

// Right content column scroll container — fills remaining width, hides horizontal overflow.
export const settingsContentScrollClassName = 'flex-1 min-h-0 min-w-0 overflow-x-hidden'

// Right content body — same two-layer padding as SettingsContentBody, applied via className.
export const settingsContentBodyClassName = 'flex min-h-full w-full flex-col px-6 py-4'

// 3-column page content-header description (muted, 14px).
export const settingsContentHeaderDescriptionClassName = 'mt-1 text-foreground-muted text-sm'
