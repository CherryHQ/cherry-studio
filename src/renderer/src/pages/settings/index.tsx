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
    className={cn(
      'flex flex-1 flex-col overflow-y-scroll px-[18px] py-[15px] [&::-webkit-scrollbar]:hidden',
      theme === 'dark' ? 'bg-transparent' : 'bg-background-subtle',
      className
    )}
    {...props}
  />
)

export const SettingTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex select-none items-center justify-between font-bold text-sm', className)} {...props} />
)

export const SettingSubtitle = ({
  ref,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.RefObject<HTMLDivElement | null> }) => (
  <div ref={ref} className={cn('mt-4 select-none font-bold text-(--color-text-1) text-sm', className)} {...props} />
)

export const SettingDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2.5 text-foreground-muted text-xs', className)} {...props} />
)

export const SettingRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-h-6 items-center justify-between', className)} {...props} />
)

export const SettingRowTitle = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center text-foreground text-sm leading-[18px]', className)} {...props} />
)

export const SettingHelpTextRow = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center py-[5px]', className)} {...props} />
)

export const SettingHelpText = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('text-[11px] text-foreground/40', className)} {...props} />
)

export const SettingHelpLink = ({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a
    className={cn('mx-1.25 cursor-pointer text-(--color-primary) text-[11px] hover:underline', className)}
    {...props}
  />
)

export const SettingGroup = ({
  className,
  theme,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { theme?: ThemeMode }) => (
  <div
    className={cn(
      'mb-5 rounded-2xs border-[0.5px] border-border bg-background p-4',
      theme === 'dark' && 'bg-white/6',
      className
    )}
    {...props}
  />
)
