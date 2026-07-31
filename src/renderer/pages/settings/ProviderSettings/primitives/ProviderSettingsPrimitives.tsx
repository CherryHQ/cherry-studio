import type { ReactNode } from 'react'

import Scrollbar from '@renderer/components/Scrollbar'
import { cn } from '@renderer/utils/style'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'

import { providerSettingsTypography } from './classNames'

export {
  actionClasses,
  apiKeyListClasses,
  authConnectionClasses,
  customHeaderDrawerClasses,
  drawerClasses,
  fieldClasses,
  modelListClasses,
  modelSyncClasses,
  oauthCardClasses,
  providerDetailColumnClasses,
  providerListClasses,
  providerSettingsTypography,
  sectionHeadingClasses
} from './classNames'

export function ProviderSettingsContainer({
  className,
  children
}: {
  theme?: ThemeMode
  className?: string
  children: ReactNode
}) {
  return (
    <Scrollbar
      className={cn('flex min-w-0 flex-1 flex-col [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {children}
    </Scrollbar>
  )
}

export function ProviderSettingsSubtitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('mt-4 font-semibold text-foreground select-none', providerSettingsTypography.subtitle, className)}>
      {children}
    </div>
  )
}

export function ProviderHelpText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-foreground opacity-40', providerSettingsTypography.label, className)}>{children}</div>
}

export function ProviderHelpTextRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-row items-center py-1.25', className)}>{children}</div>
}

export function ProviderHelpLink({ children, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cn('mx-[5px] cursor-pointer text-link', providerSettingsTypography.label, className)} {...props}>
      {children}
    </a>
  )
}
