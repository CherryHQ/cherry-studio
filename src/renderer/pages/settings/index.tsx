import { Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { CircleHelp } from 'lucide-react'
import React from 'react'

// Horizontal divider between setting rows — re-exported from the shared Divider primitive.
export { Divider as SettingDivider } from '@cherrystudio/ui'

// Legacy scrollable settings shell with uniform padding — kept for pages that don't use SettingsContentColumn.
export const SettingContainer = ({
  className,
  theme,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { theme?: ThemeMode }) => (
  <div
    data-theme-mode={theme}
    className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 [&::-webkit-scrollbar]:hidden', className)}
    {...props}
  />
)

// Canonical settings page container — mirrors the model service (Provider Settings) detail column:
// outer px-6 py-4 + inner mx-auto max-w-3xl. Use for "simple right-content" settings pages.
// Pages with their own internal split layout (Data / Integration / MCP / WebSearch / FileProcessing / Channels)
// keep SettingContainer instead. See DESIGN.md §4 "Settings Page Content Container".
export const SettingsContentColumn = ({
  className,
  innerClassName,
  theme,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<'div'> & { theme?: ThemeMode; innerClassName?: string }) => (
  <div
    data-theme-mode={theme}
    className={cn(
      'flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4 pt-3 [&::-webkit-scrollbar]:hidden',
      className
    )}
    {...rest}>
    <div className={cn('mx-auto w-full max-w-3xl', innerClassName)}>{children}</div>
  </div>
)

// Body variant for pages that handle their own Scrollbar (e.g. CommonSettings, ShortcutSettings).
// Renders the same two-layer structure (outer px-6 py-4, inner mx-auto max-w-3xl) without owning the scroll.
export const SettingsContentBody = ({
  className,
  innerClassName,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<'div'> & { innerClassName?: string }) => (
  <div className={cn('flex min-h-full w-full flex-col px-6 py-4 pt-3', className)} {...rest}>
    <div className={cn('mx-auto w-full max-w-3xl', innerClassName)}>{children}</div>
  </div>
)

// Group / section title within a page (14px medium — bold-looking but lighter than semibold; a real CJK weight).
// Sits above each SettingCard or SettingGroup body.
export const SettingTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex select-none items-center justify-between font-medium text-sm', className)} {...props} />
)

// Canonical 2-column page header: leading icon + 16px semibold title + optional description / action.
// Renders an <h1> for accessibility; pages should use this at the top, then SettingTitle for group titles below.
export const SettingsPageHeader = ({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> & {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) => (
  <div className={cn('flex items-start justify-between gap-3', className)} {...rest}>
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-foreground">
        {icon ? (
          <span className="inline-flex shrink-0 [&_svg]:size-5 [&_svg]:text-foreground [&_svg]:[stroke-width:1.5]">
            {icon}
          </span>
        ) : null}
        <h1 className="m-0 select-none font-medium text-lg leading-6">{title}</h1>
      </div>
      {description ? <p className="m-0 mt-1.5 text-foreground-muted text-xs">{description}</p> : null}
    </div>
    {action}
  </div>
)

// Subtitle inside a SettingCard for nested subsections (14px medium, foreground).
export const SettingSubtitle = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.RefObject<HTMLDivElement | null> }) => (
  <div ref={ref} className={cn('select-none font-medium text-foreground text-sm', className)} {...props} />
)

// Caption-sized helper text under a SettingRow (muted, 12px).
export const SettingDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2.5 text-foreground-muted text-xs', className)} {...props} />
)

// One horizontal setting row: label + control(s), gap-x-4, min-h-8.
export const SettingRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2', className)} {...props} />
)

// Row label (13px, normal weight to match span-reset text via the global `* { font-weight: normal }` base rule).
// Supports an optional `tip` tooltip rendered as a help-icon next to the text.
export const SettingRowTitle = ({
  className,
  tip,
  children,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { tip?: React.ReactNode }) => (
  <div
    className={cn(
      'text-(length:--font-size-body-xs) flex min-w-0 flex-wrap items-center font-normal text-foreground leading-4.5',
      className
    )}
    {...props}>
    {children}
    {tip && (
      <Tooltip content={tip}>
        <CircleHelp size={14} strokeWidth={1.6} className="ml-1.5 shrink-0 cursor-pointer text-foreground-muted" />
      </Tooltip>
    )}
  </div>
)

// Horizontal container for inline help links + help text under a setting field.
export const SettingHelpTextRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center py-1.25', className)} {...props} />
)

// Inline hint copy under a field (11px, low-emphasis foreground).
export const SettingHelpText = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('text-(length:--font-size-body-xs) text-foreground/40', className)} {...props} />
)

