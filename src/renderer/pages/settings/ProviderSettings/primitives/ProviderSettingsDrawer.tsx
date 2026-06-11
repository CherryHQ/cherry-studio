import { PageSidePanel } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ProviderSettingsDrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  bodyClassName?: string
  contentClassName?: string
  headerClassName?: string
  footerClassName?: string
  showHeaderCloseButton?: boolean
}

// All callers follow PageSidePanel defaults from DESIGN.md §4 "Drawers & Page Side Panels":
// w-100, rounded-3xl, shadow-xl, bg-card (opaque via provider-settings-scoped-theme.css),
// backdrop bg-black/50, header px-6 pt-6 pb-3, body space-y-4 px-6 py-4, footer px-6 pt-3 pb-6.
export default function ProviderSettingsDrawer({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  bodyClassName,
  contentClassName,
  headerClassName,
  footerClassName,
  showHeaderCloseButton = true
}: ProviderSettingsDrawerProps) {
  const { t } = useTranslation()

  const header = description ? (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="font-semibold text-base text-foreground">{title}</span>
      <span className="text-foreground-muted text-xs leading-[var(--line-height-body-xs)]">{description}</span>
    </div>
  ) : undefined

  return (
    <PageSidePanel
      open={open}
      onClose={onClose}
      title={header ? undefined : title}
      header={header}
      footer={footer}
      closeLabel={t('common.close')}
      showCloseButton={showHeaderCloseButton}
      contentClassName={cn('provider-settings-default-scope', contentClassName)}
      headerClassName={headerClassName}
      bodyClassName={bodyClassName}
      footerClassName={footerClassName}>
      {children}
    </PageSidePanel>
  )
}
