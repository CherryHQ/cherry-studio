export const settingsSubmenuScrollClassName =
  'h-[calc(100vh-var(--navbar-height))] w-(--settings-width) border-border border-r-[0.5px]'

export const settingsSubmenuListClassName = 'flex flex-col gap-0.5 px-2.5 pb-2.5 [box-sizing:border-box]'

// Single source of truth lives in @cherrystudio/ui (shared with the resource edit-dialog rail).
export { submenuItemClassName as settingsSubmenuItemClassName } from '@cherrystudio/ui'

export const settingsSubmenuItemLabelClassName = 'group-data-[active=true]:font-medium'

export const settingsSubmenuSectionTitleClassName =
  'px-2.5 pt-2 pb-0.5 font-normal text-foreground-muted text-xs first:pt-0'

export const settingsSubmenuDividerClassName = 'my-0 bg-transparent'

export const settingsContentScrollClassName = 'flex-1 min-h-0 min-w-0 overflow-x-hidden'

export const settingsContentBodyClassName = 'flex min-h-full w-full flex-col px-6 py-4'

export const settingsContentHeaderClassName = 'mb-5'

export const settingsContentHeaderTitleClassName = 'font-semibold text-foreground text-[15px]'

export const settingsContentHeaderDescriptionClassName = 'mt-1 text-foreground-muted text-sm'
