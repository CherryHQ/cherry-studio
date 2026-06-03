import { cn } from '@renderer/utils'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import React from 'react'

export { Divider as SettingDivider } from '@cherrystudio/ui'

export const SettingContainer = ({
  className,
  theme,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { theme?: ThemeMode }) => (
  <div
    data-theme-mode={theme}
    className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto p-4 [&::-webkit-scrollbar]:hidden', className)}
    {...props}
  />
)

// Canonical settings page container — mirrors the model service (Provider Settings) detail column:
// outer px-6 py-4 + inner mx-auto max-w-3xl. Use for "simple right-content" settings pages.
// Pages with their own internal split layout (Data / Integration / MCP / WebSearch / FileProcessing / Channels / Skills)
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
    className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:hidden', className)}
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
  <div className={cn('flex min-h-full w-full flex-col px-6 py-4', className)} {...rest}>
    <div className={cn('mx-auto w-full max-w-3xl', innerClassName)}>{children}</div>
  </div>
)

export const SettingTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('flex select-none items-center justify-between font-semibold text-[15px]', className)}
    {...props}
  />
)

export const SettingSubtitle = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.RefObject<HTMLDivElement | null> }) => (
  <div ref={ref} className={cn('mt-4 select-none font-bold text-(--color-foreground) text-sm', className)} {...props} />
)

export const SettingDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2.5 text-foreground-muted text-xs', className)} {...props} />
)

export const SettingRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-h-6 items-center justify-between', className)} {...props} />
)

export const SettingRowTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center text-foreground text-sm leading-4.5', className)} {...props} />
)

export const SettingHelpTextRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center py-1.25', className)} {...props} />
)

export const SettingHelpText = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('text-[11px] text-foreground/40', className)} {...props} />
)

export const SettingHelpLink = ({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a className={cn('cursor-pointer text-(--color-primary) text-[11px] hover:underline', className)} {...props} />
)

export const SettingTitleExternalLink = ({
  className,
  target = '_blank',
  rel = 'noreferrer',
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a
    target={target}
    rel={rel}
    className={cn('inline-flex items-center text-(--color-primary) hover:underline', className)}
    {...props}
  />
)

export const SettingGroup = ({
  className,
  theme,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { theme?: ThemeMode }) => (
  <div
    data-theme-mode={theme}
    className={cn('mt-2 border-border/60 border-t pt-3 first:mt-0 first:border-t-0 first:pt-0', className)}
    {...props}
  />
)

export const settingsSubmenuScrollClassName =
  'h-[calc(100vh-var(--navbar-height))] w-(--settings-width) border-border border-r-[0.5px]'

export const settingsSubmenuListClassName = 'flex flex-col gap-1 px-2.5 pb-2.5 [box-sizing:border-box]'

export const settingsSubmenuItemClassName =
  'h-8 rounded-[10px] border-transparent px-2.5 font-normal text-foreground text-sm hover:!bg-muted data-[active=true]:!border-transparent data-[active=true]:!bg-muted data-[active=true]:!font-medium data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-foreground'

export const settingsSubmenuItemLabelClassName = 'group-data-[active=true]:font-medium'

export const settingsSubmenuSectionTitleClassName =
  'px-2.5 pt-1.5 pb-1 font-normal text-foreground-muted text-xs first:pt-0'

export const settingsSubmenuDividerClassName = 'my-1 bg-transparent'

export const settingsContentScrollClassName = 'flex-1 min-h-0'

export const settingsContentBodyClassName = 'flex min-h-full w-full flex-col px-6 py-4'

export const settingsContentHeaderClassName = 'mb-5'

export const settingsContentHeaderTitleClassName = 'font-semibold text-foreground text-[15px]'

export const settingsContentHeaderDescriptionClassName = 'mt-1 text-foreground-muted text-sm'
