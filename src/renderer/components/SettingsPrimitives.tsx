import React from 'react'

import { Divider as SettingDivider, HelpTooltip, PageHeader, ScrollArea } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'

export { SettingDivider }

export const SettingsPageHeader = ({
  title,
  help,
  action,
  className
}: {
  title: React.ReactNode
  help?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) => (
  <div className={cn('mb-4 flex min-h-8 flex-wrap items-center justify-between gap-x-6 gap-y-3', className)}>
    <div className="flex min-w-0 items-center gap-1.5">
      <PageHeader
        title={title}
        className="m-0 min-w-0 shrink p-0"
        titleClassName="flex items-center gap-2 text-[15px] leading-6 font-semibold"
      />
      {help && <HelpTooltip content={help} />}
    </div>
    {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
  </div>
)

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

// Shared settings content column; pages with internal split layouts own their containers.
export const SettingsContentColumn = ({
  className,
  innerClassName,
  theme,
  children,
  viewportProps,
  contentProps,
  ...rest
}: React.ComponentPropsWithoutRef<typeof ScrollArea> & { theme?: ThemeMode; innerClassName?: string }) => (
  <ScrollArea
    className={cn('min-h-0 min-w-0 flex-1', className)}
    viewportProps={{ ...viewportProps, 'data-theme-mode': theme }}
    contentProps={{ ...contentProps, className: cn('p-6', contentProps?.className) }}
    {...rest}>
    <div className={cn('mx-auto w-full max-w-5xl shrink-0', innerClassName)}>{children}</div>
  </ScrollArea>
)

// Non-scrolling counterpart for pages that own their scroll boundary.
export const SettingsContentBody = ({
  className,
  innerClassName,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<'div'> & { innerClassName?: string }) => (
  <div className={cn('flex min-h-full w-full flex-col p-6', className)} {...rest}>
    <div className={cn('mx-auto w-full max-w-5xl', innerClassName)}>{children}</div>
  </div>
)

export const SettingTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('flex items-center justify-between text-[15px] font-semibold select-none', className)}
    {...props}
  />
)

export const SettingSubtitle = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.RefObject<HTMLDivElement | null> }) => (
  <div ref={ref} className={cn('text-sm font-semibold text-foreground select-none', className)} {...props} />
)

export const SettingDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2.5 text-xs text-muted-foreground', className)} {...props} />
)

export const SettingRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2', className)} {...props} />
)

export const SettingRowTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('flex min-w-0 flex-wrap items-center gap-1.5 text-sm leading-4.5 text-foreground', className)}
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
        : 'mt-2 border-t border-border-subtle pt-3 first:mt-0 first:border-t-0 first:pt-0',
      className
    )}
    {...props}
  />
)