// Inline help link in caption tier (11px, blue info color).
export const SettingHelpLink = ({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a
    className={cn('!text-info text-(length:--font-size-body-xs) cursor-pointer hover:underline', className)}
    {...props}
  />
)

// External link displayed next to a SettingTitle (inline-flex, blue info color, opens in new tab by default).
export const SettingTitleExternalLink = ({
  className,
  target = '_blank',
  rel = 'noreferrer',
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a
    target={target}
    rel={rel}
    className={cn('!text-info inline-flex items-center hover:underline', className)}
    {...props}
  />
)

// Vertical group wrapper around a SettingTitle + body — adds top spacing between consecutive groups.
export const SettingGroup = ({
  className,
  theme,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { theme?: ThemeMode }) => (
  <div data-theme-mode={theme} className={cn('mt-6 first:mt-0', className)} {...props} />
)

// Card shell for a group's rows — SettingTitle stays outside, rows go inside.
// Direct children get uniform row padding via the `*:` variant.
export const SettingCard = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-3 rounded-xl border border-border/60 py-1.5 *:px-4 *:py-1.5', className)} {...props} />
)

// Left submenu scroll column — fixed settings width with a hairline right border.
export const settingsSubmenuScrollClassName =
  'h-[calc(100vh-var(--navbar-height))] w-(--settings-width) border-border border-r-[0.5px]'

// Submenu list wrapper — vertical stack of MenuItems with small gaps and side padding.
export const settingsSubmenuListClassName = 'flex flex-col gap-0.5 px-2.5 pb-2.5 [box-sizing:border-box]'

// Submenu MenuItem — idle/hover/active states for a settings nav entry (selected surface + medium weight when active).
export const settingsSubmenuItemClassName =
  'h-7.5 gap-2.5 rounded-lg border-transparent px-2.5 font-normal text-foreground/80 text-sm hover:!bg-muted hover:text-foreground data-[active=true]:!border-transparent data-[active=true]:!bg-selected data-[active=true]:!shadow-(--shadow-selected-outline) data-[active=true]:!font-medium data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-current [&_svg]:[stroke-width:1.6]'

// Submenu MenuItem label — bumps to medium weight when the item is active.
export const settingsSubmenuItemLabelClassName = 'group-data-[active=true]:font-medium'

// Submenu section heading between groups of nav entries (muted, 12px).
export const settingsSubmenuSectionTitleClassName =
  'px-2.5 pt-1.5 pb-1 font-normal text-foreground-muted text-xs first:pt-0'

// Submenu group divider — transparent spacer between nav sections.
export const settingsSubmenuDividerClassName = 'my-1 bg-transparent'

// Right content column scroll container — fills remaining width, hides horizontal overflow.
export const settingsContentScrollClassName = 'flex-1 min-h-0 min-w-0 overflow-x-hidden'

// Right content body — same two-layer padding as SettingsContentBody, applied via className.
export const settingsContentBodyClassName = 'flex min-h-full w-full flex-col px-6 py-4'

// Spacing wrapper below a 3-column page's content header.
export const settingsContentHeaderClassName = 'mb-5'

// 3-column page content-header title (15px, weight 550).
export const settingsContentHeaderTitleClassName = 'font-[550] text-foreground text-(length:--font-size-body-md)'

// 3-column page content-header description (muted, 14px).
export const settingsContentHeaderDescriptionClassName = 'mt-1 text-foreground-muted text-sm'
