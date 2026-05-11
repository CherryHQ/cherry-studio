import { cn } from '@renderer/utils'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { ReactNode } from 'react'

import { providerSettingsTypography } from './classNames'

export * from './classNames'

export function ProviderSettingsContainer({
  className,
  children
}: {
  theme?: ThemeMode
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}>
      {children}
    </div>
  )
}

export function ProviderSettingsSubtitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('mt-4 select-none font-semibold text-foreground', providerSettingsTypography.subtitle, className)}>
      {children}
    </div>
  )
}

export function ProviderHelpText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-foreground opacity-40', providerSettingsTypography.label, className)}>{children}</div>
}

export function ProviderHelpTextRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-row items-center py-[5px]', className)}>{children}</div>
}

export function ProviderHelpLink({ children, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cn(
        'mx-[5px] cursor-pointer text-(--color-primary) hover:underline',
        providerSettingsTypography.label,
        className
      )}
      {...props}>
      {children}
    </a>
  )
}
