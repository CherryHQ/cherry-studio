import { Divider as SettingDivider } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import React from 'react'

export { SettingDivider }

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
// outer p-6 + inner mx-auto max-w-3xl. Use for "simple right-content" settings pages.
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
    className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto p-6 [&::-webkit-scrollbar]:hidden', className)}
    {...rest}>
    <div className={cn('mx-auto w-full max-w-3xl', innerClassName)}>{children}</div>
  </div>
)

// Body variant for pages that handle their own Scrollbar (e.g. ShortcutSettings).
// Renders the same two-layer structure (outer p-6, inner mx-auto max-w-3xl) without owning the scroll.
export const SettingsContentBody = ({
  className,
  innerClassName,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<'div'> & { innerClassName?: string }) => (
  <div className={cn('flex min-h-full w-full flex-col p-6', className)} {...rest}>
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
  <div ref={ref} className={cn('select-none font-semibold text-foreground text-sm', className)} {...props} />
)

export const SettingDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2.5 text-muted-foreground text-xs', className)} {...props} />
)

export const SettingRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2', className)} {...props} />
)

export const SettingRowTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('flex min-w-0 flex-wrap items-center text-foreground text-sm leading-4.5', className)}
    {...props}
  />
)

export const SettingHelpTextRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center py-1.25', className)} {...props} />
)

export const SettingHelpText = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('text-[11px] text-muted-foreground', className)} {...props} />
)

export const SettingHelpLink = ({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a className={cn('cursor-pointer text-[11px] text-link hover:underline', className)} {...props} />
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
    className={cn('inline-flex items-center text-link hover:underline', className)}
    {...props}
  />
)

export const SettingGroup = ({
  className,
  style,
  theme,
  variant = 'card',
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { theme?: ThemeMode; variant?: 'card' | 'plain' }) => (
  <div
    data-theme-mode={theme}
    style={{
      backgroundColor: variant === 'card' ? 'var(--settings-group-background, var(--card))' : undefined,
      ...style
    }}
    className={cn(
      variant === 'card'
        ? 'mt-4 rounded-xl border border-border bg-card p-4 first:mt-0'
        : 'mt-2 border-border-subtle border-t pt-3 first:mt-0 first:border-t-0 first:pt-0',
      className
    )}
    {...props}
  />
)
